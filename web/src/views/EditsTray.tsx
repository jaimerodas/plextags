import type { Item } from "../api";
import type { Edits } from "../state/edits";
import { editCount } from "../state/edits";

interface Props {
  edits: Edits;
  items: Item[];
  saving: boolean;
  canSave: boolean;
  onAdd: (item: Item, genre: string) => void;
  onRemove: (item: Item, genre: string) => void;
  onDiscardAll: () => void;
  onSave: () => void;
}

export function EditsTray(props: Props) {
  const { edits, items, saving, canSave, onAdd, onRemove, onDiscardAll, onSave } = props;
  const count = editCount(edits);
  if (count === 0) return null;
  const byKey = new Map(items.map((i) => [i.ratingKey, i]));

  return (
    <div className="tray">
      <div className="tray-list">
        {[...edits.entries()].map(([rk, d]) => {
          const item = byKey.get(rk);
          if (!item) return null;
          return (
            <div key={rk} className="tray-row">
              <span className="title">{item.title}</span>
              {[...d.add].map((g) => (
                <button
                  key={`+${g}`}
                  className="chip added"
                  title="Click to undo"
                  onClick={() => onRemove(item, g)}
                >
                  +{g}
                </button>
              ))}
              {[...d.remove].map((g) => (
                <button
                  key={`-${g}`}
                  className="chip removed"
                  title="Click to undo"
                  onClick={() => onAdd(item, g)}
                >
                  −{g}
                </button>
              ))}
            </div>
          );
        })}
      </div>
      <div className="tray-actions">
        <span className="count-label">
          {count} pending change{count === 1 ? "" : "s"}
        </span>
        <button onClick={onDiscardAll} disabled={saving}>
          Discard all
        </button>
        <button
          className="primary"
          onClick={onSave}
          disabled={saving || !canSave}
          title={canSave ? "" : "Sign in to sync changes"}
        >
          {saving ? "Syncing…" : "Save to Plex"}
        </button>
      </div>
    </div>
  );
}
