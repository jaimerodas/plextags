"""PlexTags backend — FastAPI app. Run with:  uv run uvicorn server.main:app"""

from __future__ import annotations

import threading
import urllib3
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from . import plex, store

# Local Plex servers often use self-signed/plex.direct certs; we skip verify.
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

app = FastAPI(title="PlexTags")


def _cfg() -> dict:
    return store.load_config()


def _server_or_400(cfg: dict) -> dict:
    server = cfg.get("server")
    if not server or not server.get("url"):
        raise HTTPException(400, "No Plex server selected")
    return server


# ---------------------------------------------------------------------- auth

@app.post("/api/auth/pin")
def auth_pin():
    return plex.create_pin(_cfg()["clientId"])


@app.get("/api/auth/pin/{pin_id}")
def auth_pin_check(pin_id: int):
    cfg = _cfg()
    token = plex.check_pin(cfg["clientId"], pin_id)
    if token:
        cfg["plexToken"] = token
        store.save_config(cfg)
    return {"authenticated": bool(token)}


@app.get("/api/auth/status")
def auth_status():
    cfg = _cfg()
    authenticated = bool(cfg.get("plexToken"))
    server = cfg.get("server")
    sections, server_error = None, None
    if authenticated and server:
        try:
            sections = plex.get_sections(server["url"], cfg["clientId"],
                                         server["accessToken"])
        except Exception as e:
            server_error = str(e)
    return {"authenticated": authenticated,
            "server": {"name": server["name"], "url": server["url"]} if server else None,
            "sections": sections, "serverError": server_error}


@app.post("/api/auth/logout")
def auth_logout():
    cfg = _cfg()
    cfg.pop("plexToken", None)
    cfg.pop("server", None)
    store.save_config(cfg)
    return {"ok": True}


# ------------------------------------------------------------------- servers

@app.get("/api/servers")
def servers():
    cfg = _cfg()
    if not cfg.get("plexToken"):
        raise HTTPException(401, "Not authenticated with Plex")
    return plex.discover_servers(cfg["clientId"], cfg["plexToken"])


class ServerChoice(BaseModel):
    name: str
    url: str
    accessToken: str


@app.post("/api/server")
def select_server(choice: ServerChoice):
    cfg = _cfg()
    cfg["server"] = choice.model_dump()
    store.save_config(cfg)
    return {"ok": True}


# ------------------------------------------------------------------- library

@app.get("/api/sections")
def sections():
    cfg = _cfg()
    server = _server_or_400(cfg)
    return plex.get_sections(server["url"], cfg["clientId"], server["accessToken"])


@app.get("/api/sections/{section_id}/items")
def items(section_id: str, kind: str):
    lib = store.load_library(section_id, kind)
    if not lib:
        raise HTTPException(404, "No cached library — refresh first")
    return lib


# One refresh job per section, run on a thread so the UI can poll progress.
_jobs: dict[str, dict] = {}
_jobs_lock = threading.Lock()


class RefreshRequest(BaseModel):
    kind: str


@app.post("/api/sections/{section_id}/refresh")
def refresh_start(section_id: str, req: RefreshRequest):
    cfg = _cfg()
    server = _server_or_400(cfg)
    with _jobs_lock:
        job = _jobs.get(section_id)
        if job and job["running"]:
            return job
        job = {"running": True, "done": 0, "total": 0, "error": None}
        _jobs[section_id] = job

    def progress(done: int, total: int):
        job["done"], job["total"] = done, total

    def run():
        try:
            items = plex.fetch_items(server["url"], cfg["clientId"],
                                     server["accessToken"], section_id,
                                     req.kind, progress)
            store.save_library(section_id, req.kind, items)
        except Exception as e:
            job["error"] = str(e)
        finally:
            job["running"] = False

    threading.Thread(target=run, daemon=True).start()
    return job


@app.get("/api/sections/{section_id}/refresh")
def refresh_status(section_id: str):
    return _jobs.get(section_id) or {"running": False, "done": 0, "total": 0,
                                     "error": None}


# --------------------------------------------------------------------- apply

class Edit(BaseModel):
    ratingKey: str
    title: str | None = None
    add: list[str] = []
    remove: list[str] = []


class ApplyRequest(BaseModel):
    kind: str
    edits: list[Edit]


@app.post("/api/sections/{section_id}/apply")
def apply(section_id: str, req: ApplyRequest):
    cfg = _cfg()
    server = _server_or_400(cfg)
    results = plex.apply_edits(server["url"], cfg["clientId"],
                               server["accessToken"], section_id, req.kind,
                               [e.model_dump() for e in req.edits])
    return {"results": results, "ok": all(r["ok"] for r in results)}
