import { mulberry32 } from "../util/rng";
import { BlockId } from "./blocks";
import { WORLD_SEED } from "../config";

// Ore veins are placed as seeded blob *clusters* on a coarse 3D grid, never
// as an independent per-block probability roll — each cell deterministically
// either contains one cluster (a type, center, and radius) or doesn't, and
// any block within `radius` of that center becomes ore. This is what the
// subject asks for explicitly: "clusters of ores just like in Minecraft, not
// a simple probability on each block".
const CELL_SIZE_XZ = 20;
const CELL_SIZE_Y = 16;

interface OreCluster {
  type: BlockId;
  cx: number;
  cy: number;
  cz: number;
  radius: number;
}

function hashCell(cellX: number, cellY: number, cellZ: number, seed: number): () => number {
  let h = seed ^ 0x9e3779b9;
  h = Math.imul(h ^ cellX, 0x85ebca6b);
  h = Math.imul(h ^ cellY, 0xc2b2ae35);
  h = Math.imul(h ^ cellZ, 0x27d4eb2f);
  return mulberry32(h >>> 0);
}

/** Depth-appropriate rarity: shallow ore is common, deep ore is scarce, matching Minecraft's layering. */
function pickOreType(rng: () => number, worldY: number): BlockId | null {
  const depthFactor = Math.max(0, Math.min(1, (80 - worldY) / 80)); // 0 near surface, 1 near bedrock
  const roll = rng();
  if (roll < 0.05 + depthFactor * 0.02) return BlockId.CoalOre;
  if (roll < 0.09 + depthFactor * 0.05) return BlockId.IronOre;
  if (worldY < 48 && roll < 0.1 + depthFactor * 0.06) return BlockId.GoldOre;
  if (worldY < 24 && roll < 0.1 + depthFactor * 0.07) return BlockId.DiamondOre;
  return null;
}

function clusterForCell(cellX: number, cellY: number, cellZ: number, seed: number): OreCluster | null {
  const rng = hashCell(cellX, cellY, cellZ, seed);
  const worldY = cellY * CELL_SIZE_Y + CELL_SIZE_Y / 2;
  const type = pickOreType(rng, worldY);
  if (type === null) return null;
  return {
    type,
    cx: cellX * CELL_SIZE_XZ + rng() * CELL_SIZE_XZ,
    cy: cellY * CELL_SIZE_Y + rng() * CELL_SIZE_Y,
    cz: cellZ * CELL_SIZE_XZ + rng() * CELL_SIZE_XZ,
    radius: type === BlockId.DiamondOre ? 1.5 + rng() : 2 + rng() * 2.2,
  };
}

export class OreField {
  constructor(private seed: number = WORLD_SEED ^ 0x0be5eed) {}

  /** Returns the ore block that should occupy this position, or null for plain stone. */
  oreAt(worldX: number, worldY: number, worldZ: number): BlockId | null {
    if (worldY < 1 || worldY > 90) return null;
    const cellX = Math.floor(worldX / CELL_SIZE_XZ);
    const cellY = Math.floor(worldY / CELL_SIZE_Y);
    const cellZ = Math.floor(worldZ / CELL_SIZE_XZ);

    // Only the containing cell is checked (not neighbors), so clusters can be
    // faintly clipped at cell boundaries — an acceptable trade for O(1) lookups.
    const cluster = clusterForCell(cellX, cellY, cellZ, this.seed);
    if (!cluster) return null;
    const dx = worldX + 0.5 - cluster.cx;
    const dy = worldY + 0.5 - cluster.cy;
    const dz = worldZ + 0.5 - cluster.cz;
    if (dx * dx + dy * dy + dz * dz > cluster.radius * cluster.radius) return null;
    return cluster.type;
  }
}
