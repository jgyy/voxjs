export const enum BlockId {
  Air = 0,
  Grass = 1,
  Dirt = 2,
  Stone = 3,
  Sand = 4,
  Snow = 5,
  Water = 6,
  ForestGrass = 7,
  OakLog = 8,
  OakLeaves = 9,
  SequoiaLog = 10,
  SequoiaLeaves = 11,
  AcaciaLog = 12,
  AcaciaLeaves = 13,
  JungleLog = 14,
  JungleLeaves = 15,
  TallGrass = 16,
  FlowerRed = 17,
  FlowerYellow = 18,
  Mushroom = 19,
  Cactus = 20,
  CoalOre = 21,
  IronOre = 22,
  GoldOre = 23,
  DiamondOre = 24,
  RedSand = 25,
  Mud = 26,
  Gravel = 27,
  SavannaGrass = 28,
  Planks = 29,
  CraftingTable = 30,
  Furnace = 31,
  Cobblestone = 32,
  Obsidian = 33,
  NetherPortal = 34,
  Cloud = 35,
  SaplingYoung = 36,
  SaplingMid = 37,
  CropStage0 = 38,
  CropStage1 = 39,
  CropStage2 = 40,
  CropStage3 = 41,
  Netherrack = 42,
  NetherGoldOre = 43,
  Basalt = 44,
  Bedrock = 45,
}

export const BLOCK_ID_MAX = 46;

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
  [BlockId.OakLog]: { top: 9, bottom: 9, side: 10 },
  [BlockId.OakLeaves]: { top: 11, bottom: 11, side: 11 },
  [BlockId.SequoiaLog]: { top: 12, bottom: 12, side: 13 },
  [BlockId.SequoiaLeaves]: { top: 14, bottom: 14, side: 14 },
  [BlockId.AcaciaLog]: { top: 9, bottom: 9, side: 15 },
  [BlockId.AcaciaLeaves]: { top: 16, bottom: 16, side: 16 },
  [BlockId.JungleLog]: { top: 12, bottom: 12, side: 17 },
  [BlockId.JungleLeaves]: { top: 18, bottom: 18, side: 18 },
  [BlockId.TallGrass]: { top: 19, bottom: 19, side: 19 },
  [BlockId.FlowerRed]: { top: 20, bottom: 20, side: 20 },
  [BlockId.FlowerYellow]: { top: 21, bottom: 21, side: 21 },
  [BlockId.Mushroom]: { top: 22, bottom: 22, side: 22 },
  [BlockId.Cactus]: { top: 23, bottom: 23, side: 24 },
  [BlockId.CoalOre]: { top: 25, bottom: 25, side: 25 },
  [BlockId.IronOre]: { top: 26, bottom: 26, side: 26 },
  [BlockId.GoldOre]: { top: 27, bottom: 27, side: 27 },
  [BlockId.DiamondOre]: { top: 28, bottom: 28, side: 28 },
  [BlockId.RedSand]: { top: 29, bottom: 29, side: 29 },
  [BlockId.Mud]: { top: 30, bottom: 30, side: 30 },
  [BlockId.Gravel]: { top: 31, bottom: 31, side: 31 },
  [BlockId.SavannaGrass]: { top: 32, bottom: 2, side: 33 },
  [BlockId.Planks]: { top: 34, bottom: 34, side: 34 },
  [BlockId.CraftingTable]: { top: 35, bottom: 34, side: 36 },
  [BlockId.Furnace]: { top: 37, bottom: 37, side: 38 },
  [BlockId.Cobblestone]: { top: 39, bottom: 39, side: 39 },
  [BlockId.Obsidian]: { top: 40, bottom: 40, side: 40 },
  [BlockId.NetherPortal]: { top: 41, bottom: 41, side: 41 },
  [BlockId.Cloud]: { top: 42, bottom: 42, side: 42 },
  [BlockId.SaplingYoung]: { top: 43, bottom: 43, side: 43 },
  [BlockId.SaplingMid]: { top: 44, bottom: 44, side: 44 },
  [BlockId.CropStage0]: { top: 45, bottom: 45, side: 45 },
  [BlockId.CropStage1]: { top: 46, bottom: 46, side: 46 },
  [BlockId.CropStage2]: { top: 47, bottom: 47, side: 47 },
  [BlockId.CropStage3]: { top: 48, bottom: 48, side: 48 },
  [BlockId.Netherrack]: { top: 49, bottom: 49, side: 49 },
  [BlockId.NetherGoldOre]: { top: 50, bottom: 50, side: 50 },
  [BlockId.Basalt]: { top: 51, bottom: 51, side: 52 },
  [BlockId.Bedrock]: { top: 53, bottom: 53, side: 53 },
};

