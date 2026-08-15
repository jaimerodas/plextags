#!/usr/bin/env python3
"""
plex_genres.py — pull and fix movie genres in a Plex library via the Plex API.

Standard library only. No pip installs needed. Works with Python 3.8+.

USAGE
-----
Set your server address and token once as environment variables (recommended),
or pass them with --url / --token on every call.

  export PLEX_URL="http://192.168.1.50:32400"
  export PLEX_TOKEN="xxxxxxxxxxxxxxxxxxxx"

1) See your movie libraries and their section IDs:
     python3 plex_genres.py sections

2) Export every movie + genres (writes plex_movies.csv and plex_movies.json):
     python3 plex_genres.py export --section 1

3) After we agree on fixes, apply them from a corrections file:
     python3 plex_genres.py apply --section 1 --file corrections.json
   Add --dry-run first to preview exactly what it would change.

GETTING A TOKEN
---------------
Sign in at app.plex.tv, open any movie, click the "..." menu > Get Info >
"View XML". The token is the X-Plex-Token=XXXX value at the end of that URL.
(Details: https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/)
"""

import argparse
import csv
import json
import os
import sys
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET


def get_config(args):
    url = args.url or os.environ.get("PLEX_URL")
    token = args.token or os.environ.get("PLEX_TOKEN")
    if not url or not token:
        sys.exit("ERROR: need a server URL and token. Set PLEX_URL and PLEX_TOKEN "
                 "env vars, or pass --url and --token.")
    return url.rstrip("/"), token


def request(url, token, path, params=None, method="GET"):
    params = dict(params or {})
    params["X-Plex-Token"] = token
    full = f"{url}{path}?{urllib.parse.urlencode(params, doseq=True)}"
    req = urllib.request.Request(full, method=method)
    req.add_header("Accept", "application/xml")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = resp.read()
            return resp.status, body
    except urllib.error.HTTPError as e:
        return e.code, e.read()
    except Exception as e:
        sys.exit(f"ERROR contacting Plex at {url}: {e}\n"
                 f"Check the address is reachable from this machine.")


def cmd_sections(args):
    url, token = get_config(args)
    status, body = request(url, token, "/library/sections")
    if status != 200:
        sys.exit(f"ERROR: server returned HTTP {status}. Check URL/token.")
    root = ET.fromstring(body)
    print(f"Libraries on {url}:\n")
    for d in root.findall("Directory"):
        kind = d.get("type")
        marker = "  <-- movies" if kind == "movie" else ""
        print(f"  section {d.get('key'):>3}  [{kind}]  {d.get('title')}{marker}")
    print("\nUse the section number of your movie library with --section.")


# Plex library-item types and their XML element names.
# Movies come back as <Video type="movie"> (type=1); TV shows come back as
# <Directory type="show"> (type=2). Genres are edited the same way for both.
KIND_TYPE = {"movie": 1, "show": 2}
KIND_ELEM = {"movie": "Video", "show": "Directory"}


def fetch_items(url, token, section, kind):
    """Return list of dicts: {ratingKey, title, year, genres[]}.

    IMPORTANT: the bulk /library/sections/{id}/all listing TRUNCATES the genre
    list per item (it returns only the first few tags). To get the complete,
    accurate genre set we fetch each item's full metadata individually.
    `kind` is "movie" or "show".
    """
    libtype = KIND_TYPE[kind]
    elem = KIND_ELEM[kind]
    status, body = request(url, token, f"/library/sections/{section}/all",
                           {"type": libtype})
    if status != 200:
        sys.exit(f"ERROR: server returned HTTP {status} listing section {section}.")
    root = ET.fromstring(body)
    entries = root.findall(elem)
    total = len(entries)
    print(f"Found {total} {kind}s. Fetching full genre metadata for each "
          f"(the bulk listing truncates genres)...", file=sys.stderr)
    items = []
    for i, v in enumerate(entries, 1):
        rk = v.get("ratingKey")
        item = {
            "ratingKey": rk,
            "title": v.get("title"),
            "year": v.get("year"),
            "genres": [],
        }
        st, bd = request(url, token, f"/library/metadata/{rk}")
        if st == 200:
            r = ET.fromstring(bd)
            vv = r.find(elem)
            if vv is not None:
                item["genres"] = [g.get("tag") for g in vv.findall("Genre")]
        else:
            # Fall back to the (truncated) bulk data if detail fetch fails.
            item["genres"] = [g.get("tag") for g in v.findall("Genre")]
        items.append(item)
        if i % 25 == 0 or i == total:
            print(f"  ...{i}/{total}", file=sys.stderr)
    items.sort(key=lambda m: (m["title"] or "").lower())
    return items


