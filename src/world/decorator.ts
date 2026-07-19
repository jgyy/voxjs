import { mulberry32 } from "../util/rng";
import { CHUNK_HEIGHT, CHUNK_SIZE_X, CHUNK_SIZE_Z, WORLD_SEED } from "../config";
import { BlockId } from "./blocks";
import { Biome, BiomeShape } from "./biomes";
import { Chunk } from "./chunk";

export interface ColumnInfo {
  height: number;
  biome: Biome;
  shape: BiomeShape;
  underwater: boolean;
  steep: boolean;
}

export type ColumnInfoFn = (worldX: number, worldZ: number) => ColumnInfo;

type CanopyStyle = "blob" | "cone" | "umbrella";

interface TreeShape {
  trunkHeight: number;
  canopyStyle: CanopyStyle;
  canopyRadius: number;
  leafDensity: number;
  logId: BlockId;
  leafId: BlockId;
}

// Trees are never a fixed 3D model: every instance rolls its own height,
// width, and leaf density within a per-species range (V.1 requirement that
// "each tree should be generated with varying parameters ... to ensure
// uniqueness"), and different species get structurally distinct silhouettes
// (blob/cone/umbrella) rather than just palette swaps.
function rollTreeShape(rng: () => number, logId: BlockId, leafId: BlockId, style: CanopyStyle): TreeShape {
  if (style === "cone") {
    return {
      trunkHeight: 9 + Math.floor(rng() * 9),
      canopyStyle: style,
      canopyRadius: 3 + Math.floor(rng() * 2),
      leafDensity: 0.75 + rng() * 0.2,
      logId,
      leafId,
    };
  }
  if (style === "umbrella") {
    return {
      trunkHeight: 3 + Math.floor(rng() * 3),
      canopyStyle: style,
      canopyRadius: 3 + Math.floor(rng() * 2),
      leafDensity: 0.7 + rng() * 0.25,
      logId,
      leafId,
    };
  }
  return {
    trunkHeight: 4 + Math.floor(rng() * 4),
    canopyStyle: style,
    canopyRadius: 2 + Math.floor(rng() * 2),
    leafDensity: 0.65 + rng() * 0.3,
    logId,
    leafId,
  };
}

function stampTree(
  worldX: number,
  groundY: number,
  worldZ: number,
  shape: TreeShape,
  rng: () => number,
  write: (wx: number, y: number, wz: number, id: BlockId, overwriteOnlyAir: boolean) => void,
): void {
  const trunkTop = groundY + shape.trunkHeight;
  for (let y = groundY; y <= trunkTop; y++) {
    write(worldX, y, worldZ, shape.logId, false);
  }

  const r = shape.canopyRadius;
  if (shape.canopyStyle === "cone") {
    for (let layer = 0; layer <= r + 2; layer++) {
      const y = trunkTop - layer + 1;
      const layerRadius = Math.max(0, r - layer * 0.85);
      if (layerRadius <= 0) continue;
      for (let dx = -Math.ceil(layerRadius); dx <= Math.ceil(layerRadius); dx++) {
        for (let dz = -Math.ceil(layerRadius); dz <= Math.ceil(layerRadius); dz++) {
          const d = Math.hypot(dx, dz);
          if (d > layerRadius + 0.4) continue;
          if (rng() > shape.leafDensity) continue;
          write(worldX + dx, y, worldZ + dz, shape.leafId, true);
        }
      }
    }
  } else if (shape.canopyStyle === "umbrella") {
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        const d = Math.hypot(dx, dz);
        if (d > r + 0.3) continue;
        if (rng() > shape.leafDensity) continue;
        write(worldX + dx, trunkTop + 1, worldZ + dz, shape.leafId, true);
        if (d < r * 0.5 && rng() < 0.5) write(worldX + dx, trunkTop, worldZ + dz, shape.leafId, true);
      }
    }
  } else {
    // Blob canopy centered a couple blocks below the trunk top.
    const centerY = trunkTop - 1;
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dz = -r; dz <= r; dz++) {
          const d = Math.hypot(dx, dy * 1.15, dz);
          if (d > r + 0.3) continue;
          if (rng() > shape.leafDensity) continue;
          write(worldX + dx, centerY + dy, worldZ + dz, shape.leafId, true);
        }
      }
    }
  }
}

const TREE_MARGIN = 6;

/**
 * Decorates `chunk` with trees and small plants. Scans a margin beyond the
 * chunk's own columns so a tree rooted in a neighboring chunk can still
 * canopy into this one, and (like TerrainGenerator) recomputes everything
 * from world coordinates + seed alone so chunk generation order never
 * matters and neighbors can never disagree about a shared voxel.
 */
export function decorate(chunk: Chunk, columnInfo: ColumnInfoFn, seed: number = WORLD_SEED): void {
  const originX = chunk.worldOriginX;
  const originZ = chunk.worldOriginZ;

  const write = (wx: number, y: number, wz: number, id: BlockId, overwriteOnlyAir: boolean): void => {
    const lx = wx - originX;
    const lz = wz - originZ;
    if (lx < 0 || lx >= CHUNK_SIZE_X || lz < 0 || lz >= CHUNK_SIZE_Z || y < 0 || y >= CHUNK_HEIGHT) return;
    if (overwriteOnlyAir && chunk.get(lx, y, lz) !== BlockId.Air) return;
    chunk.set(lx, y, lz, id);
  };

  for (let wx = originX - TREE_MARGIN; wx < originX + CHUNK_SIZE_X + TREE_MARGIN; wx++) {
    for (let wz = originZ - TREE_MARGIN; wz < originZ + CHUNK_SIZE_Z + TREE_MARGIN; wz++) {
      const columnSeed = hashColumn(wx, wz, seed);
      const rng = mulberry32(columnSeed);
      const roll = rng();

      const info = columnInfo(wx, wz);
      if (info.underwater || info.steep) continue;

      const treeChance = info.shape.treeDensity / (CHUNK_SIZE_X * CHUNK_SIZE_Z);
      if (info.shape.treeLogs.length > 0 && roll < treeChance) {
        const speciesIndex = Math.floor(rng() * info.shape.treeLogs.length);
        const style: CanopyStyle =
          info.shape.biome === Biome.SequoiaForest || info.shape.biome === Biome.Mountain
            ? "cone"
            : info.shape.biome === Biome.Savanna
              ? "umbrella"
              : "blob";
        const shape = rollTreeShape(rng, info.shape.treeLogs[speciesIndex]!, info.shape.treeLeaves[speciesIndex]!, style);
        stampTree(wx, info.height + 1, wz, shape, rng, write);
        continue;
      }

      const plantChance = info.shape.plantDensity / (CHUNK_SIZE_X * CHUNK_SIZE_Z);
      if (info.shape.smallPlants.length > 0 && roll < treeChance + plantChance) {
        const plant = info.shape.smallPlants[Math.floor(rng() * info.shape.smallPlants.length)]!;
        write(wx, info.height + 1, wz, plant, true);
      }
    }
  }
}

function hashColumn(worldX: number, worldZ: number, seed: number): number {
  let h = seed ^ 0x2545f491;
  h = Math.imul(h ^ worldX, 0x27d4eb2f);
  h = Math.imul(h ^ worldZ, 0x85ebca6b);
  h ^= h >>> 15;
  return h >>> 0;
}
