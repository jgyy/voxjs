import { createNoise2D, createNoise3D } from "../util/noise";
import { mulberry32 } from "../util/rng";
import { CHUNK_HEIGHT, CHUNK_SIZE_X, CHUNK_SIZE_Z, NETHER_SEED_XOR, WORLD_SEED } from "../config";
import { BlockId } from "./blocks";
import { Chunk } from "./chunk";
import { WorldGenerator } from "./generator-types";

const CEILING_Y = 118;
const FLOOR_MIN_Y = 12;
const FLOOR_VARIANCE = 42;

/**
 * Bonus: "Nether portal that teleports you to another dimension." A
 * deliberately simpler, standalone generator (no biomes/rivers/villages/
 * trees) — dense caverns between a solid floor and a bedrock-like ceiling,
 * Netherrack/Basalt walls, and its own ore. Kept separate from
 * TerrainGenerator rather than branching it, since the two worlds share
 * almost no shaping logic beyond "noise + caves".
 */
export class NetherGenerator implements WorldGenerator {
  private floorNoise: (x: number, y: number) => number;
  private caveNoise: (x: number, y: number, z: number) => number;
  private warpNoise: (x: number, y: number, z: number) => number;
  private oreNoise: (x: number, y: number, z: number) => number;

  constructor(seed: number = WORLD_SEED ^ NETHER_SEED_XOR) {
    this.floorNoise = createNoise2D(mulberry32(seed ^ 0x1));
    this.caveNoise = createNoise3D(mulberry32(seed ^ 0x2));
    this.warpNoise = createNoise3D(mulberry32(seed ^ 0x3));
    this.oreNoise = createNoise3D(mulberry32(seed ^ 0x4));
  }

  private floorHeight(worldX: number, worldZ: number): number {
    const n = this.floorNoise(worldX / 90, worldZ / 90);
    return Math.floor(FLOOR_MIN_Y + (n * 0.5 + 0.5) * FLOOR_VARIANCE);
  }

  private isHollow(worldX: number, y: number, worldZ: number): boolean {
    const warpX = worldX + this.warpNoise(worldX / 40, y / 40, worldZ / 40) * 10;
    const warpZ = worldZ + this.warpNoise(worldX / 55 + 100, y / 55, worldZ / 55 + 100) * 10;
    const n = this.caveNoise(warpX / 34, y / 22, warpZ / 34);
    return Math.abs(n) < 0.16; // wider band than the overworld caves: nether is mostly hollow
  }

  private blockAt(worldX: number, y: number, worldZ: number, floorY: number): BlockId {
    if (y <= 1) return BlockId.Bedrock;
    if (y >= CEILING_Y) return BlockId.Bedrock;
    if (y > CEILING_Y - 4) return BlockId.Netherrack;
    if (y < floorY) return this.isHollow(worldX, y, worldZ) ? BlockId.Air : this.solidMaterial(worldX, y, worldZ);
    if (this.isHollow(worldX, y, worldZ)) return BlockId.Air;
    return this.solidMaterial(worldX, y, worldZ);
  }

  private solidMaterial(worldX: number, y: number, worldZ: number): BlockId {
    const oreN = this.oreNoise(worldX / 18, y / 18, worldZ / 18);
    if (oreN > 0.82) return BlockId.NetherGoldOre;
    const basaltN = this.floorNoise(worldX / 25 + 900, worldZ / 25 + 900);
    return basaltN > 0.35 ? BlockId.Basalt : BlockId.Netherrack;
  }

  generate(chunk: Chunk): void {
    const originX = chunk.worldOriginX;
    const originZ = chunk.worldOriginZ;
    for (let lx = 0; lx < CHUNK_SIZE_X; lx++) {
      for (let lz = 0; lz < CHUNK_SIZE_Z; lz++) {
        const worldX = originX + lx;
        const worldZ = originZ + lz;
        const floorY = this.floorHeight(worldX, worldZ);
        for (let y = 0; y < CHUNK_HEIGHT; y++) {
          const block = this.blockAt(worldX, y, worldZ, floorY);
          if (block !== BlockId.Air) chunk.set(lx, y, lz, block);
        }
      }
    }
  }

  getBlockAt(worldX: number, y: number, worldZ: number): BlockId {
    if (y < 0 || y >= CHUNK_HEIGHT) return BlockId.Air;
    return this.blockAt(worldX, y, worldZ, this.floorHeight(worldX, worldZ));
  }
}
