import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  ApiError,
  ApplyResult,
  AuthStatus,
  Item,
  Kind,
  Library,
  RefreshJob,
  Section,
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
import { ServerPicker, SignIn } from "./views/Auth";
import { EditsTray } from "./views/EditsTray";
import { Lineup } from "./views/Lineup";
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

  useEffect(() => {
    loadStatus();
    return () => window.clearInterval(pollRef.current);
  }, [loadStatus]);

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
        <div className="spacer" />
        <button onClick={newChannel} disabled={!library}>
          + New channel
        </button>
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

      {library && (
        <Lineup
          channels={channels}
          items={items}
          onAdd={onAdd}
          onRemove={onRemove}
          onOpenTitle={setSelected}
        />
      )}

      {selected && (
        <TitleEditor
          item={selected}
          edits={edits}
          allGenres={allGenres}
          onAdd={onAdd}
          onRemove={onRemove}
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
