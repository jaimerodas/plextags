"""Fetch genre (P136) and the en-wiki article for every title, keyed by IMDb ID.

Wikidata is the spine of the comparison rather than Wikipedia itself because
Template:Infobox film has no |genre= parameter at all — WikiProject Film removed
it as too subjective — so for movies Wikipedia states genre only in lead-sentence
prose. P136 is structured, covers films and series alike, and joins to Plex by
exact IMDb ID (P345) instead of fuzzy title matching.

  uv run python -m study.wikidata
"""

from __future__ import annotations

import json
import time
import urllib.parse
import urllib.request

from study.paths import DATA_DIR, LIBRARY, WIKIDATA

ENDPOINT = "https://query.wikidata.org/sparql"
# Wikimedia asks automated clients to identify themselves and stay polite.
UA = "PlexTagsGenreStudy/0.1 (personal library research; single-run batch)"
BATCH = 100

QUERY = """
SELECT ?imdb ?item ?itemLabel ?genreLabel ?article WHERE {
  VALUES ?imdb { %s }
  ?item wdt:P345 ?imdb .
  OPTIONAL { ?item wdt:P136 ?genre . }
  OPTIONAL {
    ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> .
  }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
"""


def sparql(query: str, retries: int = 3) -> dict:
    body = urllib.parse.urlencode({"query": query, "format": "json"}).encode()
    req = urllib.request.Request(ENDPOINT, data=body,
                                 headers={"User-Agent": UA,
                                          "Accept": "application/sparql-results+json"})
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                return json.load(r)
        except Exception as e:  # noqa: BLE001 - transient 429/timeout, back off
            if attempt == retries - 1:
                raise
            wait = 5 * (attempt + 1)
            print(f"  query failed ({e}); retrying in {wait}s")
            time.sleep(wait)
    raise AssertionError("unreachable")


def fetch(imdb_ids: list[str]) -> dict[str, dict]:
    found: dict[str, dict] = {}
    for i in range(0, len(imdb_ids), BATCH):
        chunk = imdb_ids[i:i + BATCH]
        print(f"  wikidata {i + 1}-{i + len(chunk)} of {len(imdb_ids)}…")
        values = " ".join(f'"{x}"' for x in chunk)
        for b in sparql(QUERY % values)["results"]["bindings"]:
            key = b["imdb"]["value"]
            entry = found.setdefault(key, {"item": None, "label": None,
                                           "genres": [], "article": None})
            entry["item"] = b["item"]["value"].rsplit("/", 1)[-1]
            entry["label"] = b.get("itemLabel", {}).get("value")
            if "article" in b:
                entry["article"] = b["article"]["value"]
            g = b.get("genreLabel", {}).get("value")
            if g and g not in entry["genres"]:
                entry["genres"].append(g)
    return found


def main() -> int:
    lib = json.loads(LIBRARY.read_text(encoding="utf-8"))
    ids = sorted({i["ids"]["imdb"] for i in lib["items"] if i["ids"].get("imdb")})
    print(f"looking up {len(ids)} imdb ids on wikidata")
    found = fetch(ids)

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    WIKIDATA.write_text(json.dumps(found, indent=1, ensure_ascii=False),
                        encoding="utf-8")

    with_genre = sum(1 for v in found.values() if v["genres"])
    with_article = sum(1 for v in found.values() if v["article"])
    print(f"\n{len(found)}/{len(ids)} matched a wikidata item -> {WIKIDATA}")
    print(f"  with P136 genre : {with_genre}")
    print(f"  with en-wiki    : {with_article}")
    missing = [i for i in ids if i not in found]
    if missing:
        print(f"  no wikidata item: {', '.join(missing)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
