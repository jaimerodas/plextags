import type { Item } from "../api";
import type { LiveSuggestion } from "../state/suggestions";

interface Props {
  item: Item;
  suggestion: LiveSuggestion | null;
  /** Null when evidence has never been downloaded. */
  hasEvidence: boolean;
  onAdd: (item: Item, genre: string) => void;
  onRemove: (item: Item, genre: string) => void;
  onDismiss: (item: Item, genre: string, direction: "add" | "remove") => void;
}

/**
 * Shared by the title editor and the review queue so both read identically.
 *
 * Every row shows *why* — the Wikipedia lead phrase, and the raw Wikidata
 * labels on hover. Suggestions that can't be explained shouldn't be trusted:
 * every wrong result during the original study came from a normalisation quirk
 * that was invisible until the evidence was shown next to it.
 */
export function Suggestions({
  item,
  suggestion,
  hasEvidence,
  onAdd,
  onRemove,
  onDismiss,
}: Props) {
  if (!hasEvidence) {
    return (
      <p className="muted suggestion-empty">
        No Wikipedia data downloaded yet — use ⟳ Wikipedia in the toolbar.
      </p>
    );
  }
  if (!suggestion) {
    return (
      <p className="muted suggestion-empty">
        Nothing to suggest — Wikidata and Wikipedia agree with these genres.
      </p>
    );
  }

  const rows: { genre: string; dir: "add" | "remove" }[] = [
    ...suggestion.add.map((g) => ({ genre: g, dir: "add" as const })),
    ...suggestion.remove.map((g) => ({ genre: g, dir: "remove" as const })),
  ];

  return (
    <div className="suggestions">
      <div className="suggestion-head">
        <h3>Suggestions</h3>
        {suggestion.article && (
          <a href={suggestion.article} target="_blank" rel="noreferrer noopener">
            Wikipedia ↗
          </a>
        )}
      </div>

      {suggestion.why && (
        <p className="suggestion-why" title={suggestion.raw.join(", ")}>
          Wikipedia calls it <em>“{suggestion.why}”</em>
        </p>
      )}

      {rows.map(({ genre, dir }) => (
        <div key={`${dir}:${genre}`} className={`suggestion ${dir}`}>
          <span className="what">
            {dir === "add" ? "Add" : "Remove"} <strong>{genre}</strong>
          </span>
          <span className="reason">
            {dir === "add"
              ? "both sources list it"
              : "neither source supports it"}
          </span>
          <button
            className="primary"
            onClick={() =>
              dir === "add" ? onAdd(item, genre) : onRemove(item, genre)
            }
          >
            Accept
          </button>
          <button className="link" onClick={() => onDismiss(item, genre, dir)}>
            Dismiss
          </button>
        </div>
      ))}

      {suggestion.removeSoft.length > 0 && (
        <p className="suggestion-note">
          <strong>{suggestion.removeSoft.join(", ")}</strong> {" "}
          {suggestion.removeSoft.length === 1 ? "isn't" : "aren't"} mentioned
          outside Plex, but Wikidata rarely records audience genres — not
          suggested for removal, your call.
        </p>
      )}

      {suggestion.outside.length > 0 && (
        <p className="suggestion-note">
          Also described as {suggestion.outside.slice(0, 6).join(", ")} — no Plex
          equivalent.
        </p>
      )}
    </div>
  );
}
