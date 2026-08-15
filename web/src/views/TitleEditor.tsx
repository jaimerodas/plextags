import { useState } from "react";
import type { Item } from "../api";
import type { Edits } from "../state/edits";

interface Props {
  item: Item;
  edits: Edits;
  allGenres: string[];
  onAdd: (item: Item, genre: string) => void;
  onRemove: (item: Item, genre: string) => void;
  onClose: () => void;
}

export function TitleEditor({ item, edits, allGenres, onAdd, onRemove, onClose }: Props) {
  const [newGenre, setNewGenre] = useState("");
  const d = edits.get(item.ratingKey);
  const pendingAdds = [...(d?.add ?? [])];
  const current = new Set([...item.genres, ...pendingAdds]);
  const suggestions = allGenres.filter((g) => !current.has(g));

  function submitAdd() {
    const g = newGenre.trim();
    if (!g || current.has(g)) return;
    onAdd(item, g);
    setNewGenre("");
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
      </div>
    </div>
  );
}
