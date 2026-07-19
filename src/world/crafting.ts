import { BlockId } from "./blocks";
import { Inventory } from "./inventory";
import { ItemId } from "./items";

export interface Recipe {
  id: string;
  inputs: { itemId: number; count: number }[];
  output: { itemId: number; count: number };
  label: string;
}

// Bonus: "Crafting system". Kept small and Minecraft-flavored rather than a
// full tech tree — enough to turn raw blocks into useful ones and to make
// the bow & arrow (also bonus) obtainable through play.
export const RECIPES: Recipe[] = [
  { id: "planks", inputs: [{ itemId: BlockId.OakLog, count: 1 }], output: { itemId: BlockId.Planks, count: 4 }, label: "Log -> 4 Planks" },
  { id: "table", inputs: [{ itemId: BlockId.Planks, count: 4 }], output: { itemId: BlockId.CraftingTable, count: 1 }, label: "4 Planks -> Crafting Table" },
  { id: "furnace", inputs: [{ itemId: BlockId.Cobblestone, count: 8 }], output: { itemId: BlockId.Furnace, count: 1 }, label: "8 Cobblestone -> Furnace" },
  { id: "bow", inputs: [{ itemId: BlockId.Planks, count: 3 }], output: { itemId: ItemId.Bow, count: 1 }, label: "3 Planks -> Bow" },
  {
    id: "arrows",
    inputs: [
      { itemId: BlockId.Cobblestone, count: 1 },
      { itemId: BlockId.OakLog, count: 1 },
    ],
    output: { itemId: ItemId.Arrow, count: 4 },
    label: "Cobblestone + Log -> 4 Arrows",
  },
];

export function canCraft(inventory: Inventory, recipe: Recipe): boolean {
  return recipe.inputs.every((input) => inventory.countOf(input.itemId) >= input.count);
}

export function craft(inventory: Inventory, recipe: Recipe): boolean {
  if (!canCraft(inventory, recipe)) return false;
  for (const input of recipe.inputs) inventory.remove(input.itemId, input.count);
  inventory.add(recipe.output.itemId, recipe.output.count);
  return true;
}