/** Blocks rendered as two crossed quads instead of a full cube (no occlusion, walkable). */
const BILLBOARD_BLOCKS = new Set<number>([
  BlockId.TallGrass,
  BlockId.FlowerRed,
  BlockId.FlowerYellow,
  BlockId.Mushroom,
  BlockId.SaplingYoung,
  BlockId.SaplingMid,
  BlockId.CropStage0,
  BlockId.CropStage1,
  BlockId.CropStage2,
  BlockId.CropStage3,
]);

/** Blocks drawn in the alpha-blended transparent pass, after opaque geometry. */
const TRANSPARENT_BLOCKS = new Set<number>([BlockId.Water, BlockId.Cloud, BlockId.NetherPortal]);

/** Non-solid for player/mob collision purposes (can walk/swim through). */
const NON_SOLID_BLOCKS = new Set<number>([
  BlockId.Air,
  BlockId.Water,
  BlockId.Cloud,
  BlockId.NetherPortal,
  ...BILLBOARD_BLOCKS,
]);

/** Blocks that can grow (see world/growth.ts), mapped to their next stage (0 = removed/converts to a tree). */
export const GROWTH_STAGES: Partial<Record<number, number>> = {
  [BlockId.SaplingYoung]: BlockId.SaplingMid,
  [BlockId.SaplingMid]: BlockId.Air, // Air here is a sentinel meaning "spawn a tree in my place"
  [BlockId.CropStage0]: BlockId.CropStage1,
  [BlockId.CropStage1]: BlockId.CropStage2,
  [BlockId.CropStage2]: BlockId.CropStage3,
};

export function isAir(id: number): boolean {
  return id === BlockId.Air;
}

/** Whether this block occludes a neighboring face (used for mesher hidden-face culling). */
export function isOpaque(id: number): boolean {
  if (id === BlockId.Air) return false;
  if (BILLBOARD_BLOCKS.has(id)) return false;
  return !TRANSPARENT_BLOCKS.has(id);
}

export function isTransparentRender(id: number): boolean {
  return TRANSPARENT_BLOCKS.has(id);
}

export function isBillboard(id: number): boolean {
  return BILLBOARD_BLOCKS.has(id);
}

export function isSolid(id: number): boolean {
  return !NON_SOLID_BLOCKS.has(id);
}

export function isLiquid(id: number): boolean {
  return id === BlockId.Water;
}

export function isOre(id: number): boolean {
  return (
    id === BlockId.CoalOre || id === BlockId.IronOre || id === BlockId.GoldOre || id === BlockId.DiamondOre ||
    id === BlockId.NetherGoldOre
  );
}

/** What a player picks up when breaking this block — "just like in Minecraft" 1:1 for now. */
export function dropFor(id: number): BlockId {
  if (id === BlockId.Stone) return BlockId.Cobblestone;
  return id as BlockId;
}

/** Blocks a player can carry in the hotbar and place back into the world. */
export const PLACEABLE_BLOCKS: BlockId[] = [
  BlockId.Grass,
  BlockId.Dirt,
  BlockId.Stone,
  BlockId.Cobblestone,
  BlockId.Sand,
  BlockId.Snow,
  BlockId.OakLog,
  BlockId.Planks,
  BlockId.CraftingTable,
  BlockId.Furnace,
  BlockId.Obsidian,
  BlockId.SaplingYoung,
  BlockId.CropStage0,
  BlockId.TallGrass,
  BlockId.Water,
];
