import type { Dismissed, Item, Suggestion } from "../api";
import type { Edits } from "./edits";

/**
 * Suggestions are computed on the server, where the guards in
 * study/normalize.py live — nothing here decides what a genre implies. This
 * file only hides suggestions that are no longer relevant:
 *
 *   - ones the user already queued in the edits tray, so accepting a suggestion
 *     makes it disappear immediately instead of after the next save, and
 *   - ones the user dismissed.
 *
 * Keeping the judgement server-side and the filtering client-side is what stops
 * the two implementations drifting apart.
 */

export interface LiveSuggestion extends Suggestion {
  add: string[];
  remove: string[];
}

export function visibleFor(
  item: Item,
  suggestion: Suggestion | undefined,
  edits: Edits,
  dismissed: Dismissed,
): LiveSuggestion | null {
  if (!suggestion) return null;
  const pending = edits.get(item.ratingKey);
  const off = dismissed[item.ratingKey];

  const add = suggestion.add.filter(
    (g) => !pending?.add.has(g) && !off?.add.includes(g),
  );
  const remove = suggestion.remove.filter(
    (g) => !pending?.remove.has(g) && !off?.remove.includes(g),
  );
  if (add.length === 0 && remove.length === 0) return null;
  return { ...suggestion, add, remove };
}

/** How many actionable suggestions a title has right now. */
export function countFor(
  item: Item,
  suggestion: Suggestion | undefined,
  edits: Edits,
  dismissed: Dismissed,
): number {
  const v = visibleFor(item, suggestion, edits, dismissed);
  return v ? v.add.length + v.remove.length : 0;
}

/** Every title with outstanding suggestions, most first — drives the review queue.
 *
 * The sort deliberately weighs the *server's* suggestion counts, not the live
 * filtered ones: judging one row of a title must not move that title's card.
 * Ranking by the live count meant dismissing one of two suggestions demoted the
 * card past every other title, which reads as "both got dismissed" — the
 * remaining row is still there, just forty cards away. Order therefore only
 * changes when the evidence or the library does.
 */
export function queueFor(
  items: Item[],
  suggestions: Record<string, Suggestion>,
  edits: Edits,
  dismissed: Dismissed,
): { item: Item; suggestion: LiveSuggestion }[] {
  const out: { item: Item; suggestion: LiveSuggestion }[] = [];
  for (const item of items) {
    const v = visibleFor(item, suggestions[item.ratingKey], edits, dismissed);
    if (v) out.push({ item, suggestion: v });
  }
  const rank = (item: Item) => {
    const s = suggestions[item.ratingKey];
    return s ? s.add.length + s.remove.length : 0;
  };
  return out.sort(
    (a, b) =>
      rank(b.item) - rank(a.item) || a.item.title.localeCompare(b.item.title),
  );
}
