import type { EditPayload, Item } from "../api";

export interface Delta {
  add: Set<string>;
  remove: Set<string>;
}

/** ratingKey -> pending genre changes. Treated as immutable. */
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

/** Queue adding `genre` to `item` (or undo a pending removal of it). */
export function queueAdd(edits: Edits, item: Item, genre: string): Edits {
  const d = cloneDelta(edits, item.ratingKey);
  if (item.genres.includes(genre)) d.remove.delete(genre);
  else d.add.add(genre);
  return withDelta(edits, item.ratingKey, d);
}

/** Queue removing `genre` from `item` (or undo a pending add of it). */
export function queueRemove(edits: Edits, item: Item, genre: string): Edits {
  const d = cloneDelta(edits, item.ratingKey);
  if (item.genres.includes(genre)) d.remove.add(genre);
  else d.add.delete(genre);
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
  genre: string;
  entries: ChannelEntry[];
}

/** Genre-grouped view of the library with pending edits overlaid. */
export function buildChannels(
  items: Item[],
  edits: Edits,
  extraChannels: string[],
): Channel[] {
  const byGenre = new Map<string, ChannelEntry[]>();
  const bucket = (g: string) => {
    if (!byGenre.has(g)) byGenre.set(g, []);
    return byGenre.get(g)!;
  };
  for (const g of extraChannels) bucket(g);
  for (const item of items) {
    const d = edits.get(item.ratingKey);
    for (const g of item.genres) {
      bucket(g).push({ item, status: d?.remove.has(g) ? "removed" : "kept" });
    }
    for (const g of d?.add ?? []) {
      bucket(g).push({ item, status: "added" });
    }
  }
  return [...byGenre.entries()]
    .map(([genre, entries]) => ({ genre, entries }))
    .sort((a, b) => a.genre.localeCompare(b.genre));
}

/** Item's genre list with pending edits applied (for the title editor). */
export function effectiveGenres(item: Item, edits: Edits): string[] {
  const d = edits.get(item.ratingKey);
  if (!d) return item.genres;
  return [...item.genres.filter((g) => !d.remove.has(g)), ...d.add];
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
