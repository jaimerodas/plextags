"""Outside-source genre evidence for the library, cached for the app to serve.

What this stores is deliberately *not* "remove Crime from Ace Ventura". It stores
what Wikidata and Wikipedia say about each title, normalised into Plex's
vocabulary. Suggestions are derived from that at render time by diffing against
the item's CURRENT genres, so accepting an edit or refreshing from Plex makes the
suggestion correct itself instead of going stale.

Everything about *judgement* — what "space opera" implies, which genres can't be
argued away by silence — lives in study/normalize.py and is shared with the
offline study, so the two can't drift.

Fetching is always batched across the whole library: per-item lookups cost ~1s
each and get rate-limited, while 100 ids per SPARQL query is ~10ms/item and 20
articles per request is ~52ms/item. A full pull is ~40s for a few hundred titles.
"""

from __future__ import annotations

import time
from typing import Callable

from study import wikidata, wikipedia
from study.normalize import canon, evaluate, terms_in_phrase, to_plex

Progress = Callable[[int, int, str], None]


def _article_title(url: str | None) -> str | None:
    if not url:
        return None
    import urllib.parse
    return urllib.parse.unquote(url.rsplit("/", 1)[-1]).replace("_", " ")


def build(items: list[dict], progress: Progress | None = None) -> dict:
    """Fetch and normalise evidence for every item that has an IMDb id.

    `items` are library entries from plex.fetch_items (needing `ratingKey` and
    `ids`). Returns {ratingKey: evidence} plus a `fetchedAt` stamp.
    """
    def step(done: int, total: int, note: str) -> None:
        if progress:
            progress(done, total, note)

    with_imdb = [i for i in items if (i.get("ids") or {}).get("imdb")]
    imdb_ids = sorted({i["ids"]["imdb"] for i in with_imdb})
    total = len(imdb_ids) * 2 or 1  # two phases, for a sane progress bar

    step(0, total, "Looking up Wikidata…")
    wd = wikidata.fetch(imdb_ids)
    step(len(imdb_ids), total, "Reading Wikipedia articles…")

    titles = sorted({t for t in
                     (_article_title((wd.get(i) or {}).get("article"))
                      for i in imdb_ids) if t})
    text = wikipedia.fetch_wikitext(titles)
    step(len(imdb_ids) * 2, total, "Normalising…")

    out: dict[str, dict] = {}
    for item in with_imdb:
        imdb = item["ids"]["imdb"]
        w = wd.get(imdb) or {}
        art = _article_title(w.get("article"))
        raw_wp: list[str] = []
        phrase = None
        if art and art in text:
            raw_wp = list(wikipedia.infobox_genres(text[art]))
            phrase, _ = wikipedia.lead_genres(text[art])
            raw_wp += terms_in_phrase(phrase)

        wd_plex, wd_outside = to_plex(w.get("genres", []))
        wp_plex, wp_outside = to_plex(raw_wp)
        sources = sum(1 for s in (w.get("genres"), raw_wp) if s)
        evidence = len({canon(g) for g in w.get("genres", [])} |
                       {canon(g) for g in raw_wp})

        out[item["ratingKey"]] = {
            "wd": sorted(wd_plex),
            "wp": sorted(wp_plex),
            "outside": sorted(wd_outside | wp_outside),
            "sources": sources,
            "evidence": evidence,
            # Shown in the UI so a suggestion can be judged rather than trusted.
            "why": phrase,
            "raw": sorted(w.get("genres", [])),
            "article": w.get("article"),
        }
    return {"fetchedAt": time.time(), "items": out}


def suggest(item: dict, ev: dict | None) -> dict:
    """Suggestions for one item, against its current genres.

    Kept server-side so the guards in normalize.evaluate apply once, in one
    language. The client only hides what has been dismissed.
    """
    if not ev:
        return {"add": [], "remove": [], "removeSoft": [], "outside": [],
                "why": None, "article": None, "hasEvidence": False}
    v = evaluate(set(item.get("genres") or []), set(ev["wd"]), set(ev["wp"]),
                 ev["sources"], ev["evidence"])
    return {
        "add": v["add"],
        "remove": v["remove"],
        "removeSoft": v["remove_soft"],
        "outside": ev["outside"],
        "why": ev["why"],
        "article": ev["article"],
        "raw": ev["raw"],
        "hasEvidence": True,
    }
