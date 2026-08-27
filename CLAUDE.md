# CLAUDE.md

Guidance for Claude Code working in this repo. See README.md for the user-facing
overview.

## What this is

A local-only web app for bulk-editing Plex genre tags, viewed as a "channel
lineup" (genre = channel, titles = channel members). FastAPI backend + React/Vite
frontend, plus `plex_genres.py`, the stdlib-only CLI it grew out of.

The app also manages Plex collections on its own screen. It can edit
membership, create, rename, re-summarize, and delete collections. All
collection work uses the same staged model as genres: nothing touches Plex
until Save.

## Running

```bash
bin/dev              # both servers; --api or --web for just one
```

`bin/dev` installs missing deps, runs both servers in their own process groups
with tagged output, and cleans both up on Ctrl-C. It is bash 3.2 compatible (the
macOS system bash) — no `wait -n`, no associative arrays. It relies on `set -m`
so that `kill -- -$pid` reaps each server's whole child tree; don't remove that.

Two signal-handling details there are load-bearing, and both fail silently:

- `set -m` is switched **off** again once both servers are up. Monitor mode also
  puts every *foreground* command in its own process group and gives it the
  terminal, so leaving it on sends Ctrl-C to the poll loop's `sleep 1` instead of
  to the script — the INT trap never runs and Ctrl-C looks like it does nothing.
- The servers are started with stdin on `/dev/null`. Vite calls `setRawMode()` to
  bind its keyboard shortcuts, and `tcsetattr` from a background process group
  raises SIGTTOU, which suspends the whole job (`T` in `ps`). A stopped job holds
  a pending SIGTERM until it is resumed, so `shutdown` sends CONT after TERM.

Equivalent by hand — the frontend is **not** served by the backend:

```bash
uv run uvicorn server.main:app --port 8998   # backend
npm run dev --prefix web                      # frontend -> http://localhost:5173
```

Port 8998 is not optional — `web/vite.config.ts` proxies `/api` there, and both
`bin/dev` and `.claude/launch.json` hardcode it.

Python deps come from `pyproject.toml` via `uv` (`package = false`; there is no
installable package, just the `server/` module run in place). `plex_genres.py`
deliberately has **zero** dependencies — keep it that way; it should stay runnable
with a bare `python3`.

There are no tests and no linters configured.

## Architecture

```
Browser (React) --/api--> FastAPI (server/) --HTTP--> Plex Media Server
                              |
                              +--> data/*.json (config + library caches)
```

- `server/main.py` — routes only; delegates to `plex` and `store`. Refresh runs on
  a background thread per section with an in-memory `_jobs` dict the UI polls.
  Jobs are lost on restart by design.
- `server/plex.py` — all Plex HTTP. PIN auth against plex.tv, server discovery with
  reachability testing, parallel library fetch, genre edits.
- `server/store.py` — JSON files in `data/` (gitignored). `config.json` holds the
  generated `clientId`, the account `plexToken`, and the chosen server. Library
  caches are `library_<sectionId>.json`. Each cache also holds the section's
  collection metadata under a `collections` key, and each item carries its
  collection tags — one refresh snapshots both, so they cannot drift.
- `web/src/state/edits.ts` — the interesting frontend logic. Edits are a
  `Map<ratingKey, {add, remove}>` treated as immutable, and `buildChannels()`
  overlays pending edits onto the library to produce the tag-grouped view with
  `kept` / `added` / `removed` statuses. The module is generic over the tag
  type: callers pass the item's current tag list, so the same machinery serves
  genres and collection membership. Nothing is written to Plex until Save.
- `web/src/state/collections.ts` — the judgement layer for staged collection
  operations (create, rename, summary, delete). Every interaction rule lives
  here, never in components. Read its module docstring before you change how
  collections are staged.
- `web/src/App.tsx` — all screen routing and top-level state; the `views/` files
  are presentational.
- `server/evidence.py` — genre evidence from Wikidata/Wikipedia, cached in
  `data/evidence.json`. Fetching is **always batched across the whole library**:
  per-item lookups cost ~1s and get rate-limited, batched costs ~10ms (Wikidata,
  100 ids/query) and ~52ms (Wikipedia, 20 articles/request). A full pull is ~40s.
