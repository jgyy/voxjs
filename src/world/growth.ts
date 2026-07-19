import { BlockId, GROWTH_STAGES } from "./blocks";
import { ChunkManager } from "./chunk-manager";

const GROWTH_INTERVAL_SECONDS = 18;

interface GrowthSite {
  x: number;
  y: number;
  z: number;
  timer: number;
}

/**
 * Bonus: "Growing plants (from seeds to maturity)". Only explicitly-planted
 * saplings/crops are tracked (registered on placement) rather than scanning
 * every loaded chunk for growable blocks, which would be far more expensive
 * for no benefit — nothing grows unless a player planted it.
 */
export class GrowthSimulation {
  private sites: GrowthSite[] = [];

  register(x: number, y: number, z: number): void {
    this.sites.push({ x, y, z, timer: GROWTH_INTERVAL_SECONDS * (0.7 + Math.random() * 0.6) });
  }

  tick(dt: number, chunkManager: ChunkManager): void {
    for (let i = this.sites.length - 1; i >= 0; i--) {
      const site = this.sites[i]!;
      site.timer -= dt;
      if (site.timer > 0) continue;

      const current = chunkManager.getBlock(site.x, site.y, site.z);
      const next = GROWTH_STAGES[current];
      if (next === undefined) {
        this.sites.splice(i, 1); // harvested, buried, or otherwise no longer growable
        continue;
      }

      if (current === BlockId.SaplingMid) {
        this.growTree(chunkManager, site.x, site.y, site.z);
        this.sites.splice(i, 1);
        continue;
      }

      chunkManager.setBlockDirect(site.x, site.y, site.z, next);
      if (next === BlockId.CropStage3) {
        this.sites.splice(i, 1); // fully grown, stop ticking until re-planted
      } else {
        site.timer = GROWTH_INTERVAL_SECONDS * (0.7 + Math.random() * 0.6);
      }
    }
  }

  private growTree(chunkManager: ChunkManager, x: number, y: number, z: number): void {
    const trunkHeight = 4 + Math.floor(Math.random() * 3);
    for (let dy = 0; dy < trunkHeight; dy++) chunkManager.setBlockDirect(x, y + dy, z, BlockId.OakLog);
    const canopyY = y + trunkHeight;
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        for (let dy = -1; dy <= 1; dy++) {
          if (Math.hypot(dx, dy * 1.3, dz) > 2.3) continue;
          if (chunkManager.getBlock(x + dx, canopyY + dy, z + dz) !== BlockId.Air) continue;
          chunkManager.setBlockDirect(x + dx, canopyY + dy, z + dz, BlockId.OakLeaves);
        }
      }
    }
  }

  get activeCount(): number {
    return this.sites.length;
  }
}
