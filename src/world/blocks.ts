export const enum BlockId {
  Air = 0,
  Grass = 1,
  Dirt = 2,
  Stone = 3,
  Sand = 4,
  Snow = 5,
  Water = 6,
  ForestGrass = 7,
}

export interface BlockFaces {
  top: number;
  bottom: number;
  side: number;
}

// Index into the texture atlas (see texture-atlas.ts) per face, per block type.
export const BLOCK_FACES: Record<number, BlockFaces> = {
  [BlockId.Grass]: { top: 0, bottom: 2, side: 1 },
  [BlockId.Dirt]: { top: 2, bottom: 2, side: 2 },
  [BlockId.Stone]: { top: 3, bottom: 3, side: 3 },
  [BlockId.Sand]: { top: 4, bottom: 4, side: 4 },
  [BlockId.Snow]: { top: 5, bottom: 2, side: 5 },
  [BlockId.Water]: { top: 6, bottom: 6, side: 6 },
  [BlockId.ForestGrass]: { top: 7, bottom: 2, side: 8 },
};

export function isOpaque(id: number): boolean {
  return id !== BlockId.Air;
}
