import type { EditPayload, Item } from "../api";

export interface Delta {
  add: Set<string>;
  remove: Set<string>;
}

/** ratingKey -> pending tag changes. Treated as immutable. */
export type Edits = Map<string, Delta>;

export const emptyEdits = (): Edits => new Map();

function withDelta(edits: Edits, key: string, delta: Delta): Edits {
  const next = new Map(edits);
  if (delta.add.size === 0 && delta.remove.size === 0) next.delete(key);
  else next.set(key, delta);
  return next;
}

function cloneDelta(edits: Edits, key: string): Delta {
  const d = edits.get(key);
  return { add: new Set(d?.add), remove: new Set(d?.remove) };
}

/**
 * Queue adding `tag` to `item` (or undo a pending removal of it). `current` is
 * the item's current tag list for whichever tag type is being edited (call
 * sites pass `item.genres` today).
 */
export function queueAdd(
  edits: Edits,
  item: Item,
  tag: string,
  current: string[],
): Edits {
  const d = cloneDelta(edits, item.ratingKey);
  if (current.includes(tag)) d.remove.delete(tag);
  else d.add.add(tag);
  return withDelta(edits, item.ratingKey, d);
}

/**
 * Queue removing `tag` from `item` (or undo a pending add of it). `current` is
 * the item's current tag list for whichever tag type is being edited (call
 * sites pass `item.genres` today).
 */
export function queueRemove(
  edits: Edits,
  item: Item,
  tag: string,
  current: string[],
): Edits {
  const d = cloneDelta(edits, item.ratingKey);
  if (current.includes(tag)) d.remove.add(tag);
  else d.add.delete(tag);
  return withDelta(edits, item.ratingKey, d);
}

export function clearItem(edits: Edits, ratingKey: string): Edits {
  const next = new Map(edits);
  next.delete(ratingKey);
  return next;
}

export type MemberStatus = "kept" | "added" | "removed";

export interface ChannelEntry {
  item: Item;
  status: MemberStatus;
}

export interface Channel {
  name: string;
  entries: ChannelEntry[];
}

/** Tag-grouped view of the library with pending edits overlaid. */
export function buildChannels(
  items: Item[],
  edits: Edits,
  extraChannels: string[],
  getTags: (item: Item) => string[],
): Channel[] {
  const byGenre = new Map<string, ChannelEntry[]>();
  const bucket = (g: string) => {
    if (!byGenre.has(g)) byGenre.set(g, []);
    return byGenre.get(g)!;
  };
  for (const g of extraChannels) bucket(g);
  for (const item of items) {
    const d = edits.get(item.ratingKey);
    for (const g of getTags(item)) {
      bucket(g).push({ item, status: d?.remove.has(g) ? "removed" : "kept" });
    }
    for (const g of d?.add ?? []) {
      bucket(g).push({ item, status: "added" });
    }
  }
  return [...byGenre.entries()]
    .map(([name, entries]) => ({ name, entries }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Item's tag list with pending edits applied (for the title editor). */
export function effectiveTags(
  item: Item,
  edits: Edits,
  current: string[],
): string[] {
  const d = edits.get(item.ratingKey);
  if (!d) return current;
  return [...current.filter((g) => !d.remove.has(g)), ...d.add];
}

export function editCount(edits: Edits): number {
  let n = 0;
  for (const d of edits.values()) n += d.add.size + d.remove.size;
  return n;
}

export function toPayload(edits: Edits, items: Item[]): EditPayload[] {
  const titles = new Map(items.map((i) => [i.ratingKey, i.title]));
  return [...edits.entries()].map(([ratingKey, d]) => ({
    ratingKey,
    title: titles.get(ratingKey) ?? ratingKey,
    add: [...d.add],
    remove: [...d.remove],
  }));
}
