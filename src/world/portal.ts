import { BlockId } from "./blocks";
import { ChunkManager } from "./chunk-manager";

const FRAME_WIDTH = 2; // interior width
const FRAME_HEIGHT = 3; // interior height
const SEARCH_RADIUS = 4;

function checkFrame(chunkManager: ChunkManager, x0: number, y0: number, z0: number, alongX: boolean): boolean {
  const outerW = FRAME_WIDTH + 2;
  const outerH = FRAME_HEIGHT + 2;

  for (let i = 0; i < outerW; i++) {
    for (let j = 0; j < outerH; j++) {
      const isBorder = i === 0 || i === outerW - 1 || j === 0 || j === outerH - 1;
      const x = alongX ? x0 + i : x0;
      const z = alongX ? z0 : z0 + i;
      const y = y0 + j;
      const block = chunkManager.getBlock(x, y, z);
      if (isBorder) {
        if (block !== BlockId.Obsidian) return false;
      } else if (block !== BlockId.Air) {
        return false;
      }
    }
  }
  return true;
}

function fillFrame(chunkManager: ChunkManager, x0: number, y0: number, z0: number, alongX: boolean): void {
  for (let i = 1; i <= FRAME_WIDTH; i++) {
    for (let j = 1; j <= FRAME_HEIGHT; j++) {
      const x = alongX ? x0 + i : x0;
      const z = alongX ? z0 : z0 + i;
      chunkManager.setBlockDirect(x, y0 + j, z, BlockId.NetherPortal);
    }
  }
}

/** Bonus: obsidian-frame nether portal detection, tried whenever the player places obsidian. */
export function tryActivatePortalNear(chunkManager: ChunkManager, px: number, py: number, pz: number): boolean {
  for (let alongXNum = 0; alongXNum <= 1; alongXNum++) {
    const alongX = alongXNum === 1;
    for (let dx = -SEARCH_RADIUS; dx <= 1; dx++) {
      for (let dy = -SEARCH_RADIUS; dy <= 1; dy++) {
        const x0 = alongX ? px + dx : px;
        const z0 = alongX ? pz : pz + dx;
        const y0 = py + dy;
        if (checkFrame(chunkManager, x0, y0, z0, alongX)) {
          fillFrame(chunkManager, x0, y0, z0, alongX);
          return true;
        }
      }
    }
  }
  return false;
}

export function isPortalBlock(id: number): boolean {
  return id === BlockId.NetherPortal;
}

/** Auto-builds a complete obsidian-framed, already-lit portal (border + interior) — used to guarantee
 * a return trip exists on the far side of a teleport, same as vanilla Minecraft does. */
export function buildFullPortalFrame(chunkManager: ChunkManager, x0: number, y0: number, z0: number, alongX: boolean): void {
  const outerW = FRAME_WIDTH + 2;
  const outerH = FRAME_HEIGHT + 2;
  for (let i = 0; i < outerW; i++) {
    for (let j = 0; j < outerH; j++) {
      const isBorder = i === 0 || i === outerW - 1 || j === 0 || j === outerH - 1;
      const x = alongX ? x0 + i : x0;
      const z = alongX ? z0 : z0 + i;
      chunkManager.setBlockDirect(x, y0 + j, z, isBorder ? BlockId.Obsidian : BlockId.NetherPortal);
    }
  }
}
