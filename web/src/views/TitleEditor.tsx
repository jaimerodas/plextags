import { useState } from "react";
import type { Item, PlexCollection } from "../api";
import type { Edits } from "../state/edits";
import type { LiveSuggestion } from "../state/suggestions";
import { Suggestions } from "./Suggestions";

interface Props {
  item: Item;
  edits: Edits;
  allGenres: string[];
  suggestion: LiveSuggestion | null;
  hasEvidence: boolean;
  onAdd: (item: Item, genre: string) => void;
  onRemove: (item: Item, genre: string) => void;
  onDismiss: (item: Item, genre: string, direction: "add" | "remove") => void;
  collectionEdits: Edits;
  collections: PlexCollection[];
  stagedCreates: string[];
  onCollAdd: (item: Item, title: string) => void;
  onCollRemove: (item: Item, title: string) => void;
  onClose: () => void;
}

export function TitleEditor({
  item,
  edits,
  allGenres,
  suggestion,
  hasEvidence,
  onAdd,
  onRemove,
  onDismiss,
  collectionEdits,
  collections,
  stagedCreates,
  onCollAdd,
  onCollRemove,
  onClose,
}: Props) {
  const [newGenre, setNewGenre] = useState("");
  const [newCollection, setNewCollection] = useState("");
  const d = edits.get(item.ratingKey);
  const pendingAdds = [...(d?.add ?? [])];
  const current = new Set([...item.genres, ...pendingAdds]);
  const suggestions = allGenres.filter((g) => !current.has(g));

  const cd = collectionEdits.get(item.ratingKey);
  const collPendingAdds = [...(cd?.add ?? [])];
  const currentColls = new Set([...(item.collections ?? []), ...collPendingAdds]);
  const smartCollTitles = new Set(collections.filter((c) => c.smart).map((c) => c.title));
  const suggestionColls = Array.from(
    new Set([
      ...collections.filter((c) => !c.smart).map((c) => c.title),
      ...stagedCreates,
    ]),
  ).filter((c) => !currentColls.has(c));

  function submitAdd() {
    const g = newGenre.trim();
    if (!g || current.has(g)) return;
    onAdd(item, g);
    setNewGenre("");
  }

  function submitCollAdd() {
    const c = newCollection.trim();
    if (!c || currentColls.has(c)) return;
    onCollAdd(item, c);
    setNewCollection("");
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>
            {item.title} {item.year && <span className="year">({item.year})</span>}
          </h2>
          <button className="action" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="chips">
          {item.genres.map((g) =>
            d?.remove.has(g) ? (
              <span key={g} className="chip removed">
                {g}
                <button onClick={() => onAdd(item, g)}>undo</button>
              </span>
            ) : (
              <span key={g} className="chip">
                {g}
                <button onClick={() => onRemove(item, g)}>×</button>
              </span>
            ),
          )}
          {pendingAdds.map((g) => (
            <span key={g} className="chip added">
              {g}
              <button onClick={() => onRemove(item, g)}>×</button>
            </span>
          ))}
          {current.size === 0 && <span className="muted">No genres</span>}
        </div>
        <div className="add-genre">
          <input
            list="genre-options"
            placeholder="Add genre (existing or new)…"
            value={newGenre}
            onChange={(e) => setNewGenre(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitAdd()}
          />
          <datalist id="genre-options">
            {suggestions.map((g) => (
              <option key={g} value={g} />
            ))}
          </datalist>
          <button className="primary" onClick={submitAdd} disabled={!newGenre.trim()}>
            Add
          </button>
        </div>
        <h3>Collections</h3>
        <div className="chips">
          {(item.collections ?? []).map((c) =>
            cd?.remove.has(c) ? (
              <span key={c} className="chip removed">
                {c}
                <button onClick={() => onCollAdd(item, c)}>undo</button>
              </span>
            ) : smartCollTitles.has(c) ? (
              <span key={c} className="chip">
                {c}
              </span>
            ) : (
              <span key={c} className="chip">
                {c}
                <button onClick={() => onCollRemove(item, c)}>×</button>
              </span>
            ),
          )}
          {collPendingAdds.map((c) => (
            <span key={c} className="chip added">
              {c}
              <button onClick={() => onCollRemove(item, c)}>×</button>
            </span>
          ))}
          {currentColls.size === 0 && <span className="muted">No collections</span>}
        </div>
        <div className="add-genre">
          <input
            list="collection-options"
            placeholder="Add collection (existing or new)…"
            value={newCollection}
            onChange={(e) => setNewCollection(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitCollAdd()}
          />
          <datalist id="collection-options">
            {suggestionColls.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          <button className="primary" onClick={submitCollAdd} disabled={!newCollection.trim()}>
            Add
          </button>
        </div>
        <Suggestions
          item={item}
          suggestion={suggestion}
          hasEvidence={hasEvidence}
          onAdd={onAdd}
          onRemove={onRemove}
          onDismiss={onDismiss}
        />
      </div>
    </div>
  );
}
