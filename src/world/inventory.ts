import { HOTBAR_SIZE } from "../config";
import { BlockId, PLACEABLE_BLOCKS } from "./blocks";
import { ItemId } from "./items";

export interface HotbarSlot {
  itemId: number; // a BlockId, or a non-block ItemId (bow, arrow, ...)
  count: number;
}

/**
 * Bonus/mandatory V.1: "pick up blocks after destroying them ... and place
 * them wherever you want". A simple fixed hotbar holding either blocks or
 * tool items (see world/items.ts, world/crafting.ts for the bonus crafting
 * system that produces some of them).
 */
export class Inventory {
  slots: (HotbarSlot | null)[] = new Array(HOTBAR_SIZE).fill(null);
  selected = 0;

  add(itemId: number, count = 1): void {
    for (const slot of this.slots) {
      if (slot && slot.itemId === itemId) {
        slot.count += count;
        return;
      }
    }
    const emptyIndex = this.slots.findIndex((s) => s === null);
    if (emptyIndex !== -1) {
      this.slots[emptyIndex] = { itemId, count };
    }
  }

  /** Total held count across all slots for a given item (used by crafting to check requirements). */
  countOf(itemId: number): number {
    return this.slots.reduce((sum, s) => sum + (s && s.itemId === itemId ? s.count : 0), 0);
  }

  /** Removes up to `count` of an item across slots (least-recently-first). Returns false if insufficient. */
  remove(itemId: number, count: number): boolean {
    if (this.countOf(itemId) < count) return false;
    let remaining = count;
    for (let i = 0; i < this.slots.length && remaining > 0; i++) {
      const slot = this.slots[i];
      if (!slot || slot.itemId !== itemId) continue;
      const take = Math.min(slot.count, remaining);
      slot.count -= take;
      remaining -= take;
      if (slot.count === 0) this.slots[i] = null;
    }
    return true;
  }

  selectedItem(): number | null {
    const slot = this.slots[this.selected];
    return slot ? slot.itemId : null;
  }

  /** Consumes one of the currently selected item, clearing the slot if it hits zero. Returns false if empty. */
  consumeSelected(): boolean {
    const slot = this.slots[this.selected];
    if (!slot || slot.count <= 0) return false;
    slot.count--;
    if (slot.count === 0) this.slots[this.selected] = null;
    return true;
  }

  selectSlot(index: number): void {
    if (index >= 0 && index < this.slots.length) this.selected = index;
  }

  scrollSelect(delta: number): void {
    const n = this.slots.length;
    this.selected = ((this.selected + delta) % n + n) % n;
  }

  /** Starter blocks so placement/crafting/water-sim are demonstrable immediately, without a long grind.
   * Deliberately leaves a couple of hotbar slots empty — a fully-packed bar would silently discard
   * whatever a freshly-crafted Planks/Table/Furnace stack has nowhere to land in (see add()). */
  seedStarterBlocks(): void {
    const starters: [number, number][] = [
      [BlockId.OakLog, 16],
      [BlockId.Cobblestone, 32],
      [BlockId.Water, 4],
      [BlockId.SaplingYoung, 4],
      [BlockId.Obsidian, 12],
      [ItemId.Bow, 1],
      [ItemId.Arrow, 16],
    ];
    starters.forEach(([itemId, count], i) => {
      if (i < this.slots.length) this.slots[i] = { itemId, count };
    });
  }
}

export function isPlaceable(id: number): boolean {
  return PLACEABLE_BLOCKS.includes(id as BlockId);
}
