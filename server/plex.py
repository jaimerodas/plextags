"""Plex API client: PIN auth flow, server discovery, library fetch, genre edits.

Ports the logic of plex_genres.py (see repo root) with two important quirks:

1. The bulk /library/sections/{id}/all listing TRUNCATES each item's genre
   list, so we fetch every item's full metadata individually.
2. Plex's subtractive genre param (genre[].tag.tag-) only honors ONE value
   per request, so removals are sent one per PUT. Adds can be batched.
"""

from __future__ import annotations

import concurrent.futures
import urllib.parse
from typing import Callable

import requests

PLEX_TV = "https://plex.tv"
PRODUCT = "PlexTags"

KIND_TYPE = {"movie": 1, "show": 2}


def _headers(client_id: str, token: str | None = None) -> dict:
    h = {
        "Accept": "application/json",
        "X-Plex-Client-Identifier": client_id,
        "X-Plex-Product": PRODUCT,
        "X-Plex-Version": "1.0",
        "X-Plex-Platform": "Web",
        "X-Plex-Device": "PlexTags",
    }
    if token:
        h["X-Plex-Token"] = token
    return h


# ---------------------------------------------------------------- auth (PIN)

def create_pin(client_id: str) -> dict:
    r = requests.post(f"{PLEX_TV}/api/v2/pins", params={"strong": "true"},
                      headers=_headers(client_id), timeout=10)
    r.raise_for_status()
    data = r.json()
    auth_url = "https://app.plex.tv/auth#?" + urllib.parse.urlencode({
        "clientID": client_id,
        "code": data["code"],
        "context[device][product]": PRODUCT,
    })
    return {"pinId": data["id"], "code": data["code"], "authUrl": auth_url}


def check_pin(client_id: str, pin_id: int) -> str | None:
    """Return the account auth token once the user has approved, else None."""
    r = requests.get(f"{PLEX_TV}/api/v2/pins/{pin_id}",
                     headers=_headers(client_id), timeout=10)
    r.raise_for_status()
    return r.json().get("authToken") or None


# ------------------------------------------------------------------ servers

def discover_servers(client_id: str, token: str) -> list[dict]:
    """List the account's Plex Media Servers with reachability-tested URLs."""
    r = requests.get(f"{PLEX_TV}/api/v2/resources",
                     params={"includeHttps": "1", "includeRelay": "0"},
                     headers=_headers(client_id, token), timeout=15)
    r.raise_for_status()
    servers = []
    for res in r.json():
        if "server" not in (res.get("provides") or ""):
            continue
        access_token = res.get("accessToken") or token
        conns = sorted(res.get("connections") or [],
                       key=lambda c: (not c.get("local"), c.get("protocol") != "http"))
        url = None
        for c in conns:
            if _reachable(c["uri"], client_id, access_token):
                url = c["uri"]
                break
        servers.append({
            "name": res.get("name"),
            "clientIdentifier": res.get("clientIdentifier"),
            "accessToken": access_token,
            "url": url,
            "reachable": url is not None,
        })
    return servers


def _reachable(uri: str, client_id: str, token: str) -> bool:
    try:
        r = requests.get(f"{uri}/identity", headers=_headers(client_id, token),
                         timeout=3, verify=False)
        return r.status_code == 200
    except requests.RequestException:
        return False


# ------------------------------------------------------------------ library

def get_sections(server_url: str, client_id: str, token: str) -> list[dict]:
    r = requests.get(f"{server_url}/library/sections",
                     headers=_headers(client_id, token), timeout=15, verify=False)
    r.raise_for_status()
    dirs = r.json().get("MediaContainer", {}).get("Directory", [])
    return [{"id": d["key"], "kind": d["type"], "title": d["title"]}
            for d in dirs if d.get("type") in KIND_TYPE]


def fetch_items(server_url: str, client_id: str, token: str, section: str,
                kind: str, progress: Callable[[int, int], None] | None = None,
                workers: int = 8) -> list[dict]:
    """Return [{ratingKey, title, year, genres[]}] with COMPLETE genre lists.

    The bulk listing truncates genres, so each item's metadata is fetched
    individually (parallelized; libraries here are a few hundred items).
    """
    headers = _headers(client_id, token)
    r = requests.get(f"{server_url}/library/sections/{section}/all",
                     params={"type": KIND_TYPE[kind]}, headers=headers,
                     timeout=30, verify=False)
    r.raise_for_status()
    entries = r.json().get("MediaContainer", {}).get("Metadata", [])
    total = len(entries)
    done = 0

    def fetch_one(entry: dict) -> dict:
        rk = entry["ratingKey"]
        genres = [g["tag"] for g in entry.get("Genre", [])]
        try:
            rr = requests.get(f"{server_url}/library/metadata/{rk}",
                              headers=headers, timeout=30, verify=False)
            if rr.status_code == 200:
                meta = rr.json().get("MediaContainer", {}).get("Metadata", [])
                if meta:
                    genres = [g["tag"] for g in meta[0].get("Genre", [])]
        except requests.RequestException:
            pass  # keep the truncated bulk genres rather than failing the run
        return {
            "ratingKey": rk,
            "title": entry.get("title"),
            "year": entry.get("year"),
            "genres": genres,
        }

    items = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        for item in pool.map(fetch_one, entries):
            items.append(item)
            done += 1
            if progress:
                progress(done, total)
    items.sort(key=lambda m: (m["title"] or "").lower())
    return items


# -------------------------------------------------------------------- apply

def apply_edits(server_url: str, client_id: str, token: str, section: str,
                kind: str, edits: list[dict]) -> list[dict]:
    """Apply [{ratingKey, title?, add[], remove[]}]; returns per-op results."""
    headers = _headers(client_id, token)
    libtype = KIND_TYPE[kind]
    results = []
    for edit in edits:
        rk = edit["ratingKey"]
        title = edit.get("title", rk)
        base = {"type": libtype, "id": rk, "genre.locked": 1}

        reqs: list[tuple[str, dict]] = []
        add = edit.get("add") or []
        remove = edit.get("remove") or []
        if add:
            p = dict(base)
            for i, g in enumerate(add):
                p[f"genre[{i}].tag.tag"] = g
            reqs.append((f"add {', '.join(add)}", p))
        # Removals MUST be one per request (Plex drops extras silently).
        for g in remove:
            p = dict(base)
            p["genre[].tag.tag-"] = g
            reqs.append((f"remove {g}", p))

        for desc, params in reqs:
            try:
                r = requests.put(f"{server_url}/library/sections/{section}/all",
                                 params=params, headers=headers, timeout=30,
                                 verify=False)
                ok, status = 200 <= r.status_code < 300, r.status_code
            except requests.RequestException as e:
                ok, status = False, str(e)
            results.append({"ratingKey": rk, "title": title, "op": desc,
                            "ok": ok, "status": status})
    return results
