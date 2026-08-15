"""Pull the live Plex library (with external IDs) into study/data/library.json.

Reuses the app's own client and stored credentials, so there's nothing extra to
configure — sign in through the web app first if data/config.json is empty.

  uv run python -m study.harvest
"""

from __future__ import annotations

import json
import sys

import urllib3

from server import plex, store
from study.paths import DATA_DIR, LIBRARY

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# Section 3 ("Commercials") holds unmatched home-media rips: no metadata agent
# match, no Guid[], nothing to compare against. Study only real libraries.
SKIP_SECTION_TITLES = {"commercials"}


def main() -> int:
    cfg = store.load_config()
    server = cfg.get("server")
    if not server or not server.get("url"):
        sys.exit("No Plex server selected. Sign in via the web app first "
                 "(bin/dev), then re-run.")

    sections = plex.get_sections(server["url"], cfg["clientId"],
                                 server["accessToken"])
    out = {"server": server["name"], "sections": [], "items": []}

    for sec in sections:
        if sec["title"].strip().lower() in SKIP_SECTION_TITLES:
            print(f"skipping section {sec['id']} ({sec['title']})")
            continue
        print(f"fetching section {sec['id']} ({sec['title']}, {sec['kind']})…")

        def progress(done: int, total: int) -> None:
            print(f"\r  {done}/{total}", end="", flush=True)

        items = plex.fetch_items(server["url"], cfg["clientId"],
                                 server["accessToken"], sec["id"], sec["kind"],
                                 progress)
        print()
        for it in items:
            it["kind"] = sec["kind"]
            it["sectionId"] = sec["id"]
        out["sections"].append(sec)
        out["items"].extend(items)

    # An item whose detail fetch failed carries truncated genres and no ids, and
    # is indistinguishable from real data downstream — so refuse to save instead.
    incomplete = [i for i in out["items"] if not i["complete"]]
    if incomplete:
        print(f"\n{len(incomplete)} items failed their detail fetch after retries:")
        for i in incomplete:
            print(f"     {i['title']} ({i['year']})")
        sys.exit("Refusing to write a partial library — re-run when the server "
                 "is responding reliably.")

    matched = [i for i in out["items"] if i["ids"].get("imdb")]
    unmatched = [i for i in out["items"] if not i["ids"].get("imdb")]
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    LIBRARY.write_text(json.dumps(out, indent=1, ensure_ascii=False),
                       encoding="utf-8")

    print(f"\n{len(out['items'])} items -> {LIBRARY}")
    print(f"  with imdb id : {len(matched)}")
    print(f"  unmatched    : {len(unmatched)}  (no metadata-agent match)")
    for i in unmatched:
        print(f"     {i['title']} ({i['year']}) in section {i['sectionId']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
