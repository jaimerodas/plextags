import type { Dismissed, Item, Suggestion } from "../api";
import type { Edits } from "../state/edits";
import { queueFor } from "../state/suggestions";
import { Suggestions } from "./Suggestions";

interface Props {
  items: Item[];
  suggestions: Record<string, Suggestion>;
  dismissed: Dismissed;
  edits: Edits;
  hasEvidence: boolean;
  onAdd: (item: Item, genre: string) => void;
  onRemove: (item: Item, genre: string) => void;
  onDismiss: (item: Item, genre: string, direction: "add" | "remove") => void;
  onOpenTitle: (item: Item) => void;
}

/**
 * Every title with outstanding suggestions, worked one at a time.
 *
 * Titles drop out of the list the moment their last suggestion is accepted or
 * dismissed, so the count is a real finish line rather than a static backlog.
 */
export function ReviewQueue({
  items,
  suggestions,
  dismissed,
  edits,
  hasEvidence,
  onAdd,
  onRemove,
  onDismiss,
  onOpenTitle,
}: Props) {
  const queue = queueFor(items, suggestions, edits, dismissed);
  const total = queue.reduce(
    (n, q) => n + q.suggestion.add.length + q.suggestion.remove.length,
    0,
  );

  if (!hasEvidence) {
    return (
      <div className="centered">
        <p>No Wikipedia data downloaded yet.</p>
        <p className="muted">
          Use ⟳ Wikipedia in the toolbar — it takes about a minute for the whole
          library.
        </p>
      </div>
    );
  }

  if (queue.length === 0) {
    return (
      <div className="centered">
        <p>Nothing left to review ✓</p>
        <p className="muted">
          Every title either matches Wikidata and Wikipedia, or you've already
          judged it.
        </p>
      </div>
    );
  }

  return (
    <div className="review">
      <p className="review-count">
        {total} suggestion{total === 1 ? "" : "s"} across {queue.length} title
        {queue.length === 1 ? "" : "s"}
      </p>
      {queue.map(({ item, suggestion }) => (
        <section className="review-card" key={item.ratingKey}>
          <header>
            <button className="title" onClick={() => onOpenTitle(item)}>
              {item.title}
            </button>
            {item.year && <span className="year">({item.year})</span>}
            <div className="spacer" />
            <div className="chips">
              {item.genres.map((g) => (
                <span key={g} className="chip">
                  {g}
                </span>
              ))}
              {item.genres.length === 0 && <span className="muted">No genres</span>}
            </div>
          </header>
          <Suggestions
            item={item}
            suggestion={suggestion}
            hasEvidence
            onAdd={onAdd}
            onRemove={onRemove}
            onDismiss={onDismiss}
          />
        </section>
      ))}
    </div>
  );
}
