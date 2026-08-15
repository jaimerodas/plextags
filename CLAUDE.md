# CLAUDE.md

Guidance for Claude Code working in this repo. See README.md for the user-facing
overview.

## What this is

A local-only web app for bulk-editing Plex genre tags, viewed as a "channel
lineup" (genre = channel, titles = channel members). FastAPI backend + React/Vite
frontend, plus `plex_genres.py`, the stdlib-only CLI it grew out of.

## Running

```bash
bin/dev              # both servers; --api or --web for just one
```

`bin/dev` installs missing deps, runs both servers in their own process groups
with tagged output, and cleans both up on Ctrl-C. It is bash 3.2 compatible (the
macOS system bash) — no `wait -n`, no associative arrays. It relies on `set -m`
so that `kill -- -$pid` reaps each server's whole child tree; don't remove that.

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
  caches are `library_<sectionId>.json`.
- `web/src/state/edits.ts` — the interesting frontend logic. Edits are a
  `Map<ratingKey, {add, remove}>` treated as immutable, and `buildChannels()`
  overlays pending edits onto the library to produce the genre-grouped view with
  `kept` / `added` / `removed` statuses. Nothing is written to Plex until Save.
- `web/src/App.tsx` — all screen routing and top-level state; the `views/` files
  are presentational.

## Non-obvious constraints

Violating either of these produces silent, hard-to-spot data bugs.

1. **The bulk listing truncates genres.** `/library/sections/{id}/all` returns only
   the first few `Genre` tags per item. Complete genre lists require a per-item
   `GET /library/metadata/{ratingKey}`. Both `server/plex.py:fetch_items` and
   `plex_genres.py:fetch_items` do this and say so in comments. Never "optimize"
   the refresh by trusting the bulk response.

2. **Genre removals must be one PUT each.** `genre[].tag.tag-` honors exactly one
   value per request; batching removals silently drops all but one. Additions can
   be batched as `genre[0].tag.tag`, `genre[1].tag.tag`, … Both codepaths encode
   this.

Other things to preserve:

- Every write sends `genre.locked=1` so Plex's agents don't undo the correction.
- After a successful apply the app re-downloads the library, so the UI reflects
  what actually stuck rather than what was optimistically queued.
- TLS verification is disabled for the Plex server (`verify=False`, warnings
  suppressed in `main.py`) because local servers use plex.direct / self-signed
  certs. This is intentional for LAN use.
- Requests are keyed on `ratingKey`, which is stable per server but **not** across
  servers. Library caches are per section id for the same reason.
- `data/` and the root `plex_*.json` exports contain the user's real library and a
  live Plex token. `data/` is gitignored; don't add anything from it to commits,
  and don't echo tokens into logs or output.

## Backend/CLI parity

`server/plex.py` is a port of `plex_genres.py`. The CLI additionally supports
`set` (replace the whole genre list); the web app only does add/remove. If you
change how genres are written, check whether both files need the change.

`server/store.py` seeds an empty cache from the root `plex_movies.json` /
`plex_shows.json` CLI exports so there's something to look at before the first
refresh; the UI flags that data with a "seeded" banner.

## Conventions

- Python: `from __future__ import annotations`, modern type hints, module
  docstrings explaining the *why*. Comments are reserved for non-obvious behavior
  (mostly the two Plex quirks) — don't add narration.
- TypeScript: functional components, explicit `interface Props`, no state library,
  no CSS framework (`web/src/styles.css` is hand-written).
- Match the existing comment density: sparse, and only where the code would
  otherwise mislead.
