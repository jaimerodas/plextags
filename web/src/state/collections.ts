import type {
  CollectionDeletePayload,
  CollectionUpdatePayload,
  EditPayload,
  Item,
  PlexCollection,
} from "../api";
import type { Channel, Edits } from "./edits";
import { buildChannels, editCount, toPayload } from "./edits";

/**
 * Every rule about staged collection work lives here — components stage and
 * render, they never decide. The same rule enforced in two views drifts the
 * moment one of them grows a special case, which is exactly how a "rename"
 * turns into an untag+retag that drops the poster and the manual sort order.
 *
 * Two shapes make up a staged change set:
 *
 *   - membership, an `Edits` map (ratingKey -> {add, remove}) whose tags are
 *     collection *titles*, reusing the genre machinery wholesale, and
 *   - `CollectionOps`, the server-side operations that have no per-item tag:
 *     creates, deletes, renames, summaries.
 *
 * Membership is always keyed by the title Plex knows *right now*, never by a
 * staged new name. The backend applies deletes first, then membership tags,
 * then renames and summaries last, precisely so those tags still resolve.
 *
 * Plex has no "create empty collection" call — one springs into existence when
 * its first member is tagged. A staged create with no members therefore cannot
 * be sent at all; it renders, it warns, and it silently drops out of the
 * payload.
 */

export interface CollectionOps {
  /** Staged new collection titles, trimmed, in the order they were added. */
  create: string[];
  /** ratingKeys staged for deletion. */
  remove: Set<string>;
  /** ratingKey -> new title. */
  rename: Map<string, string>;
  /** ratingKey -> new summary. */
  summary: Map<string, string>;
}

export const emptyOps = (): CollectionOps => ({
  create: [],
  remove: new Set(),
  rename: new Map(),
  summary: new Map(),
});

const norm = (s: string) => s.trim().toLowerCase();

/**
 * Titles that a new or renamed collection may not take.
 *
 * Case-insensitive because Plex matches tags loosely: adding "marvel" next to
 * an existing "Marvel" does not create a second collection, it quietly folds
 * the members into the first one, and the UI would keep showing two cards over
 * a single server object.
 *
 * Deliberately conservative in two places:
 *
 *   - a collection with a pending rename still reserves its *server* title,
 *     because renames apply last and that title stays live for the whole
 *     membership phase, and
 *   - a collection staged for deletion still reserves its title too. Deletes
 *     do run first, so re-creating the name would work — until the user hits
 *     undo on the delete, at which point the two silently merge.
 */
function takenTitles(
  existing: PlexCollection[],
  ops: CollectionOps,
  exclude: { ratingKey?: string; createTitle?: string },
): Set<string> {
  const taken = new Set<string>();
  for (const c of existing) {
    if (exclude.ratingKey && c.ratingKey === exclude.ratingKey) continue;
    taken.add(norm(c.title));
  }
  for (const [ratingKey, title] of ops.rename) {
    if (exclude.ratingKey && ratingKey === exclude.ratingKey) continue;
    taken.add(norm(title));
  }
  for (const title of ops.create) {
    if (exclude.createTitle && norm(title) === norm(exclude.createTitle))
      continue;
    taken.add(norm(title));
  }
  return taken;
}

/** Drop `tag` from every pending delta, dropping deltas that go empty. */
function dropTag(edits: Edits, tag: string, from: "add" | "both"): Edits {
  const next: Edits = new Map();
  for (const [ratingKey, d] of edits) {
    const add = new Set(d.add);
    const remove = new Set(d.remove);
    add.delete(tag);
    if (from === "both") remove.delete(tag);
    if (add.size === 0 && remove.size === 0) continue;
    next.set(ratingKey, { add, remove });
  }
  return next;
}

/** Move pending adds of `from` onto `to`, for staged creates being renamed. */
function rekeyAdds(edits: Edits, from: string, to: string): Edits {
  const next: Edits = new Map();
  for (const [ratingKey, d] of edits) {
    const add = new Set(d.add);
    if (add.delete(from)) add.add(to);
    next.set(ratingKey, { add, remove: new Set(d.remove) });
  }
  return next;
}

/** Pending member adds a title has, i.e. what a staged create would ship with. */
function pendingMembers(edits: Edits, title: string): number {
  let n = 0;
  for (const d of edits.values()) if (d.add.has(title)) n += 1;
  return n;
}

/**
 * Stage a brand-new collection. Returns the message to show the user instead
 * of new ops when the title is unusable — callers check `typeof === "string"`.
 */
