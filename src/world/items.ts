// Non-block inventory items (tools), kept numerically disjoint from BlockId
// (which tops out well under 1000) so a single hotbar slot can hold either.
export const ItemId = {
  Bow: 1000,
  Arrow: 1001,
} as const;

export function isToolItem(id: number): boolean {
  return id === ItemId.Bow || id === ItemId.Arrow;
}

export function itemDisplayName(id: number): string | null {
  if (id === ItemId.Bow) return "Bow";
  if (id === ItemId.Arrow) return "Arrow";
  return null;
}