def cmd_export(args):
    url, token = get_config(args)
    kind = args.kind
    items = fetch_items(url, token, args.section, kind)
    base = f"plex_{kind}s"  # plex_movies or plex_shows

    with open(f"{base}.json", "w", encoding="utf-8") as f:
        json.dump(items, f, indent=2, ensure_ascii=False)

    with open(f"{base}.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["ratingKey", "title", "year", "genres"])
        for m in items:
            w.writerow([m["ratingKey"], m["title"], m["year"],
                        ", ".join(m["genres"])])

    total_genre_uses = sum(len(m["genres"]) for m in items)
    print(f"Exported {len(items)} {kind}s ({total_genre_uses} genre tags total).")
    print(f"Wrote {base}.csv and {base}.json in the current folder.")
    print(f"Open the CSV to review, or send {base}.json back to me.")


def cmd_apply(args):
    """
    corrections.json format — a list of objects. Each needs ratingKey.
    Use "remove" and/or "add", OR "set" to replace the whole list.

      [
        {"ratingKey":"1234","title":"The Princess and the Frog",
         "remove":["Food"]},
        {"ratingKey":"5678","title":"Some Movie",
         "add":["Comedy"], "remove":["Horror"]},
        {"ratingKey":"9012","title":"Another",
         "set":["Action","Adventure"]}
      ]
    """
    url, token = get_config(args)
    with open(args.file, encoding="utf-8") as f:
        corrections = json.load(f)

    libtype = KIND_TYPE[args.kind]
    for c in corrections:
        rk = c["ratingKey"]
        title = c.get("title", rk)
        base = {"type": libtype, "id": rk, "genre.locked": 1}

        # Build a list of (description, params) requests. Genre REMOVALS must be
        # sent one-per-request: Plex's subtractive operator (genre[].tag.tag-)
        # only honors a single value per request, so batching several removals
        # into one request silently drops all but one.
        reqs = []
        if "set" in c:
            p = dict(base)
            for i, g in enumerate(c["set"]):
                p[f"genre[{i}].tag.tag"] = g
            reqs.append((f"set genres to {c['set']}", p))
        else:
            add = c.get("add", [])
            remove = c.get("remove", [])
            if add:
                p = dict(base)
                for i, g in enumerate(add):
                    p[f"genre[{i}].tag.tag"] = g
                reqs.append((f"add {add}", p))
            for g in remove:
                p = dict(base)
                p["genre[].tag.tag-"] = g
                reqs.append((f"remove {g}", p))

        if not reqs:
            print(f"SKIP  {title}: nothing to do")
            continue

        if args.dry_run:
            for desc, _ in reqs:
                print(f"[dry-run] {title}: {desc}")
            continue

        for desc, p in reqs:
            status, _ = request(url, token,
                                f"/library/sections/{args.section}/all",
                                p, method="PUT")
            ok = 200 <= status < 300
            print(f"{'OK  ' if ok else 'FAIL'}  {title}: {desc}"
                  + ("" if ok else f"  (HTTP {status})"))


def main():
    p = argparse.ArgumentParser(description="Pull and fix Plex movie genres.")
    p.add_argument("--url", help="Plex base URL, e.g. http://192.168.1.50:32400")
    p.add_argument("--token", help="X-Plex-Token")
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("sections", help="List libraries and their section IDs")

    e = sub.add_parser("export", help="Export movies/shows + genres to CSV/JSON")
    e.add_argument("--section", required=True, help="Library section ID")
    e.add_argument("--kind", choices=["movie", "show"], default="movie",
                   help="Library kind: movie (default) or show")

    a = sub.add_parser("apply", help="Apply genre corrections from a file")
    a.add_argument("--section", required=True, help="Library section ID")
    a.add_argument("--file", required=True, help="corrections.json path")
    a.add_argument("--kind", choices=["movie", "show"], default="movie",
                   help="Library kind: movie (default) or show")
    a.add_argument("--dry-run", action="store_true", help="Preview only")

    args = p.parse_args()
    {"sections": cmd_sections, "export": cmd_export, "apply": cmd_apply}[args.cmd](args)


if __name__ == "__main__":
    main()
