import { BlockId } from "./blocks";

export const enum Biome {
  Plains,
  Forest,
  SequoiaForest,
  Desert,
  Canyon,
  Swamp,
  Savanna,
  SnowyPlains,
  Mountain,
  Island,
}

export const BIOME_COUNT = 9; // Island (index 9) is a special override, not part of the climate blend

export interface BiomeShape {
  biome: Biome;
  /** Target point in (temperature, moisture, erosion) climate space, each roughly in [-1, 1]. */
  target: [number, number, number];
  /** Baseline column height (blocks above y=0) before this biome's detail noise is added. */
  base: number;
  /** Amplitude of this biome's own detail/roughness contribution. */
  amplitude: number;
  /** "ridged" biomes (canyon, mountain) carve/spike instead of rolling smoothly. */
  ridged?: boolean;
  /** Canyon-style biomes subtract instead of add (carve valleys/mesas). */
  carve?: boolean;
  topBlock: BlockId;
  fillBlock: BlockId;
  beachBlock: BlockId;
  /** Vegetation table consumed by the decorator (task: trees + small plants). */
  treeLogs: BlockId[];
  treeLeaves: BlockId[];
  treeDensity: number; // trees per chunk column, expected value
  smallPlants: BlockId[];
  plantDensity: number;
}

// Nine climate biomes blended continuously by distance-in-climate-space (see generator.ts),
// plus Island (a coastline override, see below) — ten unique biomes total, well above the
// mandatory minimum of five, each with distinct geography/elevation/vegetation per V.1.
export const BIOME_SHAPES: BiomeShape[] = [
  {
    biome: Biome.Plains,
    target: [0.0, -0.1, -0.6],
    base: 68,
    amplitude: 6,
    topBlock: BlockId.Grass,
    fillBlock: BlockId.Dirt,
    beachBlock: BlockId.Sand,
    treeLogs: [BlockId.OakLog],
    treeLeaves: [BlockId.OakLeaves],
    treeDensity: 0.4,
    smallPlants: [BlockId.TallGrass, BlockId.FlowerRed, BlockId.FlowerYellow],
    plantDensity: 3.5,
  },
  {
    biome: Biome.Forest,
    target: [0.05, 0.35, -0.3],
    base: 70,
    amplitude: 10,
    topBlock: BlockId.ForestGrass,
    fillBlock: BlockId.Dirt,
    beachBlock: BlockId.Sand,
    treeLogs: [BlockId.OakLog],
    treeLeaves: [BlockId.OakLeaves],
    treeDensity: 3.2,
    smallPlants: [BlockId.TallGrass, BlockId.Mushroom],
    plantDensity: 2.5,
  },
  {
    biome: Biome.SequoiaForest,
    target: [-0.25, 0.45, 0.15],
    base: 76,
    amplitude: 16,
    topBlock: BlockId.ForestGrass,
    fillBlock: BlockId.Dirt,
    beachBlock: BlockId.Gravel,
    treeLogs: [BlockId.SequoiaLog],
    treeLeaves: [BlockId.SequoiaLeaves],
    treeDensity: 2.6,
    smallPlants: [BlockId.Mushroom, BlockId.TallGrass],
    plantDensity: 1.5,
  },
  {
    biome: Biome.Desert,
    target: [0.65, -0.6, -0.4],
    base: 66,
    amplitude: 8,
    topBlock: BlockId.Sand,
    fillBlock: BlockId.Sand,
    beachBlock: BlockId.Sand,
    treeLogs: [],
    treeLeaves: [],
    treeDensity: 0,
    smallPlants: [BlockId.Cactus],
    plantDensity: 0.5,
  },
  {
    biome: Biome.Canyon,
    target: [0.55, -0.5, 0.8],
    base: 78,
    amplitude: 46,
    ridged: true,
    carve: true,
    topBlock: BlockId.RedSand,
    fillBlock: BlockId.Stone,
    beachBlock: BlockId.RedSand,
    treeLogs: [],
    treeLeaves: [],
    treeDensity: 0,
    smallPlants: [],
    plantDensity: 0,
  },
  {
    biome: Biome.Swamp,
    target: [0.2, 0.7, -0.75],
    base: 63,
    amplitude: 2.5,
    topBlock: BlockId.Mud,
    fillBlock: BlockId.Mud,
    beachBlock: BlockId.Mud,
    treeLogs: [BlockId.JungleLog],
    treeLeaves: [BlockId.JungleLeaves],
    treeDensity: 1.2,
    smallPlants: [BlockId.Mushroom, BlockId.TallGrass],
    plantDensity: 2,
  },
  {
    biome: Biome.Savanna,
    target: [0.55, -0.2, -0.5],
    base: 69,
    amplitude: 5,
    topBlock: BlockId.SavannaGrass,
    fillBlock: BlockId.Dirt,
    beachBlock: BlockId.Sand,
    treeLogs: [BlockId.AcaciaLog],
    treeLeaves: [BlockId.AcaciaLeaves],
    treeDensity: 0.5,
    smallPlants: [BlockId.TallGrass],
    plantDensity: 1.5,
  },
  {
    biome: Biome.SnowyPlains,
    target: [-0.7, 0.0, -0.5],
    base: 70,
    amplitude: 7,
    topBlock: BlockId.Snow,
    fillBlock: BlockId.Dirt,
    beachBlock: BlockId.Snow,
    treeLogs: [BlockId.SequoiaLog],
    treeLeaves: [BlockId.SequoiaLeaves],
    treeDensity: 0.6,
    smallPlants: [],
    plantDensity: 0,
  },
  {
    biome: Biome.Mountain,
    target: [-0.15, 0.05, 0.9],
    base: 92,
    amplitude: 85,
    ridged: true,
    topBlock: BlockId.Stone,
    fillBlock: BlockId.Stone,
    beachBlock: BlockId.Gravel,
    treeLogs: [BlockId.SequoiaLog],
    treeLeaves: [BlockId.SequoiaLeaves],
    treeDensity: 0.8,
    smallPlants: [],
    plantDensity: 0,
  },
];

export const ISLAND_SHAPE: BiomeShape = {
  biome: Biome.Island,
  target: [0, 0, 0],
  base: 64,
  amplitude: 6,
  topBlock: BlockId.Sand,
  fillBlock: BlockId.Sand,
  beachBlock: BlockId.Sand,
  treeLogs: [BlockId.JungleLog],
  treeLeaves: [BlockId.JungleLeaves],
  treeDensity: 1,
  smallPlants: [BlockId.TallGrass],
  plantDensity: 1,
};

export function biomeShapeFor(biome: Biome): BiomeShape {
  return biome === Biome.Island ? ISLAND_SHAPE : BIOME_SHAPES[biome]!;
}