export function stageCreate(
  ops: CollectionOps,
  title: string,
  existing: PlexCollection[],
): CollectionOps | string {
  const t = title.trim();
  if (!t) return "Give the collection a name.";
  if (takenTitles(existing, ops, {}).has(norm(t)))
    return `“${t}” already exists.`;
  return { ...ops, create: [...ops.create, t] };
}

/**
 * Stage a delete, and forget everything else queued against that collection.
 *
 * The pending rename, summary and membership tags are *dropped*, not filtered
 * out at render time, because undoing the delete must not resurrect them: a
 * membership add that survived an undo would re-tag titles the user had since
 * moved on from, and a rename would fire against a collection they only meant
 * to keep as it was.
 */
export function stageDelete(
  ops: CollectionOps,
  edits: Edits,
  coll: PlexCollection,
): { ops: CollectionOps; edits: Edits } {
  const remove = new Set(ops.remove);
  remove.add(coll.ratingKey);
  const rename = new Map(ops.rename);
  rename.delete(coll.ratingKey);
  const summary = new Map(ops.summary);
  summary.delete(coll.ratingKey);
  return {
    ops: { ...ops, remove, rename, summary },
    edits: dropTag(edits, coll.title, "both"),
  };
}

export function unstageDelete(
  ops: CollectionOps,
  ratingKey: string,
): CollectionOps {
  const remove = new Set(ops.remove);
  remove.delete(ratingKey);
  return { ...ops, remove };
}

/**
 * Discard a staged create. Its membership adds go with it — they name a
 * collection that will never exist, and left behind they would tag titles into
 * an implicitly created collection the user just threw away.
 */
export function deleteStagedCreate(
  ops: CollectionOps,
  edits: Edits,
  title: string,
): { ops: CollectionOps; edits: Edits } {
  return {
    ops: { ...ops, create: ops.create.filter((t) => t !== title) },
    edits: dropTag(edits, title, "add"),
  };
}

/**
 * Rename either an existing collection or a staged create.
 *
 * For an existing collection this is a metadata PUT that keeps membership,
 * poster and sort order — never untag-then-retag, which loses all three. So it
 * touches `rename` only, and typing the server's own title back clears the
 * entry rather than queueing a PUT that changes nothing.
 *
 * A staged create has no server object yet, so its "rename" is just an edit of
 * the queued title, plus a re-key of the membership adds that carry it.
 */
export function stageRename(
  ops: CollectionOps,
  edits: Edits,
  target: { ratingKey?: string; createTitle?: string },
  newTitle: string,
  existing: PlexCollection[],
): { ops?: CollectionOps; edits?: Edits; error?: string } {
  const t = newTitle.trim();
  if (!t) return { error: "Give the collection a name." };
  if (takenTitles(existing, ops, target).has(norm(t)))
    return { error: `“${t}” already exists.` };

  if (target.ratingKey !== undefined) {
    const coll = existing.find((c) => c.ratingKey === target.ratingKey);
    if (!coll) return { error: "That collection is no longer in the library." };
    const rename = new Map(ops.rename);
    if (t === coll.title) rename.delete(coll.ratingKey);
    else rename.set(coll.ratingKey, t);
    return { ops: { ...ops, rename } };
  }

  if (target.createTitle !== undefined) {
    const old = target.createTitle;
    if (!ops.create.includes(old))
      return { error: "That collection is no longer staged." };
    return {
      ops: { ...ops, create: ops.create.map((c) => (c === old ? t : c)) },
      edits: rekeyAdds(edits, old, t),
    };
  }

  return { error: "Nothing to rename." };
}

/**
 * Stage a summary. Comparison is on trimmed text both sides so that retyping
 * what the server already has — or reverting a half-typed edit — clears the
 * entry instead of leaving a PUT queued that writes the same string back.
 */
export function stageSummary(
  ops: CollectionOps,
  coll: PlexCollection,
  text: string,
): CollectionOps {
  const summary = new Map(ops.summary);
  if (text.trim() === (coll.summary ?? "").trim())
    summary.delete(coll.ratingKey);
  else summary.set(coll.ratingKey, text.trim());
  return { ...ops, summary };
}

export interface CollectionChannel extends Channel {
  /** Server-side metadata; undefined for staged creates and orphan tags. */
  meta?: PlexCollection;
  /** `name` with any pending rename applied. Display only — never an edit key. */
  displayName: string;
  pendingRename?: string;
  pendingSummary?: string;
  deleted: boolean;
  isNew: boolean;
  smart: boolean;
}

