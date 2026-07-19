import { BlockId } from "./blocks";
import { ChunkManager } from "./chunk-manager";

const MAX_SPREAD_DISTANCE = 4;
const TICK_INTERVAL_SECONDS = 0.12;
const UPDATES_PER_TICK = 24;

interface FlowCell {
  x: number;
  y: number;
  z: number;
  distanceFromSource: number;
}

/**
 * Bonus: "Realistic water simulation (dynamic flow and spreading)". Only
 * player-placed water sources are simulated (registered via addSource) —
 * naturally-generated lakes/oceans/rivers stay static terrain, exactly like
 * the rest of the world, so this never causes the whole ocean to "activate".
 * Simplified vs. real Minecraft (no partial fill levels), but genuinely
 * dynamic: water falls first, then spreads horizontally up to a limited
 * distance from its source, one flood-fill step at a time.
 */
export class WaterSimulation {
  private queue: FlowCell[] = [];
  private timer = 0;

  addSource(x: number, y: number, z: number): void {
    this.queue.push({ x, y, z, distanceFromSource: 0 });
  }

  tick(dt: number, chunkManager: ChunkManager): void {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = TICK_INTERVAL_SECONDS;

    let budget = UPDATES_PER_TICK;
    const next: FlowCell[] = [];
    while (this.queue.length > 0 && budget > 0) {
      const cell = this.queue.shift()!;
      budget--;

      const below = chunkManager.getBlock(cell.x, cell.y - 1, cell.z);
      if (below === BlockId.Air) {
        if (chunkManager.placeBlock(cell.x, cell.y - 1, cell.z, BlockId.Water)) {
          next.push({ x: cell.x, y: cell.y - 1, z: cell.z, distanceFromSource: 0 }); // falling resets spread distance
        }
        continue; // falling water doesn't also spread sideways this step
      }

      if (cell.distanceFromSource >= MAX_SPREAD_DISTANCE) continue;

      const neighbors: [number, number][] = [
        [cell.x + 1, cell.z],
        [cell.x - 1, cell.z],
        [cell.x, cell.z + 1],
        [cell.x, cell.z - 1],
      ];
      for (const [nx, nz] of neighbors) {
        if (chunkManager.getBlock(nx, cell.y, nz) !== BlockId.Air) continue;
        if (chunkManager.placeBlock(nx, cell.y, nz, BlockId.Water)) {
          next.push({ x: nx, y: cell.y, z: nz, distanceFromSource: cell.distanceFromSource + 1 });
        }
      }
    }
    this.queue.push(...next);
  }

  get pendingCount(): number {
    return this.queue.length;
  }
}
