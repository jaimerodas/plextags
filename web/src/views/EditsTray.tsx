import type { ReactNode } from "react";
import type { Item, PlexCollection } from "../api";
import type { Edits } from "../state/edits";
import { editCount } from "../state/edits";
import type { CollectionOps } from "../state/collections";
import { collectionEditCount, hasEmptyCreates } from "../state/collections";

interface Props {
  edits: Edits;
  collectionEdits: Edits;
  ops: CollectionOps;
  collections: PlexCollection[];
  items: Item[];
  saving: boolean;
  canSave: boolean;
  onAdd: (item: Item, genre: string) => void;
  onRemove: (item: Item, genre: string) => void;
  onCollAdd: (item: Item, title: string) => void;
  onCollRemove: (item: Item, title: string) => void;
  /** Undo one staged collection op. `key` is the title for a create, else the ratingKey. */
  onUndoOp: (
    kind: "create" | "rename" | "summary" | "delete",
    key: string,
  ) => void;
  onDiscardAll: () => void;
  onSave: () => void;
}

export function EditsTray(props: Props) {
  const {
    edits,
    collectionEdits,
    ops,
    collections,
    items,
    saving,
    canSave,
    onAdd,
    onRemove,
    onCollAdd,
    onCollRemove,
    onUndoOp,
    onDiscardAll,
    onSave,
  } = props;
  const count = editCount(edits) + collectionEditCount(collectionEdits, ops);
  if (count === 0) return null;

  const byKey = new Map(items.map((i) => [i.ratingKey, i]));
  const collByKey = new Map(collections.map((c) => [c.ratingKey, c]));
  const empty = new Set(hasEmptyCreates(collectionEdits, ops));
  // A title can have genre deltas, collection deltas, or both — one row each way.
  const rows = [...new Set([...edits.keys(), ...collectionEdits.keys()])];

  const title = (ratingKey: string) =>
    collByKey.get(ratingKey)?.title ?? ratingKey;
  const members = (name: string) => {
    let n = 0;
    for (const d of collectionEdits.values()) if (d.add.has(name)) n += 1;
    return n;
  };

  return (
    <div className="tray">
      <div className="tray-list">
        {rows.map((rk) => {
          const item = byKey.get(rk);
          if (!item) return null;
          const g = edits.get(rk);
          const c = collectionEdits.get(rk);
          return (
            <div key={rk} className="tray-row">
              <span className="title">{item.title}</span>
              {[...(g?.add ?? [])].map((name) => (
                <button
                  key={`+${name}`}
                  className="chip added"
                  title="Click to undo"
                  onClick={() => onRemove(item, name)}
                >
                  +{name}
                </button>
              ))}
              {[...(g?.remove ?? [])].map((name) => (
                <button
                  key={`-${name}`}
                  className="chip removed"
                  title="Click to undo"
                  onClick={() => onAdd(item, name)}
                >
                  −{name}
                </button>
              ))}
              {[...(c?.add ?? [])].map((name) => (
                <button
                  key={`c+${name}`}
                  className="chip coll added"
                  title="Click to undo"
                  onClick={() => onCollRemove(item, name)}
                >
                  ⊞ {name}
                </button>
              ))}
              {[...(c?.remove ?? [])].map((name) => (
                <button
                  key={`c-${name}`}
                  className="chip coll removed"
                  title="Click to undo"
                  onClick={() => onCollAdd(item, name)}
                >
                  ⊞ {name}
                </button>
              ))}
            </div>
          );
        })}

        {ops.create.map((name) => {
          const n = members(name);
          return (
            <OpRow key={`create:${name}`} onUndo={() => onUndoOp("create", name)}>
              New collection “{name}” ({n} title{n === 1 ? "" : "s"})
              {empty.has(name) && (
                <span className="warn"> won’t be created — add a title</span>
              )}
            </OpRow>
          );
        })}
        {[...ops.rename].map(([rk, newTitle]) => (
          <OpRow key={`rename:${rk}`} onUndo={() => onUndoOp("rename", rk)}>
            Rename “{title(rk)}” → “{newTitle}”
          </OpRow>
        ))}
        {[...ops.summary.keys()].map((rk) => (
          <OpRow key={`summary:${rk}`} onUndo={() => onUndoOp("summary", rk)}>
            Summary: “{ops.rename.get(rk) ?? title(rk)}”
          </OpRow>
        ))}
        {[...ops.remove].map((rk) => (
          <OpRow key={`delete:${rk}`} onUndo={() => onUndoOp("delete", rk)}>
            Delete “{title(rk)}”
          </OpRow>
        ))}
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

function OpRow(props: { onUndo: () => void; children: ReactNode }) {
  return (
    <div className="tray-row op">
      <span>{props.children}</span>
      <button className="action" title="Undo" onClick={props.onUndo}>
        ×
      </button>
    </div>
  );
}
