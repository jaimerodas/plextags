import { useMemo, useState } from "react";
import type { Item } from "../api";
import type { Channel, ChannelEntry } from "../state/edits";

interface Props {
  channels: Channel[];
  items: Item[];
  /** ratingKey -> outstanding suggestion count, for the badge. */
  suggestionCounts: Map<string, number>;
  onAdd: (item: Item, genre: string) => void;
  onRemove: (item: Item, genre: string) => void;
  onOpenTitle: (item: Item) => void;
}

export function Lineup({
  channels,
  items,
  suggestionCounts,
  onAdd,
  onRemove,
  onOpenTitle,
}: Props) {
  return (
    <div className="lineup">
      {channels.map((ch) => (
        <ChannelCard
          key={ch.genre}
          channel={ch}
          items={items}
          suggestionCounts={suggestionCounts}
          onAdd={onAdd}
          onRemove={onRemove}
          onOpenTitle={onOpenTitle}
        />
      ))}
    </div>
  );
}

function ChannelCard(props: {
  channel: Channel;
  items: Item[];
  suggestionCounts: Map<string, number>;
  onAdd: (item: Item, genre: string) => void;
  onRemove: (item: Item, genre: string) => void;
  onOpenTitle: (item: Item) => void;
}) {
  const { channel, items, suggestionCounts, onAdd, onRemove, onOpenTitle } = props;
  const [open, setOpen] = useState(true);
  const activeCount = channel.entries.filter((e) => e.status !== "removed").length;

  return (
    <section className="channel">
      <header onClick={() => setOpen(!open)}>
        <span className={`chevron ${open ? "open" : ""}`}>▸</span>
        <h2>{channel.genre}</h2>
        <span className="count">{activeCount}</span>
      </header>
      {open && (
        <div className="channel-body">
          {channel.entries.map((e) => (
            <EntryRow
              key={e.item.ratingKey}
              entry={e}
              genre={channel.genre}
              suggestionCount={suggestionCounts.get(e.item.ratingKey) ?? 0}
              onAdd={onAdd}
              onRemove={onRemove}
              onOpenTitle={onOpenTitle}
            />
          ))}
          <AddTitle
            genre={channel.genre}
            items={items}
            existing={channel.entries}
            onAdd={onAdd}
          />
        </div>
      )}
    </section>
  );
}

function EntryRow(props: {
  entry: ChannelEntry;
  genre: string;
  suggestionCount: number;
  onAdd: (item: Item, genre: string) => void;
  onRemove: (item: Item, genre: string) => void;
  onOpenTitle: (item: Item) => void;
}) {
  const { entry, genre, suggestionCount, onAdd, onRemove, onOpenTitle } = props;
  const { item, status } = entry;
  return (
    <div className={`entry ${status}`}>
      <button className="title" onClick={() => onOpenTitle(item)}>
        {item.title}
      </button>
      {item.year && <span className="year">{item.year}</span>}
      {status === "added" && <span className="badge add">pending</span>}
      {suggestionCount > 0 && (
        <button
          className="badge suggest"
          title={`${suggestionCount} suggestion${suggestionCount === 1 ? "" : "s"} from Wikipedia`}
          onClick={() => onOpenTitle(item)}
        >
          {suggestionCount}
        </button>
      )}
      {status === "removed" ? (
        <button className="action undo" onClick={() => onAdd(item, genre)}>
          undo
        </button>
      ) : (
        <button
          className="action remove"
          title={`Remove from ${genre}`}
          onClick={() => onRemove(item, genre)}
        >
          ×
        </button>
      )}
    </div>
  );
}

function AddTitle(props: {
  genre: string;
  items: Item[];
  existing: ChannelEntry[];
  onAdd: (item: Item, genre: string) => void;
}) {
  const { genre, items, existing, onAdd } = props;
  const [query, setQuery] = useState("");
  const inChannel = useMemo(
    () =>
      new Set(
        existing.filter((e) => e.status !== "removed").map((e) => e.item.ratingKey),
      ),
    [existing],
  );
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return items
      .filter((i) => !inChannel.has(i.ratingKey) && i.title.toLowerCase().includes(q))
      .slice(0, 8);
  }, [query, items, inChannel]);

  return (
    <div className="add-title">
      <input
        placeholder={`Add a title to ${genre}…`}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {matches.length > 0 && (
        <div className="matches">
          {matches.map((i) => (
            <button
              key={i.ratingKey}
              onClick={() => {
                onAdd(i, genre);
                setQuery("");
              }}
            >
              {i.title} {i.year ? <span className="year">({i.year})</span> : null}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
