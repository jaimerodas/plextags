"""Shared filesystem layout for the study pipeline."""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "study" / "data"   # caches: raw pulls from Plex/Wikidata/Wikipedia
OUT_DIR = ROOT / "study" / "out"     # deliverables: report, csv, corrections

LIBRARY = DATA_DIR / "library.json"
WIKIDATA = DATA_DIR / "wikidata.json"
WIKITEXT = DATA_DIR / "wikitext.json"    # raw article source, cached so that
WIKIPEDIA = DATA_DIR / "wikipedia.json"  # re-parsing never needs a refetch

JOINED = OUT_DIR / "joined.csv"
JOINED_JSON = OUT_DIR / "joined.json"
# One file per section: plex_genres.py apply takes a single --section/--kind for
# the whole file, so movies and shows must never share one.
def corrections_path(kind: str, section_id: str, mode: str = "both"):
    tag = "" if mode == "both" else f"_{mode}"
    return OUT_DIR / f"proposed_corrections{tag}_{kind}_section{section_id}.json"
REPORT = OUT_DIR / "report.html"
