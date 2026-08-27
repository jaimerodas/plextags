"""Join Plex against Wikidata + Wikipedia, score the disagreements, and emit
the joined dataset plus a proposed corrections file.

  uv run python -m study.compare

Scoring, in one paragraph: a genre Plex asserts that no outside source supports
is an "extra"; a genre both outside sources support that Plex lacks is a
"missing". Confidence is driven by *source agreement* — Wikidata P136 and the
Wikipedia article are independent enough that when both say the same thing, the
disagreement with Plex is worth acting on; when only one does, it's a maybe.
Nothing here writes to Plex.
"""

from __future__ import annotations

import csv
import json
import urllib.parse
from collections import Counter, defaultdict

from study.normalize import (PLEX_VOCAB, canon,
                             evaluate, terms_in_phrase, to_plex)
from study.paths import (JOINED, JOINED_JSON, LIBRARY, OUT_DIR, corrections_path,
                         WIKIDATA, WIKIPEDIA)

# An "add" is only proposed when the genre already exists in the library (so it
# is a real channel) and at least this many titles support it. Open vocabulary
# is fine for reading; it is not fine for writing back to Plex unreviewed.
MIN_SUPPORT = 3


def load() -> tuple[dict, dict, dict]:
    lib = json.loads(LIBRARY.read_text(encoding="utf-8"))
    wd = json.loads(WIKIDATA.read_text(encoding="utf-8"))
    wp = json.loads(WIKIPEDIA.read_text(encoding="utf-8"))
    return lib, wd, wp


def build_rows(lib: dict, wd: dict, wp: dict) -> list[dict]:
    # imdb id -> parsed wikipedia article
    by_imdb = {i: v for v in wp.values() for i in v["imdb"]}

    rows = []
    for item in lib["items"]:
        imdb = item["ids"].get("imdb")
        w = wd.get(imdb) or {}
        art = by_imdb.get(imdb) or {}

        plex = set(item["genres"])

        wd_plex, wd_outside = to_plex(w.get("genres", []))
        # Wikipedia: TV uses the infobox |genre= field, film has no such field,
        # so fall back to the lead sentence (see study/wikipedia.py).
        wp_labels = list(art.get("infobox_genres", []))
        wp_labels += terms_in_phrase(art.get("lead_phrase"))
        wp_plex, wp_outside = to_plex(wp_labels)

        sources = sum(1 for s in (w.get("genres"), wp_labels) if s)
        evidence = len({canon(g) for g in w.get("genres", [])} |
                       {canon(g) for g in wp_labels})
        # All the judgement — guards included — lives in normalize.evaluate so
        # the study and the live app can't drift apart.
        v = evaluate(plex, wd_plex, wp_plex, sources, evidence)
        supported = set(v["supported"])
        extras = sorted(plex - supported) if (wd_plex | wp_plex) else []
        missing = v["add"]

        rows.append({
            "ratingKey": item["ratingKey"],
            "title": item["title"],
            "year": item["year"],
            "kind": item["kind"],
            "sectionId": item["sectionId"],
            "locked": item["locked"],
            "imdb": imdb,
            "article": w.get("article"),
            "plex": sorted(plex),
            "wikidata_raw": sorted(w.get("genres", [])),
            "wikidata_plex": sorted(wd_plex),
            "wikipedia_raw": sorted(set(wp_labels)),
            "wikipedia_plex": sorted(wp_plex),
            "lead_phrase": art.get("lead_phrase"),
            "outside_vocab": sorted(wd_outside | wp_outside),
            "sources": sources,
            "evidence": evidence,
            "extras": extras,
            "missing": missing,
            "extras_confident": v["remove"],
            "extras_soft": v["remove_soft"],
        })
    return rows


def lineup_health(rows: list[dict]) -> dict:
    health = {}
    for kind in ("movie", "show"):
        sub = [r for r in rows if r["kind"] == kind]
        if not sub:
            continue
        plex_counts = Counter(g for r in sub for g in r["plex"])
        prop_counts = Counter(
            g for r in sub for g in set(r["plex"] + r["missing"]) - set(r["extras"]))
        health[kind] = {
            "titles": len(sub),
            "plex_channels": plex_counts.most_common(),
            "proposed_channels": prop_counts.most_common(),
            "avg_plex": sum(len(r["plex"]) for r in sub) / len(sub),
            "avg_wikidata": (sum(len(r["wikidata_raw"]) for r in sub) / len(sub)),
            "singletons": sorted(g for g, n in plex_counts.items() if n == 1),
            "untagged": [r["title"] for r in sub if not r["plex"]],
        }
    return health


def candidate_channels(rows: list[dict]) -> list[tuple[str, int, list[str]]]:
    """Genres outside Plex's vocabulary, ranked by how many titles support them."""
    who = defaultdict(list)
    for r in rows:
        for g in r["outside_vocab"]:
            who[g].append(r["title"])
    return sorted(((g, len(t), sorted(t)) for g, t in who.items()),
                  key=lambda x: -x[1])


