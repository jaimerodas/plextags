import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  ApiError,
  ApplyResult,
  AuthStatus,
  Dismissed,
  EvidenceJob,
  Item,
  Kind,
  Library,
  RefreshJob,
  Section,
  Suggestion,
} from "./api";
import {
  buildChannels,
  Edits,
  editCount,
  emptyEdits,
  queueAdd,
  queueRemove,
  toPayload,
} from "./state/edits";
import {
  buildCollectionChannels,
  CollectionChannel,
  collectionEditCount,
  CollectionOps,
  collectionPayload,
  deleteStagedCreate,
  emptyOps,
  stageCreate,
  stageDelete,
  stageRename,
  stageSummary,
  unstageDelete,
} from "./state/collections";
import { countFor, visibleFor } from "./state/suggestions";
import { ServerPicker, SignIn } from "./views/Auth";
import Collections from "./views/Collections";
import { EditsTray } from "./views/EditsTray";
import { Lineup } from "./views/Lineup";
import { ReviewQueue } from "./views/ReviewQueue";
import { TitleEditor } from "./views/TitleEditor";

const OFFLINE_SECTIONS: Section[] = [
  { id: "seed-movie", kind: "movie", title: "Movies (cached)" },
  { id: "seed-show", kind: "show", title: "TV Shows (cached)" },
];

