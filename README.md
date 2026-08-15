# PlexTags

A local web app for cleaning up the **genre tags** in your Plex library, presented
as a TV-style *channel lineup*: each genre is a "channel", and every movie or show
tagged with it is a title in that channel. You add and remove titles from channels,
review the queued changes, then push them all to Plex in one go.

Everything runs on your own machine and talks directly to your Plex Media Server.
Nothing is sent anywhere else.

## Why it exists

Plex's metadata agents assign genres generously and inconsistently — *DuckTales*
comes back tagged "Science Fiction" and "Action", *The Americans* picks up
"Mystery", and so on. Trying to fix that one title at a time in the Plex UI is
tedious because you can't see a genre as a group. This app inverts the view: you
look at the "Mystery" channel, spot the titles that clearly don't belong, and pull
them out.

When PlexTags writes a change it also sets `genre.locked=1` on the item, so Plex's
agents won't silently overwrite your correction on the next metadata refresh.

## Running it

```bash
bin/dev
```

That's it. The script installs any missing Python and npm dependencies, starts
both servers with tagged output, and prints the URL to open. Ctrl-C stops
everything.

```
bin/dev          both servers
bin/dev --api    backend only
bin/dev --web    frontend only
```

Requires `uv` and `npm` (`brew install uv node`).

Under the hood it's two processes: the FastAPI backend on port **8998** and the
Vite dev server on port **5173**. Vite proxies `/api` to the backend, so **open
http://localhost:5173** — not 8998. The backend does not serve the frontend.
If you'd rather run them by hand:

```bash
uv run uvicorn server.main:app --port 8998   # terminal 1
npm run dev --prefix web                      # terminal 2
```

`.claude/launch.json` defines the same two processes for tooling that reads it.

### First-time flow in the UI

1. **Sign in with Plex** — opens a plex.tv tab for the PIN approval flow. No token
   to copy and paste; the resulting token is stored in `data/config.json`.
2. **Pick a server** — the app lists the Plex Media Servers on your account and
   tests each connection URL for reachability, preferring local ones.
3. **Download library** — pulls all movies (or shows) and their genres into a local
   cache. This is a per-item fetch, so it takes a moment and shows progress.
4. **Edit the lineup** — expand a channel, remove titles that don't belong, use
   *+ New channel* to create a genre, or click a title to edit all of its genres at
   once in a modal.
5. **Sync** — the edits tray at the bottom shows everything queued. Saving writes
   the changes to Plex and then automatically re-downloads the library so what you
   see matches what actually stuck.

### Suggestions from Wikipedia

Hit **⟳ Wikipedia** once (about 40 seconds for a few hundred titles) and PlexTags
downloads what Wikidata and the English Wikipedia say about every title's genre.
After that it's all local — no waiting when you open something.

Each title then shows suggested additions and removals, with the Wikipedia lead
sentence next to them so you can judge rather than trust. **Accept** queues the
change into the normal edits tray; **Dismiss** hides that suggestion for good.
The **Review** tab walks you through every title with outstanding suggestions.

Suggestions are deliberately conservative. An addition needs both sources to
agree. A removal needs both sources present, specific, and silent on the tag —
and is never offered if it would leave a title with no genres at all, or for
genres Wikidata simply doesn't record (it calls *Cars* "buddy, comedy,
flashback" and never "family film", which doesn't make Family wrong).

There's also a **Browse cached data without signing in** link, which loads the
local cache read-only (useful for poking around offline).

## The original CLI

`plex_genres.py` is the standalone script the web app grew out of. It's
stdlib-only — no dependencies, no venv — and still works. It's handy for a quick
export or for scripted bulk edits.

```bash
export PLEX_URL="http://192.168.1.50:32400"
export PLEX_TOKEN="xxxxxxxxxxxxxxxxxxxx"

python3 plex_genres.py sections                       # find your section IDs
python3 plex_genres.py export --section 1 --kind movie # -> plex_movies.{csv,json}
python3 plex_genres.py export --section 2 --kind show  # -> plex_shows.{csv,json}

python3 plex_genres.py apply --section 2 --kind show \
    --file corrections.json --dry-run                  # preview
python3 plex_genres.py apply --section 2 --kind show --file corrections.json
```

Getting a token: sign in at app.plex.tv, open any movie → "..." → Get Info → View
XML. The token is the `X-Plex-Token=` value in that URL.

### corrections.json format

A list of objects, each keyed by `ratingKey`. Use `remove` and/or `add`, or `set`
to replace the whole genre list:

```json
[
  {"ratingKey": "2144", "title": "DuckTales", "remove": ["Science Fiction", "Action"]},
  {"ratingKey": "5678", "title": "Some Movie", "add": ["Comedy"], "remove": ["Horror"]},
  {"ratingKey": "9012", "title": "Another", "set": ["Action", "Adventure"]}
]
```

The `corrections.json` in the repo is the real batch that was applied to the TV
library — kept as a worked example.

## What's in the repo

```
bin/dev               dev launcher — installs deps, runs both servers
plex_genres.py        standalone CLI (stdlib only) — the original tool
corrections.json      example/applied correction batch for the CLI
plex_movies.{csv,json}  CLI exports; the JSON also seeds the web app's cache
plex_shows.{csv,json}   on first run, before you've hit Refresh

server/               FastAPI backend
  main.py             HTTP routes; background refresh jobs
  plex.py             Plex API client (auth, discovery, fetch, edits)
  evidence.py         Wikidata/Wikipedia genre evidence, batched and cached
  store.py            local JSON persistence in data/
web/                  React + TypeScript + Vite frontend
  src/App.tsx         top-level state and screen routing
  src/api.ts          typed fetch wrappers for the backend
  src/state/edits.ts  pending-edit model and the genre->channel grouping
  src/views/          Auth, Lineup, TitleEditor, EditsTray

data/                 gitignored: config.json (client id, Plex token, chosen
                      server) and library_<section>.json caches
```

## Two Plex API quirks worth knowing

Both are load-bearing; the code has comments where they matter.

1. **The bulk listing truncates genres.** `/library/sections/{id}/all` returns only
   the first few genre tags per item. To get complete lists, every item's metadata
   is fetched individually (`/library/metadata/{ratingKey}`). That's why a refresh
   is a few hundred requests and needs a progress bar.

2. **Genre removals must be one per request.** Plex's subtractive parameter
   `genre[].tag.tag-` honors only a single value per `PUT`; batching several
   removals silently drops all but one. Additions *can* be batched
   (`genre[0].tag.tag`, `genre[1].tag.tag`, …).