/**
 * The collection lineup: every channel the user could act on, with pending
 * work overlaid.
 *
 * The channel set is the union of three sources, because each one alone has a
 * hole: metadata titles (a server-side collection with no members still needs
 * a card, or it cannot be deleted or renamed), tags found on items (a tag can
 * outlive its metadata in a stale cache), and staged creates (no server object
 * and no members yet).
 *
 * Metadata joins by exact title. Plex permits two collections with the same
 * title in one library; when that happens the second one's card borrows the
 * first one's metadata. Known limitation — matching is by title because that
 * is the only handle a per-item tag gives us.
 *
 * Deleted collections keep rendering so the card can show struck through with
 * an undo, and ordering stays on the *server* title so that renaming a
 * collection does not make its card jump away mid-edit.
 */
export function buildCollectionChannels(
  items: Item[],
  collections: PlexCollection[],
  edits: Edits,
  ops: CollectionOps,
): CollectionChannel[] {
  const names = new Set<string>();
  for (const c of collections) names.add(c.title);
  for (const item of items)
    for (const t of item.collections ?? []) names.add(t);
  for (const t of ops.create) names.add(t);

  const metaByTitle = new Map<string, PlexCollection>();
  for (const c of collections)
    if (!metaByTitle.has(c.title)) metaByTitle.set(c.title, c);
  const staged = new Set(ops.create);

  return buildChannels(
    items,
    edits,
    [...names],
    (item) => item.collections ?? [],
  ).map((ch) => {
    const meta = metaByTitle.get(ch.name);
    const pendingRename = meta ? ops.rename.get(meta.ratingKey) : undefined;
    const pendingSummary = meta ? ops.summary.get(meta.ratingKey) : undefined;
    return {
      ...ch,
      meta,
      displayName: pendingRename ?? ch.name,
      pendingRename,
      pendingSummary,
      deleted: meta ? ops.remove.has(meta.ratingKey) : false,
      isNew: !meta && staged.has(ch.name),
      smart: meta?.smart ?? false,
    };
  });
}

/**
 * How many operations Save would actually perform.
 *
 * A staged create with no members contributes nothing: it produces no request,
 * so counting it would leave the tray promising a change that never lands. It
 * still renders, and `hasEmptyCreates` warns about it separately.
 */
export function collectionEditCount(edits: Edits, ops: CollectionOps): number {
  const empty = new Set(hasEmptyCreates(edits, ops));
  return (
    editCount(edits) +
    ops.create.filter((t) => !empty.has(t)).length +
    ops.rename.size +
    ops.summary.size +
    ops.remove.size
  );
}

/** Staged creates that would vanish on Save, for the tray's warning. */
export function hasEmptyCreates(edits: Edits, ops: CollectionOps): string[] {
  return ops.create.filter((t) => pendingMembers(edits, t) === 0);
}

export function collectionPayload(
  edits: Edits,
  ops: CollectionOps,
  items: Item[],
  collections: PlexCollection[],
): {
  collectionEdits: EditPayload[];
  collectionUpdates: CollectionUpdatePayload[];
  collectionDeletes: CollectionDeletePayload[];
} {
  const byKey = new Map(collections.map((c) => [c.ratingKey, c]));

  // Staged creates never appear here in their own right: a collection is born
  // from its first membership tag, so a create with members rides along in
  // `collectionEdits` and one without members simply does not ship.
  const collectionEdits = toPayload(edits, items);

  // One entry per collection, so a rename and a summary change land in a
  // single metadata PUT instead of two racing ones.
  const collectionUpdates: CollectionUpdatePayload[] = [];
  const touched = new Set([...ops.rename.keys(), ...ops.summary.keys()]);
  for (const ratingKey of touched) {
    if (ops.remove.has(ratingKey)) continue;
    const coll = byKey.get(ratingKey);
    if (!coll) continue;
    collectionUpdates.push({
      ratingKey,
      title: coll.title,
      newTitle: ops.rename.get(ratingKey),
      newSummary: ops.summary.get(ratingKey),
    });
  }

  // `title` is the server title, not the staged one: deletes run before
  // renames, so that is what the collection is still called.
  const collectionDeletes: CollectionDeletePayload[] = [];
  for (const ratingKey of ops.remove) {
    const coll = byKey.get(ratingKey);
    if (coll) collectionDeletes.push({ ratingKey, title: coll.title });
  }

  return { collectionEdits, collectionUpdates, collectionDeletes };
}
