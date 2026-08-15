"""Local persistence: config (client id, tokens, server) and library caches."""

from __future__ import annotations

import json
import time
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
CONFIG_PATH = DATA_DIR / "config.json"

# Exports from the earlier CLI workflow, used to seed caches on first run.
SEED_FILES = {"movie": ROOT / "plex_movies.json", "show": ROOT / "plex_shows.json"}


def _load_json(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def _save_json(path: Path, data) -> None:
    DATA_DIR.mkdir(exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False),
                    encoding="utf-8")


def load_config() -> dict:
    cfg = _load_json(CONFIG_PATH) or {}
    if "clientId" not in cfg:
        cfg["clientId"] = str(uuid.uuid4())
        save_config(cfg)
    return cfg


def save_config(cfg: dict) -> None:
    _save_json(CONFIG_PATH, cfg)


def library_path(section_id: str) -> Path:
    return DATA_DIR / f"library_{section_id}.json"


def load_library(section_id: str, kind: str | None = None) -> dict | None:
    """Cached library for a section; falls back to the old CLI export files."""
    cached = _load_json(library_path(section_id))
    if cached:
        return cached
    if kind and (seed := _load_json(SEED_FILES.get(kind, Path()))):
        return {"sectionId": section_id, "kind": kind, "seeded": True,
                "savedAt": SEED_FILES[kind].stat().st_mtime, "items": seed}
    return None


def save_library(section_id: str, kind: str, items: list[dict]) -> dict:
    data = {"sectionId": section_id, "kind": kind, "seeded": False,
            "savedAt": time.time(), "items": items}
    _save_json(library_path(section_id), data)
    return data
