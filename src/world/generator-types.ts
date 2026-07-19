import { BlockId } from "./blocks";
import { Chunk } from "./chunk";

/** Shared shape implemented by both TerrainGenerator (overworld) and NetherGenerator (bonus dimension). */
export interface WorldGenerator {
  generate(chunk: Chunk): void;
  getBlockAt(worldX: number, y: number, worldZ: number): BlockId;
}