def proposed_corrections(rows: list[dict], mode: str = "both",
                         include_locked: bool = False) -> list[dict]:
    """corrections.json entries, in the format plex_genres.py apply accepts.

    Conservative on purpose: only removals both sources agree on, and only adds
    for genres that are already real channels with enough support.

    `mode` is "both", "removals" (over-tagging only) or "adds" (under-tagging
    only) — the two directions are independent judgements and worth applying
    separately.
    """
    support = Counter(g for r in rows for g in r["plex"])
    out = []
    for r in rows:
        if r["locked"] and not include_locked:
            # A locked genre field was written by a human (or by this tool on
            # their behalf), so by default it is left alone. Note that the lock
            # only records that *something* was edited once — not that every
            # genre on the item was deliberately approved.
            continue
        remove = r["extras_confident"] if mode in ("both", "removals") else []
        add = ([g for g in r["missing"]
                if g in PLEX_VOCAB and support.get(g, 0) >= MIN_SUPPORT]
               if mode in ("both", "adds") else [])
        # Never strip a title down to nothing. Plex's lifestyle categories
        # (Home and Garden, News, Food) have no Wikidata equivalent at all, so a
        # title carrying only one of those can have its entire genre list
        # "disproved" — which is how Grand Designs and Saturday Night Live ended
        # up with zero genres. An untagged title is worse than a debatable one.
        if remove and not add and not (set(r["plex"]) - set(remove)):
            continue
        if not remove and not add:
            continue
        entry = {"ratingKey": r["ratingKey"], "title": r["title"],
                 "kind": r["kind"], "sectionId": r["sectionId"]}
        if add:
            entry["add"] = add
        if remove:
            entry["remove"] = remove
        out.append(entry)
    return out


def validate_against_known(rows: list[dict]) -> dict:
    """Score the pipeline against the 8 corrections already applied by hand.

    Those items are marked genre-locked in Plex, and the removals are recorded
    in corrections.json at the repo root. If the pipeline can't rediscover them
    the normalisation rules are wrong.
    """
    try:
        known = json.loads((LIBRARY.parent.parent.parent / "corrections.json")
                           .read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}
    by_key = {r["ratingKey"]: r for r in rows}
    checks = []
    for c in known:
        r = by_key.get(c["ratingKey"])
        if not r:
            continue
        for g in c.get("remove", []):
            # Would the pipeline flag this genre as an extra, if Plex still had it?
            union = set(r["wikidata_plex"]) | set(r["wikipedia_plex"])
            checks.append({"title": c["title"], "genre": g,
                           "flagged": g not in union,
                           "sources": r["sources"]})
    hit = sum(1 for c in checks if c["flagged"])
    return {"checks": checks, "hit": hit, "total": len(checks)}


def main(mode: str = "both", include_locked: bool = False) -> int:
    lib, wd, wp = load()
    rows = build_rows(lib, wd, wp)
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    JOINED_JSON.write_text(json.dumps(rows, indent=1, ensure_ascii=False),
                           encoding="utf-8")
    with JOINED.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["ratingKey", "title", "year", "kind", "locked", "imdb",
                    "plex", "wikidata", "wikipedia", "extras",
                    "extras_confident", "missing", "outside_vocab"])
        for r in rows:
            w.writerow([r["ratingKey"], r["title"], r["year"], r["kind"],
                        r["locked"], r["imdb"], "; ".join(r["plex"]),
                        "; ".join(r["wikidata_raw"]), "; ".join(r["wikipedia_raw"]),
                        "; ".join(r["extras"]), "; ".join(r["extras_confident"]),
                        "; ".join(r["missing"]), "; ".join(r["outside_vocab"])])

    props = proposed_corrections(rows, mode, include_locked)
    # Split by section: `apply` uses one --section/--kind for the entire file, so
    # a mixed file would send TV edits to the movie library.
    groups = defaultdict(list)
    for p in props:
        groups[(p["kind"], p["sectionId"])].append(
            {k: v for k, v in p.items() if k not in ("kind", "sectionId")})
    written = []
    for (kind, sec), entries in sorted(groups.items()):
        path = corrections_path(kind, sec,
                                mode + ("_locked" if include_locked else ""))
        path.write_text(json.dumps(entries, indent=2, ensure_ascii=False),
                        encoding="utf-8")
        written.append((path, kind, sec, len(entries)))

    val = validate_against_known(rows)
    both = [r for r in rows if r["sources"] == 2]
    print(f"{len(rows)} titles joined -> {JOINED}")
    print(f"  with both sources     : {len(both)}")
    print(f"  with confident extras : {sum(1 for r in rows if r['extras_confident'])}")
    print(f"  with missing genres   : {sum(1 for r in rows if r['missing'])}")
    print(f"  proposed corrections  : {len(props)} titles")
    for path, kind, sec, n in written:
        print(f"     {n:3} {kind}s -> {path.name}")
        print(f"         python3 plex_genres.py apply --section {sec} "
              f"--kind {kind} --file {path} --dry-run")
    if val:
        print(f"\nvalidation vs the hand-corrections in corrections.json: "
              f"{val['hit']}/{val['total']} rediscovered")
        for c in val["checks"]:
            print(f"   {'HIT ' if c['flagged'] else 'MISS'}  {c['title']}: {c['genre']}")
    return 0


if __name__ == "__main__":
    import sys
    args = sys.argv[1:]
    raise SystemExit(main(args[0] if args else "both",
                          "--include-locked" in args))
