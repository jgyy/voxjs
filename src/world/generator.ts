import { createNoise2D, createNoise3D } from "../util/noise";
import { CHUNK_HEIGHT, CHUNK_SIZE_X, CHUNK_SIZE_Z, SEA_LEVEL, WORLD_SEED } from "../config";
import { BlockId } from "./blocks";
import { Chunk } from "./chunk";
import { mulberry32 } from "../util/rng";
import { BIOME_SHAPES, Biome, BiomeShape, ISLAND_SHAPE } from "./biomes";
import { OreField } from "./ores";
import { ColumnInfo, decorate } from "./decorator";
import { decorateVillages } from "./villages";

// A handful of octaves at different frequency/amplitude gives natural-looking
// hills and mountains instead of the uniform bumps a single noise call
// produces — this is the "fractal Brownian motion" (fBm) technique.
function fbm2D(noise2D: (x: number, y: number) => number, x: number, z: number, octaves: number): number {
  let amplitude = 1;
  let frequency = 1;
  let sum = 0;
  let maxAmp = 0;
  for (let o = 0; o < octaves; o++) {
    sum += noise2D(x * frequency, z * frequency) * amplitude;
    maxAmp += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return sum / maxAmp;
}

/** "Ridged" fBm: folds noise around zero so valleys become sharp ridges/canyons — roughly 0..1. */
function ridgedFbm2D(noise2D: (x: number, y: number) => number, x: number, z: number, octaves: number): number {
  let amplitude = 1;
  let frequency = 1;
  let sum = 0;
  let maxAmp = 0;
  for (let o = 0; o < octaves; o++) {
    const n = 1 - Math.abs(noise2D(x * frequency, z * frequency));
    sum += n * amplitude;
    maxAmp += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return sum / maxAmp;
}

interface ColumnResult {
  height: number;
  biome: Biome;
  shape: BiomeShape;
}

const COLUMN_CACHE_CAP = 60000;

export class TerrainGenerator {
  private temperatureNoise: (x: number, y: number) => number;
  private moistureNoise: (x: number, y: number) => number;
  private erosionNoise: (x: number, y: number) => number;
  private continentNoise: (x: number, y: number) => number;
  private islandNoise: (x: number, y: number) => number;
  private hillsNoise: (x: number, y: number) => number;
  private ridgeNoise: (x: number, y: number) => number;
  private riverNoise: (x: number, y: number) => number;
  private caveWarpXNoise: (x: number, y: number, z: number) => number;
  private caveWarpZNoise: (x: number, y: number, z: number) => number;
  private caveTunnelNoise: (x: number, y: number, z: number) => number;
  private oreField: OreField;

  private readonly seed: number;
  readonly seaLevel = SEA_LEVEL;

  private columnCache = new Map<string, ColumnResult>();

  constructor(seed: number = WORLD_SEED) {
    this.seed = seed;
    this.temperatureNoise = createNoise2D(mulberry32(seed ^ 0x27d4eb2f));
    this.moistureNoise = createNoise2D(mulberry32(seed ^ 0x165667b1));
    this.erosionNoise = createNoise2D(mulberry32(seed ^ 0x9e3779b9));
    this.continentNoise = createNoise2D(mulberry32(seed ^ 0x85ebca6b));
    this.islandNoise = createNoise2D(mulberry32(seed ^ 0xc2b2ae35));
    this.hillsNoise = createNoise2D(mulberry32(seed ^ 0x1b873593));
    this.ridgeNoise = createNoise2D(mulberry32(seed ^ 0x0ff1ce00));
    this.riverNoise = createNoise2D(mulberry32(seed ^ 0x5ca1ab1e));
    this.caveWarpXNoise = createNoise3D(mulberry32(seed ^ 0xa5a5a5a5));
    this.caveWarpZNoise = createNoise3D(mulberry32(seed ^ 0x5a5a5a5a));
    this.caveTunnelNoise = createNoise3D(mulberry32(seed ^ 0xdeadbeef));
    this.oreField = new OreField(seed ^ 0x0be5eed);
  }

  private biomeHeightContribution(shape: BiomeShape, worldX: number, worldZ: number): number {
    if (shape.ridged) {
      const r = ridgedFbm2D(this.ridgeNoise, worldX / 260, worldZ / 260, 4);
      if (shape.carve) {
        const cut = Math.pow(r, 3);
        return shape.base - cut * shape.amplitude;
      }
      return shape.base + Math.pow(r, 1.6) * shape.amplitude;
    }
    const h = fbm2D(this.hillsNoise, worldX / 180, worldZ / 180, 5);
    return shape.base + h * shape.amplitude;
  }

  private biomeWeights(t: number, m: number, e: number): number[] {
    const raw = BIOME_SHAPES.map((shape) => {
      const [tt, tm, te] = shape.target;
      const dt = t - tt;
      const dm = m - tm;
      const de = e - te;
      const dist = Math.sqrt(dt * dt + dm * dm * 0.8 + de * de * 0.9);
      return Math.max(0, 1 - dist / 1.35);
    });
    const shaped = raw.map((w) => w * w);
    const sum = shaped.reduce((a, b) => a + b, 0);
    if (sum < 1e-6) {
      const fallback = new Array(shaped.length).fill(0);
      fallback[Biome.Plains] = 1;
      return fallback;
    }
    return shaped.map((w) => w / sum);
  }

  /**
   * Single source of truth for "what's the terrain height + biome at this
   * column" — shared by generate(), getBlockAt(), and the decorator, so a
   * chunk's own voxels, its neighbors' cross-border queries, and its
   * vegetation can never disagree, regardless of generation order.
   */
  private columnAt(worldX: number, worldZ: number): ColumnResult {
    const key = `${worldX},${worldZ}`;
    const cached = this.columnCache.get(key);
    if (cached) return cached;

    const t = fbm2D(this.temperatureNoise, worldX / 700, worldZ / 700, 3);
    const m = fbm2D(this.moistureNoise, worldX / 550, worldZ / 550, 3);
    const e = fbm2D(this.erosionNoise, worldX / 420, worldZ / 420, 3);
    const c = fbm2D(this.continentNoise, worldX / 1400, worldZ / 1400, 2);

    const weights = this.biomeWeights(t, m, e);
    let blended = 0;
    let dominantIdx = 0;
    let dominantW = -1;
    for (let i = 0; i < BIOME_SHAPES.length; i++) {
      const w = weights[i]!;
      if (w <= 0.001) continue;
      if (w > dominantW) {
        dominantW = w;
        dominantIdx = i;
      }
      blended += w * this.biomeHeightContribution(BIOME_SHAPES[i]!, worldX, worldZ);
    }
    blended += c * 30; // continentalness: negative = ocean basin, positive = elevated mainland

    let biome = BIOME_SHAPES[dominantIdx]!.biome;
    let shape = BIOME_SHAPES[dominantIdx]!;

    // Island / ocean override: far from the mainland (low continentalness), a
    // high-frequency bump either pokes an isolated island above the waves or
    // the column stays a plain ocean floor.
    if (c < -0.32) {
      const bump = fbm2D(this.islandNoise, worldX / 70, worldZ / 70, 3);
      if (bump > 0.42) {
        const local = (bump - 0.42) / 0.3;
        blended = ISLAND_SHAPE.base + local * 10 + fbm2D(this.hillsNoise, worldX / 60, worldZ / 60, 3) * 3;
        biome = Biome.Island;
        shape = ISLAND_SHAPE;
      } else {
        const oceanFloor = this.seaLevel - 6 - Math.max(0, -0.32 - c) * 40;
        blended = Math.min(blended, oceanFloor);
      }
    }

    // Rivers: a winding channel wherever a large-scale noise field crosses
    // zero, carved only through lowlands (never through mountains) so they
    // "meander across the world" without gouging cliffs — V.1 requirement.
    if (biome !== Biome.Island) {
      const riverRaw = this.riverNoise(worldX / 480, worldZ / 480);
      const riverDist = Math.abs(riverRaw);
      const riverBand = 0.035;
      if (riverDist < riverBand && blended > this.seaLevel - 30 && blended < this.seaLevel + 26) {
        const bandT = 1 - riverDist / riverBand;
        const available = Math.max(0, this.seaLevel + 18 - blended) + 4;
        blended -= bandT * bandT * Math.min(9, available);
      }
    }

    const result: ColumnResult = { height: Math.floor(blended), biome, shape };
    if (this.columnCache.size > COLUMN_CACHE_CAP) {
      const oldestKey = this.columnCache.keys().next().value;
      if (oldestKey !== undefined) this.columnCache.delete(oldestKey);
    }
    this.columnCache.set(key, result);
    return result;
  }

  /** True where neighboring columns differ enough in height to count as a steep slope (bare rock). */
  private isSteep(worldX: number, worldZ: number, height: number): boolean {
    const hx = this.columnAt(worldX + 1, worldZ).height;
    const hz = this.columnAt(worldX, worldZ + 1).height;
    return Math.abs(hx - height) > 3 || Math.abs(hz - height) > 3;
  }

  private surfaceBlock(
    worldX: number,
    worldZ: number,
    y: number,
    height: number,
    shape: BiomeShape,
    steep: boolean,
  ): BlockId {
    const isBeach = height <= this.seaLevel + 1 && shape.biome !== Biome.Canyon && shape.biome !== Biome.Mountain;
    const depthFromSurface = height - y;

    if (depthFromSurface === 0) {
      if (steep && shape.biome !== Biome.Canyon) return BlockId.Stone;
      if (isBeach) return shape.beachBlock;
      return shape.topBlock;
    }
    if (depthFromSurface < 3 && !steep) {
      return isBeach ? shape.beachBlock : shape.fillBlock;
    }
    const ore = this.oreField.oreAt(worldX, y, worldZ);
    if (ore !== null) return ore;
    return BlockId.Stone;
  }

  /**
   * Wormhole-style cave tunnels: the query point is domain-warped by two
   * independent noise fields before being sampled, which bends what would
   * otherwise be blobby iso-surfaces into long sinuous connected tunnels —
   * the standard "Perlin worm" technique — rather than the flat per-block
   * noise threshold this used to be. A thin iso-band around zero keeps
   * tunnels narrow; occasionally reaching to just under the surface gives
   * natural visible cave entrances (V.1 requirement).
   */
  private isCave(worldX: number, y: number, worldZ: number, surfaceHeight: number): boolean {
    if (y > surfaceHeight - 1 || y < 3) return false;
    const warpX = worldX + this.caveWarpXNoise(worldX / 50, y / 50, worldZ / 50) * 14;
    const warpY = y + this.caveWarpXNoise(worldX / 90, y / 90, worldZ / 90) * 5;
    const warpZ = worldZ + this.caveWarpZNoise(worldX / 50, y / 50, worldZ / 50) * 14;
    const tunnel = this.caveTunnelNoise(warpX / 26, warpY / 15, warpZ / 26);
    if (Math.abs(tunnel) < 0.045) return true;

    // A second, larger-scale field carves occasional wide caverns so caves
    // aren't uniformly tunnel-width everywhere.
    const cavern = this.caveTunnelNoise(worldX / 70 + 500, y / 40, worldZ / 70 + 500);
    return y < surfaceHeight - 18 && cavern > 0.72;
  }

  /** Determinism guarantee: identical (seed, cx, cz) always yields the same voxels. */
  generate(chunk: Chunk): void {
    const originX = chunk.worldOriginX;
    const originZ = chunk.worldOriginZ;

    for (let lx = 0; lx < CHUNK_SIZE_X; lx++) {
      for (let lz = 0; lz < CHUNK_SIZE_Z; lz++) {
        const worldX = originX + lx;
        const worldZ = originZ + lz;
        const column = this.columnAt(worldX, worldZ);
        const height = Math.min(CHUNK_HEIGHT - 1, column.height);
        const steep = this.isSteep(worldX, worldZ, column.height);
        const waterTop = Math.min(CHUNK_HEIGHT - 1, Math.max(height, this.seaLevel));

        for (let y = 0; y <= waterTop; y++) {
          let block: BlockId;
          if (y > height) {
            block = BlockId.Water;
          } else if (this.isCave(worldX, y, worldZ, height)) {
            block = BlockId.Air;
          } else {
            block = this.surfaceBlock(worldX, worldZ, y, height, column.shape, steep);
          }

          if (block !== BlockId.Air) {
            chunk.set(lx, y, lz, block);
          }
        }
      }
    }

    decorate(chunk, (wx, wz) => this.columnInfo(wx, wz), this.seed);
    decorateVillages(
      chunk,
      (wx, wz) => this.columnAt(wx, wz).height,
      (wx, wz) => this.isSteep(wx, wz, this.columnAt(wx, wz).height),
      this.seed,
    );
  }

  /** Public biome query for systems outside terrain generation itself (ambient music, minimap). */
  biomeAt(worldX: number, worldZ: number): Biome {
    return this.columnAt(worldX, worldZ).biome;
  }

  /** Public height query for systems outside terrain generation itself (villages, minimap). */
  heightAt(worldX: number, worldZ: number): number {
    return this.columnAt(worldX, worldZ).height;
  }

  private columnInfo(worldX: number, worldZ: number): ColumnInfo {
    const column = this.columnAt(worldX, worldZ);
    return {
      height: column.height,
      biome: column.biome,
      shape: column.shape,
      underwater: column.height < this.seaLevel,
      steep: this.isSteep(worldX, worldZ, column.height),
    };
  }

  /**
   * Directly evaluates the terrain block that would exist at an arbitrary
   * world coordinate, without needing that column's chunk to be generated.
   * Used by the mesher to resolve cross-chunk face visibility at chunk
   * borders. Deliberately terrain-only (no decoration) — see decorator.ts's
   * doc comment for why that's still consistent chunk-to-chunk.
   */
  getBlockAt(worldX: number, y: number, worldZ: number): BlockId {
    if (y < 0 || y >= CHUNK_HEIGHT) return BlockId.Air;
    const column = this.columnAt(worldX, worldZ);
    const height = Math.min(CHUNK_HEIGHT - 1, column.height);
    if (y > height) return y <= this.seaLevel ? BlockId.Water : BlockId.Air;
    if (this.isCave(worldX, y, worldZ, height)) return BlockId.Air;
    const steep = this.isSteep(worldX, worldZ, column.height);
    return this.surfaceBlock(worldX, worldZ, y, height, column.shape, steep);
  }
}