export default function App() {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [offline, setOffline] = useState(false);

  const [kind, setKind] = useState<Kind>("movie");
  const [library, setLibrary] = useState<Library | null>(null);
  const [libraryMissing, setLibraryMissing] = useState(false);
  const [edits, setEdits] = useState<Edits>(emptyEdits());
  const [collectionEdits, setCollectionEdits] = useState<Edits>(emptyEdits());
  const [collectionOps, setCollectionOps] = useState<CollectionOps>(emptyOps());
  const [extraChannels, setExtraChannels] = useState<string[]>([]);
  const [selected, setSelected] = useState<Item | null>(null);

  const [view, setView] = useState<"lineup" | "collections" | "review">("lineup");
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [suggestions, setSuggestions] = useState<Record<string, Suggestion>>({});
  const [dismissed, setDismissed] = useState<Dismissed>({});
  const [evidenceCount, setEvidenceCount] = useState(0);
  const [evJob, setEvJob] = useState<EvidenceJob | null>(null);
  const evPollRef = useRef<number | undefined>(undefined);

  const [job, setJob] = useState<RefreshJob | null>(null);
  const [saving, setSaving] = useState(false);
  const [applyResults, setApplyResults] = useState<ApplyResult[] | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const pollRef = useRef<number | undefined>(undefined);

  const loadStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      setStatus(await api.authStatus());
    } finally {
      setStatusLoading(false);
    }
  }, []);

  const loadEvidence = useCallback(async () => {
    try {
      const e = await api.evidence();
      setSuggestions(e.suggestions);
      setDismissed(e.dismissed);
      setEvidenceCount(e.count);
    } catch {
      /* evidence is optional — the app works fully without it */
    }
  }, []);

  useEffect(() => {
    loadStatus();
    loadEvidence();
    return () => {
      window.clearInterval(pollRef.current);
      window.clearInterval(evPollRef.current);
    };
  }, [loadStatus, loadEvidence]);

  useEffect(() => {
    if (!menuOpen) return;
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [menuOpen]);

  const authed = status?.authenticated ?? false;
  const sections = offline ? OFFLINE_SECTIONS : status?.sections ?? null;
  const section = sections?.find((s) => s.kind === kind) ?? null;

  const loadItems = useCallback(async (sec: Section) => {
    try {
      setLibrary(await api.items(sec.id, sec.kind));
      setLibraryMissing(false);
    } catch (e) {
      setLibrary(null);
      setLibraryMissing(e instanceof ApiError && e.status === 404);
    }
  }, []);

  useEffect(() => {
    if (section) loadItems(section);
    else setLibrary(null);
  }, [section?.id, section?.kind]); // eslint-disable-line react-hooks/exhaustive-deps

  function pollJob(sec: Section, onDone?: () => void) {
    window.clearInterval(pollRef.current);
    pollRef.current = window.setInterval(async () => {
      const j = await api.refreshStatus(sec.id);
      setJob(j);
      if (!j.running) {
        window.clearInterval(pollRef.current);
        setJob(null);
        if (j.error) setBanner(`Refresh failed: ${j.error}`);
        else await loadItems(sec);
        onDone?.();
      }
    }, 600);
  }

  async function startRefresh(onDone?: () => void) {
    if (!section) return;
    setBanner(null);
    const j = await api.refreshStart(section.id, section.kind);
    setJob(j);
    pollJob(section, onDone);
  }

  async function startEvidenceRefresh() {
    setBanner(null);
    setEvJob(await api.evidenceRefreshStart());
    window.clearInterval(evPollRef.current);
    evPollRef.current = window.setInterval(async () => {
      const j = await api.evidenceRefreshStatus();
      setEvJob(j);
      if (!j.running) {
        window.clearInterval(evPollRef.current);
        setEvJob(null);
        if (j.error) setBanner(`Wikipedia lookup failed: ${j.error}`);
        else {
          await loadEvidence();
          setBanner("Wikipedia data updated ✓");
        }
      }
    }, 700);
  }

  async function onDismiss(
    item: Item,
    genre: string,
    direction: "add" | "remove",
  ) {
    // Optimistic: the row should vanish on click, not after a round trip.
    setDismissed((d) => {
      const cur = d[item.ratingKey] ?? { add: [], remove: [] };
      return {
        ...d,
        [item.ratingKey]: { ...cur, [direction]: [...cur[direction], genre] },
      };
    });
    try {
      setDismissed(await api.dismiss(item.ratingKey, genre, direction));
    } catch (e) {
      setBanner(`Could not save dismissal: ${e instanceof Error ? e.message : e}`);
    }
  }

  function confirmDiscard(): boolean {
    const n = totalEditCount;
    if (n === 0) return true;
    return window.confirm(`Discard ${n} pending change${n === 1 ? "" : "s"}?`);
  }

  /** Drop every staged change, genre and collection alike. */
  function clearEdits() {
    setEdits(emptyEdits());
    setCollectionEdits(emptyEdits());
    setCollectionOps(emptyOps());
  }

  function switchKind(k: Kind) {
    if (k === kind || saving) return;
    if (!confirmDiscard()) return;
    clearEdits();
    setExtraChannels([]);
    setSelected(null);
    setKind(k);
  }

  const onAdd = (item: Item, genre: string) =>
    setEdits((e) => queueAdd(e, item, genre, item.genres));
  const onRemove = (item: Item, genre: string) =>
    setEdits((e) => queueRemove(e, item, genre, item.genres));

  function newChannel() {
    const g = window.prompt("New channel (genre) name:")?.trim();
    if (!g) return;
    setExtraChannels((cs) => (cs.includes(g) ? cs : [...cs, g].sort()));
  }

  // ---- collections. Every rule lives in state/collections.ts; these only
  // hand it the current state and route what comes back.

  const onCollAdd = (item: Item, title: string) =>
    setCollectionEdits((e) => queueAdd(e, item, title, item.collections ?? []));
  const onCollRemove = (item: Item, title: string) =>
    setCollectionEdits((e) =>
      queueRemove(e, item, title, item.collections ?? []),
    );

  function newCollection() {
    const name = window.prompt("New collection name:");
    if (name === null) return;
    const next = stageCreate(collectionOps, name, collections);
    if (typeof next === "string") setBanner(next);
    else setCollectionOps(next);
  }

  function onCollRename(ch: CollectionChannel) {
    const title = window.prompt("Rename collection:", ch.displayName);
    if (title === null) return;
    const r = stageRename(
      collectionOps,
      collectionEdits,
      ch.meta ? { ratingKey: ch.meta.ratingKey } : { createTitle: ch.name },
      title,
      collections,
    );
    if (r.error) {
      setBanner(r.error);
      return;
    }
    if (r.ops) setCollectionOps(r.ops);
    if (r.edits) setCollectionEdits(r.edits);
  }

  function onCollSummary(ch: CollectionChannel, text: string) {
    const meta = ch.meta;
    if (!meta) return;
    setCollectionOps((o) => stageSummary(o, meta, text));
  }

  function onCollDelete(ch: CollectionChannel) {
    const r = ch.isNew
      ? deleteStagedCreate(collectionOps, collectionEdits, ch.name)
      : ch.meta
        ? stageDelete(collectionOps, collectionEdits, ch.meta)
        : null;
    if (!r) return;
    setCollectionOps(r.ops);
    setCollectionEdits(r.edits);
  }

  function onCollUndelete(ch: CollectionChannel) {
    const meta = ch.meta;
    if (!meta) return;
    setCollectionOps((o) => unstageDelete(o, meta.ratingKey));
  }

  /**
   * Undo one staged op from the tray. Creates and deletes go back through
   * state/collections.ts because other state hangs off them (a create owns its
   * membership adds; a delete already dropped everything it shadowed). Renames
   * and summaries are coupled to nothing, so dropping the map entry is the
   * whole undo.
   */
  function onUndoOp(
    kind: "create" | "rename" | "summary" | "delete",
    key: string,
  ) {
    if (kind === "create") {
      const r = deleteStagedCreate(collectionOps, collectionEdits, key);
      setCollectionOps(r.ops);
      setCollectionEdits(r.edits);
      return;
    }
    if (kind === "delete") {
      setCollectionOps((o) => unstageDelete(o, key));
      return;
    }
    setCollectionOps((o) => {
      const next = new Map(kind === "rename" ? o.rename : o.summary);
      next.delete(key);
      return kind === "rename"
        ? { ...o, rename: next }
        : { ...o, summary: next };
    });
  }

  async function save() {
    if (!section || saving || totalEditCount === 0) return;
    setSaving(true);
    setBanner(null);
    try {
      const extra = collectionPayload(
        collectionEdits,
        collectionOps,
        library?.items ?? [],
        library?.collections ?? [],
      );
      const { results, ok } = await api.apply(
        section.id,
        section.kind,
        toPayload(edits, library?.items ?? []),
        extra,
      );
      if (!ok) setApplyResults(results);
      clearEdits();
      setExtraChannels([]);
      setSelected(null);
      await startRefresh(() => {
        setSaving(false);
        if (ok) setBanner("Synced to Plex and re-downloaded ✓");
      });
    } catch (e) {
      setSaving(false);
      setBanner(`Sync failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const items = library?.items ?? [];
  const channels = useMemo(
    () => buildChannels(items, edits, extraChannels, (i) => i.genres),
    [items, edits, extraChannels],
  );
  const collections = useMemo(() => library?.collections ?? [], [library]);
  const collectionChannels = useMemo(
    () =>
      buildCollectionChannels(items, collections, collectionEdits, collectionOps),
    [items, collections, collectionEdits, collectionOps],
  );
  const totalEditCount = useMemo(
    () => editCount(edits) + collectionEditCount(collectionEdits, collectionOps),
    [edits, collectionEdits, collectionOps],
  );
  const allGenres = useMemo(
    () => channels.map((c) => c.name),
    [channels],
  );
  const reviewCount = useMemo(
    () =>
      items.reduce(
        (n, i) => n + countFor(i, suggestions[i.ratingKey], edits, dismissed),
        0,
      ),
    [items, suggestions, edits, dismissed],
  );
  const suggestionCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of items) {
      const n = countFor(i, suggestions[i.ratingKey], edits, dismissed);
      if (n > 0) m.set(i.ratingKey, n);
    }
    return m;
  }, [items, suggestions, edits, dismissed]);

  // ---------------------------------------------------------------- screens

  if (statusLoading && !status) {
    return <div className="centered pulse">Loading…</div>;
  }
  if (!offline && status && !authed) {
    return (
      <SignIn
        onAuthed={loadStatus}
        onBrowseCached={() => setOffline(true)}
      />
    );
  }
  if (!offline && status && authed && (!status.server || status.serverError)) {
    return (
      <>
        {status.serverError && (
          <div className="banner error">
            Could not reach {status.server?.name}: {status.serverError}
          </div>
        )}
        <ServerPicker onSelected={loadStatus} />
      </>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-row topbar-row-1">
          <h1 className="logo">
            Plex<span>Tags</span>
          </h1>
          <nav className="kind-toggle">
            {(["movie", "show"] as Kind[]).map((k) => (
              <button
                key={k}
                className={k === kind ? "active" : ""}
                onClick={() => switchKind(k)}
              >
                {k === "movie" ? "Movies" : "TV Shows"}
              </button>
            ))}
          </nav>
          <div className="spacer" />
          {evJob && (
            <span className="pulse refresh-progress">
              {evJob.note ?? "Working"}… {evJob.total ? `${evJob.done}/${evJob.total}` : ""}
            </span>
          )}
          {job && (
            <span className="pulse refresh-progress">
              Downloading… {job.done}/{job.total || "?"}
            </span>
          )}
          <div className="menu-wrap" ref={menuRef}>
            <button
              className="menu-trigger"
              onClick={() => setMenuOpen((o) => !o)}
              aria-label="More actions"
            >
              ⋯
            </button>
            {menuOpen && (
              <div className="menu">
                <button
                  onClick={() => {
                    if (!confirmDiscard()) return;
                    clearEdits();
                    startRefresh();
                    setMenuOpen(false);
                  }}
                  disabled={offline || saving || !section || !!job}
                  title={offline ? "Sign in to download from Plex" : "Re-download this library"}
                >
                  ⟳ Refresh library
                </button>
                <button
                  onClick={() => {
                    startEvidenceRefresh();
                    setMenuOpen(false);
                  }}
                  disabled={offline || saving || !library || !!evJob}
                  title={
                    evidenceCount
                      ? `Re-check Wikidata and Wikipedia (${evidenceCount} titles cached)`
                      : "Download genre data from Wikidata and Wikipedia"
                  }
                >
                  ⟳ Refresh evidence
                </button>
                {offline ? (
                  <button
                    className="link"
                    onClick={() => {
                      setOffline(false);
                      loadStatus();
                      setMenuOpen(false);
                    }}
                  >
                    Sign in
                  </button>
                ) : (
                  <button
                    className="link"
                    onClick={async () => {
                      if (!confirmDiscard()) return;
                      await api.logout();
                      setOffline(false);
                      clearEdits();
                      loadStatus();
                      setMenuOpen(false);
                    }}
                  >
                    Sign out
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="topbar-row topbar-row-2">
          <nav className="kind-toggle">
            <button
              className={view === "lineup" ? "active" : ""}
              onClick={() => setView("lineup")}
            >
              Genres
            </button>
            <button
              className={view === "collections" ? "active" : ""}
              onClick={() => setView("collections")}
            >
              Collections
            </button>
            <button
              className={view === "review" ? "active" : ""}
              onClick={() => setView("review")}
            >
              Review{reviewCount > 0 ? ` (${reviewCount})` : ""}
            </button>
          </nav>
          <div className="spacer" />
          <button
            onClick={view === "collections" ? newCollection : newChannel}
            disabled={!library || view === "review"}
          >
            {view === "collections" ? "+ New collection" : "+ New channel"}
          </button>
        </div>
      </header>

      {banner && (
        <div className="banner" onClick={() => setBanner(null)}>
          {banner}
        </div>
      )}
      {library?.seeded && (
        <div className="banner subtle">
          Showing data from the old CLI export — hit Refresh to download fresh
          data from Plex.
        </div>
      )}

      {!library && libraryMissing && (
        <div className="centered">
          <p>No downloaded data for {section?.title ?? kind} yet.</p>
          <button className="primary" onClick={() => startRefresh()} disabled={offline || !!job}>
            Download library
          </button>
        </div>
      )}
      {!library && !libraryMissing && !job && (
        <div className="centered muted">Loading library…</div>
      )}

      {library && view === "lineup" && (
        <Lineup
          channels={channels}
          items={items}
          suggestionCounts={suggestionCounts}
          onAdd={onAdd}
          onRemove={onRemove}
          onOpenTitle={setSelected}
        />
      )}

      {library && view === "review" && (
        <ReviewQueue
          items={items}
          suggestions={suggestions}
          dismissed={dismissed}
          edits={edits}
          hasEvidence={evidenceCount > 0}
          onAdd={onAdd}
          onRemove={onRemove}
          onDismiss={onDismiss}
          onOpenTitle={setSelected}
        />
      )}

      {library && view === "collections" && (
        <Collections
          channels={collectionChannels}
          items={items}
          onAdd={onCollAdd}
          onRemove={onCollRemove}
          onRename={onCollRename}
          onSummary={onCollSummary}
          onDelete={onCollDelete}
          onUndelete={onCollUndelete}
          onOpenTitle={setSelected}
        />
      )}

      {selected && (
        <TitleEditor
          item={selected}
          edits={edits}
          allGenres={allGenres}
          suggestion={visibleFor(
            selected,
            suggestions[selected.ratingKey],
            edits,
            dismissed,
          )}
          hasEvidence={evidenceCount > 0}
          onAdd={onAdd}
          onRemove={onRemove}
          onDismiss={onDismiss}
          collectionEdits={collectionEdits}
          collections={collections}
          stagedCreates={collectionOps.create}
          onCollAdd={onCollAdd}
          onCollRemove={onCollRemove}
          onClose={() => setSelected(null)}
        />
      )}

      <EditsTray
        edits={edits}
        collectionEdits={collectionEdits}
        ops={collectionOps}
        collections={collections}
        items={items}
        saving={saving}
        canSave={!offline}
        onAdd={onAdd}
        onRemove={onRemove}
        onCollAdd={onCollAdd}
        onCollRemove={onCollRemove}
        onUndoOp={onUndoOp}
        onDiscardAll={() => confirmDiscard() && clearEdits()}
        onSave={save}
      />

      {applyResults && (
        <div className="overlay" onClick={() => setApplyResults(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <header>
              <h2>Sync results</h2>
              <button className="action" onClick={() => setApplyResults(null)}>
                ×
              </button>
            </header>
            <p className="muted">
              Some operations failed. The library was re-downloaded, so the
              lineup reflects what actually stuck — re-queue anything missing.
            </p>
            <div className="results">
              {applyResults.map((r, i) => (
                <div key={i} className={r.ok ? "ok" : "fail"}>
                  {r.ok ? "✓" : "✗"} {r.title}: {r.op}
                  {!r.ok && ` (${r.status})`}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
