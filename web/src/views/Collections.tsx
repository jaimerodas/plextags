import { useState } from "react";
import type { Item } from "../api";
import type { CollectionChannel } from "../state/collections";
import { AddTitle, EntryRow } from "./Lineup";

interface Props {
  channels: CollectionChannel[];
  items: Item[];
  onAdd: (item: Item, title: string) => void;
  onRemove: (item: Item, title: string) => void;
  onRename: (ch: CollectionChannel) => void;
  onSummary: (ch: CollectionChannel, text: string) => void;
  onDelete: (ch: CollectionChannel) => void;
  onUndelete: (ch: CollectionChannel) => void;
  onOpenTitle: (item: Item) => void;
}

/**
 * The collection lineup: one card per `CollectionChannel`. Purely
 * presentational — every rule about what can be staged lives in
 * state/collections.ts; this component only renders what it's handed and
 * forwards clicks.
 */
export default function Collections({
  channels,
  items,
  onAdd,
  onRemove,
  onRename,
  onSummary,
  onDelete,
  onUndelete,
  onOpenTitle,
}: Props) {
  if (channels.length === 0) {
    return (
      <div className="centered">
        <p>No collections yet.</p>
        <p className="muted">Create one with + New collection.</p>
      </div>
    );
  }

  return (
    <div className="lineup">
      {channels.map((ch) => (
        <CollectionCard
          key={ch.name}
          channel={ch}
          items={items}
          onAdd={onAdd}
          onRemove={onRemove}
          onRename={onRename}
          onSummary={onSummary}
          onDelete={onDelete}
          onUndelete={onUndelete}
          onOpenTitle={onOpenTitle}
        />
      ))}
    </div>
  );
}

function CollectionCard(props: {
  channel: CollectionChannel;
  items: Item[];
  onAdd: (item: Item, title: string) => void;
  onRemove: (item: Item, title: string) => void;
  onRename: (ch: CollectionChannel) => void;
  onSummary: (ch: CollectionChannel, text: string) => void;
  onDelete: (ch: CollectionChannel) => void;
  onUndelete: (ch: CollectionChannel) => void;
  onOpenTitle: (item: Item) => void;
}) {
  const {
    channel,
    items,
    onAdd,
    onRemove,
    onRename,
    onSummary,
    onDelete,
    onUndelete,
    onOpenTitle,
  } = props;
  const [open, setOpen] = useState(true);
  const activeCount = channel.entries.filter((e) => e.status !== "removed").length;

  if (channel.deleted) {
    return (
      <section className="channel deleted">
        <header>
          <h2>{channel.displayName}</h2>
          <span className="count">{activeCount}</span>
          <span className="spacer" />
          <button className="action undo" onClick={() => onUndelete(channel)}>
            Deleted — undo
          </button>
        </header>
      </section>
    );
  }

  const showSummary =
    !channel.smart && (channel.meta !== undefined || channel.pendingSummary !== undefined);

  return (
    <section className="channel">
      <header onClick={() => setOpen(!open)}>
        <span className={`chevron ${open ? "open" : ""}`}>▸</span>
        <h2>{channel.displayName}</h2>
        <span className="count">{activeCount}</span>
        {channel.smart && <span className="badge smart">smart</span>}
        {channel.isNew && <span className="badge add">new</span>}
        {channel.pendingRename && (
          <span className="muted">was “{channel.name}”</span>
        )}
        <span className="spacer" />
        {!channel.smart && (
          <>
            <button
              className="action"
              title="Rename"
              onClick={(e) => {
                e.stopPropagation();
                onRename(channel);
              }}
            >
              ✎
            </button>
            <button
              className="action"
              title="Delete"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(channel);
              }}
            >
              ×
            </button>
          </>
        )}
      </header>
      {open && (
        <div className="channel-body">
          {showSummary && <Summary channel={channel} onSummary={onSummary} />}
          {channel.entries.map((e) => (
            <EntryRow
              key={e.item.ratingKey}
              entry={e}
              genre={channel.name}
              suggestionCount={0}
              onAdd={onAdd}
              onRemove={onRemove}
              onOpenTitle={onOpenTitle}
              readOnly={channel.smart}
            />
          ))}
          {!channel.smart && (
            <AddTitle
              genre={channel.name}
              items={items}
              existing={channel.entries}
              onAdd={onAdd}
            />
          )}
        </div>
      )}
    </section>
  );
}

function Summary({
  channel,
  onSummary,
}: {
  channel: CollectionChannel;
  onSummary: (ch: CollectionChannel, text: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const value = channel.pendingSummary ?? channel.meta?.summary ?? "";

  if (editing) {
    return (
      <div className="summary editing">
        <textarea
          autoFocus
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="summary-actions">
          <button
            className="primary"
            onClick={() => {
              onSummary(channel, text);
              setEditing(false);
            }}
          >
            Save
          </button>
          <button onClick={() => setEditing(false)}>Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <p
      className="summary"
      onClick={() => {
        setText(value);
        setEditing(true);
      }}
    >
      {value || "Add a summary…"}
    </p>
  );
}
