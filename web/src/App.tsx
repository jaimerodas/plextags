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
import { countFor, visibleFor } from "./state/suggestions";
import { ServerPicker, SignIn } from "./views/Auth";
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
  const [extraChannels, setExtraChannels] = useState<string[]>([]);
  const [selected, setSelected] = useState<Item | null>(null);

  const [view, setView] = useState<"lineup" | "review">("lineup");
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
    const n = editCount(edits);
    if (n === 0) return true;
    return window.confirm(`Discard ${n} pending change${n === 1 ? "" : "s"}?`);
  }

  function switchKind(k: Kind) {
    if (k === kind || saving) return;
    if (!confirmDiscard()) return;
    setEdits(emptyEdits());
    setExtraChannels([]);
    setSelected(null);
    setKind(k);
  }

  const onAdd = (item: Item, genre: string) =>
    setEdits((e) => queueAdd(e, item, genre));
  const onRemove = (item: Item, genre: string) =>
    setEdits((e) => queueRemove(e, item, genre));

  function newChannel() {
    const g = window.prompt("New channel (genre) name:")?.trim();
    if (!g) return;
    setExtraChannels((cs) => (cs.includes(g) ? cs : [...cs, g].sort()));
  }

  async function save() {
    if (!section || saving) return;
    setSaving(true);
    setBanner(null);
    try {
      const { results, ok } = await api.apply(
        section.id,
        section.kind,
        toPayload(edits, library?.items ?? []),
      );
      if (!ok) setApplyResults(results);
      setEdits(emptyEdits());
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
    () => buildChannels(items, edits, extraChannels),
    [items, edits, extraChannels],
  );
  const allGenres = useMemo(
    () => channels.map((c) => c.genre),
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
        <nav className="kind-toggle">
          <button
            className={view === "lineup" ? "active" : ""}
            onClick={() => setView("lineup")}
          >
            Lineup
          </button>
          <button
            className={view === "review" ? "active" : ""}
            onClick={() => setView("review")}
          >
            Review{reviewCount > 0 ? ` (${reviewCount})` : ""}
          </button>
        </nav>
        <div className="spacer" />
        <button onClick={newChannel} disabled={!library || view !== "lineup"}>
          + New channel
        </button>
        {evJob ? (
          <span className="pulse refresh-progress">
            {evJob.note ?? "Working"}… {evJob.total ? `${evJob.done}/${evJob.total}` : ""}
          </span>
        ) : (
          <button
            onClick={startEvidenceRefresh}
            disabled={offline || saving || !library}
            title={
              evidenceCount
                ? `Re-check Wikidata and Wikipedia (${evidenceCount} titles cached)`
                : "Download genre data from Wikidata and Wikipedia"
            }
          >
            ⟳ Wikipedia
          </button>
        )}
        {job ? (
          <span className="pulse refresh-progress">
            Downloading… {job.done}/{job.total || "?"}
          </span>
        ) : (
          <button
            onClick={() => confirmDiscard() && (setEdits(emptyEdits()), startRefresh())}
            disabled={offline || saving || !section}
            title={offline ? "Sign in to download from Plex" : "Re-download this library"}
          >
            ⟳ Refresh
          </button>
        )}
        {offline ? (
          <button className="link" onClick={() => { setOffline(false); loadStatus(); }}>
            Sign in
          </button>
        ) : (
          <button
            className="link"
            onClick={async () => {
              if (!confirmDiscard()) return;
              await api.logout();
              setOffline(false);
              setEdits(emptyEdits());
              loadStatus();
            }}
          >
            Sign out
          </button>
        )}
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
          onClose={() => setSelected(null)}
        />
      )}

      <EditsTray
        edits={edits}
        items={items}
        saving={saving}
        canSave={!offline}
        onAdd={onAdd}
        onRemove={onRemove}
        onDiscardAll={() => confirmDiscard() && setEdits(emptyEdits())}
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
