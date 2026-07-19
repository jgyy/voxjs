import { mulberry32 } from "../util/rng";
import { CHUNK_HEIGHT, CHUNK_SIZE_X, CHUNK_SIZE_Z, SEA_LEVEL } from "../config";
import { BlockId } from "./blocks";
import { Chunk } from "./chunk";

const CELL_SIZE = 220;
const VILLAGE_CHANCE = 0.4;
const VILLAGE_RADIUS = 30;

interface HousePlan {
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  doorOnX: boolean;
  cobble: boolean;
}

interface VillagePlan {
  houses: HousePlan[];
}

function hashCell(cellX: number, cellZ: number, seed: number): () => number {
  let h = seed ^ 0x1337c0de;
  h = Math.imul(h ^ cellX, 0x27d4eb2f);
  h = Math.imul(h ^ cellZ, 0x85ebca6b);
  return mulberry32(h >>> 0);
}

function villagePlanForCell(cellX: number, cellZ: number, seed: number): VillagePlan | null {
  const rng = hashCell(cellX, cellZ, seed);
  if (rng() > VILLAGE_CHANCE) return null;

  const centerX = cellX * CELL_SIZE + rng() * CELL_SIZE;
  const centerZ = cellZ * CELL_SIZE + rng() * CELL_SIZE;
  const houseCount = 3 + Math.floor(rng() * 4);
  const houses: HousePlan[] = [];
  for (let i = 0; i < houseCount; i++) {
    const angle = rng() * Math.PI * 2;
    const dist = 6 + rng() * VILLAGE_RADIUS * 0.75;
    houses.push({
      x: Math.round(centerX + Math.cos(angle) * dist),
      z: Math.round(centerZ + Math.sin(angle) * dist),
      width: 5 + Math.floor(rng() * 3),
      depth: 5 + Math.floor(rng() * 3),
      height: 3 + Math.floor(rng() * 2),
      doorOnX: rng() < 0.5,
      cobble: rng() < 0.5,
    });
  }
  return { houses };
}

function stampHouse(
  chunk: Chunk,
  write: (wx: number, y: number, wz: number, id: BlockId) => void,
  house: HousePlan,
  groundY: number,
): void {
  const x0 = house.x - Math.floor(house.width / 2);
  const z0 = house.z - Math.floor(house.depth / 2);
  const x1 = x0 + house.width - 1;
  const z1 = z0 + house.depth - 1;
  const wallBlock = house.cobble ? BlockId.Cobblestone : BlockId.Planks;
  const doorX = house.x;
  const doorZ = house.z;

  for (let x = x0; x <= x1; x++) {
    for (let z = z0; z <= z1; z++) {
      write(x, groundY, z, BlockId.Planks);
    }
  }

  for (let x = x0; x <= x1; x++) {
    for (let z = z0; z <= z1; z++) {
      const isWall = x === x0 || x === x1 || z === z0 || z === z1;
      if (!isWall) continue;
      for (let dy = 1; dy <= house.height; dy++) {
        const isDoor = house.doorOnX ? x === doorX && (z === z0 || z === z1) && dy <= 2 : z === doorZ && (x === x0 || x === x1) && dy <= 2;
        write(x, groundY + dy, z, isDoor ? BlockId.Air : wallBlock);
      }
    }
  }

  const roofY = groundY + house.height + 1;
  for (let x = x0 - 1; x <= x1 + 1; x++) {
    for (let z = z0 - 1; z <= z1 + 1; z++) write(x, roofY, z, BlockId.Planks);
  }
  for (let x = x0; x <= x1; x++) {
    for (let z = z0; z <= z1; z++) write(x, roofY + 1, z, BlockId.OakLog);
  }

  write(house.x, groundY + 1, z0 - 1, BlockId.TallGrass); // a small decorative touch by the door
  void chunk;
}

/** Bonus: "Procedurally generated villages." Cell-hashed like ore veins (world/ores.ts) so only a
 * handful of village cells overlap any given chunk — no expensive wide-margin scan needed. */
export function decorateVillages(
  chunk: Chunk,
  heightAt: (worldX: number, worldZ: number) => number,
  isSteepAt: (worldX: number, worldZ: number) => boolean,
  seed: number,
): void {
  const originX = chunk.worldOriginX;
  const originZ = chunk.worldOriginZ;

  const write = (wx: number, y: number, wz: number, id: BlockId): void => {
    const lx = wx - originX;
    const lz = wz - originZ;
    if (lx < 0 || lx >= CHUNK_SIZE_X || lz < 0 || lz >= CHUNK_SIZE_Z || y < 0 || y >= CHUNK_HEIGHT) return;
    chunk.set(lx, y, lz, id);
  };

  const minCellX = Math.floor((originX - VILLAGE_RADIUS) / CELL_SIZE);
  const maxCellX = Math.floor((originX + CHUNK_SIZE_X + VILLAGE_RADIUS) / CELL_SIZE);
  const minCellZ = Math.floor((originZ - VILLAGE_RADIUS) / CELL_SIZE);
  const maxCellZ = Math.floor((originZ + CHUNK_SIZE_Z + VILLAGE_RADIUS) / CELL_SIZE);

  for (let cx = minCellX; cx <= maxCellX; cx++) {
    for (let cz = minCellZ; cz <= maxCellZ; cz++) {
      const plan = villagePlanForCell(cx, cz, seed);
      if (!plan) continue;
      for (const house of plan.houses) {
        const halfW = Math.ceil(house.width / 2) + 1;
        const halfD = Math.ceil(house.depth / 2) + 1;
        const overlaps =
          house.x + halfW >= originX &&
          house.x - halfW < originX + CHUNK_SIZE_X &&
          house.z + halfD >= originZ &&
          house.z - halfD < originZ + CHUNK_SIZE_Z;
        if (!overlaps) continue;

        const groundY = heightAt(house.x, house.z);
        if (groundY <= SEA_LEVEL + 1 || isSteepAt(house.x, house.z)) continue;
        stampHouse(chunk, write, house, groundY);
      }
    }
  }
}