- `study/normalize.py` — the shared judgement layer. `evaluate()` is the single
  place that decides what counts as a disagreement, used by both the offline
  study and the live app so they can't drift.

## Non-obvious constraints

Violating either of these produces silent, hard-to-spot data bugs.

1. **The bulk listing truncates tags.** `/library/sections/{id}/all` returns only
   the first few `Genre` (and `Collection`) tags per item. Complete lists require
   a per-item `GET /library/metadata/{ratingKey}`. Both `server/plex.py:fetch_items`
   and `plex_genres.py:fetch_items` do this and say so in comments. Never
   "optimize" the refresh by trusting the bulk response.

2. **Tag removals must be one PUT each.** `genre[].tag.tag-` honors exactly one
   value per request; batching removals silently drops all but one. Additions can
   be batched as `genre[0].tag.tag`, `genre[1].tag.tag`, … The same rule applies
   to `collection[].tag.tag-`. `server/plex.py:_apply_tag_edits` encodes this for
   both tag types; `plex_genres.py` encodes it for genres.

3. **Store evidence, derive suggestions.** `data/evidence.json` holds what the
   outside sources *say*, never "remove Crime from X". Suggestions are recomputed
   from current genres on every `/api/evidence` call, so they self-correct when an
   edit lands instead of needing cache invalidation. Don't persist suggestions.

4. **The three guards in `normalize.evaluate` are load-bearing**, each added
   after it went wrong in production: `SOFT_GENRES` (Wikidata records narrative
   genre, so its silence about Family means nothing), `ADJACENT` (Plex splits
   Music/Musical, Wikidata doesn't), and the last-genre rule (Plex's lifestyle
   categories have no Wikidata equivalent, so a title tagged only "Home and
   Garden" can have its whole list "disproved" — this emptied two titles).
   `study/compare.py` scores itself against the local `corrections.json`
   (gitignored) and should stay at
   **9/10**; a drop means a guard broke.

5. **Collection operations have a fixed apply order.** The apply route runs
   deletes first, then genre edits, then collection membership, then renames and
   summaries. Deletes go first so that "delete X, recreate X" tags members into
   a fresh collection. Renames go last so that membership tags still name the
   titles Plex knows. Membership edits are always keyed by the current server
   title, never a staged new name. A rename is one metadata PUT with `type=18`
   on the section's `/all` endpoint — never untag-plus-retag, which loses the
   poster and the sort order. Plex creates a collection implicitly on its first
   member tag; there is no way to create an empty one, so staged creates with
   no members are dropped at Save.

Other things to preserve:

- Every tag write sends `genre.locked=1` (or `collection.locked=1`) so Plex's
  agents don't undo the correction.
- After a successful apply the app re-downloads the library, so the UI reflects
  what actually stuck rather than what was optimistically queued.
- TLS verification is disabled for the Plex server (`verify=False`, warnings
  suppressed in `main.py`) because local servers use plex.direct / self-signed
  certs. This is intentional for LAN use.
- Requests are keyed on `ratingKey`, which is stable per server but **not** across
  servers. Library caches are per section id for the same reason.
- `data/`, the root `plex_*.{csv,json}` exports, and `corrections.json` describe
  the real library, and `data/config.json` holds a live Plex token. All of them
  are gitignored; never add any of them to a commit, and don't echo tokens into
  logs or output.

## Backend/CLI parity

`server/plex.py` is a port of `plex_genres.py`. The CLI additionally supports
`set` (replace the whole genre list); the web app only does add/remove. If you
change how genres are written, check whether both files need the change.

The CLI has no collections support, on purpose. Collections are web-app-only
scope; the parity rule covers genre writes.

`server/store.py` seeds an empty cache from the root `plex_movies.json` /
`plex_shows.json` CLI exports (local-only, gitignored) so there's something to
look at before the first refresh; the UI flags that data with a "seeded" banner.

## Conventions

- Python: `from __future__ import annotations`, modern type hints, module
  docstrings explaining the *why*. Comments are reserved for non-obvious behavior
  (mostly the two Plex quirks) — don't add narration.
- TypeScript: functional components, explicit `interface Props`, no state library,
  no CSS framework (`web/src/styles.css` is hand-written).
- Match the existing comment density: sparse, and only where the code would
  otherwise mislead.
