import { createNoise2D, createNoise3D } from "simplex-noise";
import { CHUNK_HEIGHT, CHUNK_SIZE_X, CHUNK_SIZE_Z, WORLD_SEED } from "../config";
import { BlockId } from "./blocks";
import { Chunk } from "./chunk";
import { mulberry32 } from "../util/rng";

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

export class TerrainGenerator {
  private heightNoise: (x: number, y: number) => number;
  private mountainMaskNoise: (x: number, y: number) => number;
  private caveNoise: (x: number, y: number, z: number) => number;

  private readonly seaLevel = 62;
  private readonly baseHeight = 68;

  constructor(seed: number = WORLD_SEED) {
    this.heightNoise = createNoise2D(mulberry32(seed));
    this.mountainMaskNoise = createNoise2D(mulberry32(seed ^ 0x9e3779b9));
    this.caveNoise = createNoise3D(mulberry32(seed ^ 0x85ebca6b));
  }

  private heightAt(worldX: number, worldZ: number): number {
    const hills = fbm2D(this.heightNoise, worldX / 180, worldZ / 180, 5) * 18;
    const mountainMask = Math.max(
      0,
      fbm2D(this.mountainMaskNoise, worldX / 500, worldZ / 500, 3) - 0.15,
    );
    const mountains = mountainMask * 70;
    return Math.floor(this.baseHeight + hills + mountains);
  }

  /** Determinism guarantee: identical (seed, cx, cz) always yields the same voxels. */
  generate(chunk: Chunk): void {
    const originX = chunk.worldOriginX;
    const originZ = chunk.worldOriginZ;

    for (let lx = 0; lx < CHUNK_SIZE_X; lx++) {
      for (let lz = 0; lz < CHUNK_SIZE_Z; lz++) {
        const worldX = originX + lx;
        const worldZ = originZ + lz;
        const columnHeight = Math.min(CHUNK_HEIGHT - 1, this.heightAt(worldX, worldZ));

        for (let y = 0; y <= columnHeight; y++) {
          let block: BlockId;
          if (y === columnHeight) {
            block = columnHeight <= this.seaLevel + 1 ? BlockId.Sand : BlockId.Grass;
          } else if (y > columnHeight - 4) {
            block = BlockId.Dirt;
          } else {
            block = BlockId.Stone;
          }

          if (this.isCave(worldX, y, worldZ, columnHeight)) {
            block = BlockId.Air;
          }

          if (block !== BlockId.Air) {
            chunk.set(lx, y, lz, block);
          }
        }
      }
    }
  }

  /**
   * Directly evaluates the block that would exist at an arbitrary world
   * coordinate, without needing that column's chunk to be generated. Used
   * by the mesher to resolve cross-chunk face visibility at chunk borders.
   */
  getBlockAt(worldX: number, y: number, worldZ: number): BlockId {
    if (y < 0 || y >= CHUNK_HEIGHT) return BlockId.Air;
    const columnHeight = Math.min(CHUNK_HEIGHT - 1, this.heightAt(worldX, worldZ));
    if (y > columnHeight) return BlockId.Air;
    if (this.isCave(worldX, y, worldZ, columnHeight)) return BlockId.Air;
    if (y === columnHeight) return columnHeight <= this.seaLevel + 1 ? BlockId.Sand : BlockId.Grass;
    if (y > columnHeight - 4) return BlockId.Dirt;
    return BlockId.Stone;
  }

  private isCave(worldX: number, y: number, worldZ: number, surfaceHeight: number): boolean {
    if (y > surfaceHeight - 3 || y < 2) return false; // keep surface & bedrock solid
    const n = this.caveNoise(worldX / 40, y / 24, worldZ / 40);
    return n > 0.62;
  }
}
