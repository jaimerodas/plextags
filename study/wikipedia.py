"""Second genre signal, straight from the English Wikipedia article.

Two different extractions, because Wikipedia treats the two media differently:

  * TV shows  -> Template:Infobox television has a real |genre= parameter.
  * Films     -> Template:Infobox film has NO genre parameter (WikiProject Film
                 removed it as inherently subjective), so the only statement of
                 genre is the lead sentence: "... is a 2009 American animated
                 musical fantasy comedy film produced by ...".

This exists to corroborate Wikidata, not to replace it: agreement between the two
is what makes a disagreement with Plex worth acting on.

  uv run python -m study.wikipedia
"""

from __future__ import annotations

import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request

from study.paths import DATA_DIR, LIBRARY, WIKIDATA, WIKIPEDIA, WIKITEXT

API = "https://en.wikipedia.org/w/api.php"
UA = "PlexTagsGenreStudy/0.1 (personal library research; single-run batch)"
BATCH = 20     # titles per request; rvprop=content makes these responses large
THROTTLE = 1.5  # seconds between requests — full-wikitext batches get 429'd fast

# Words that show up in a lead sentence's pre-"film" run but aren't genres.
NOT_GENRES = {
    "american", "british", "canadian", "australian", "french", "japanese",
    "irish", "german", "italian", "spanish", "mexican", "indian", "korean",
    "chinese", "soviet", "russian", "swedish", "danish", "norwegian", "dutch",
    "new", "zealand", "hong", "kong", "co-production", "international",
    "silent", "black-and-white", "colour", "color", "feature", "featurette",
    "short", "full-length", "live-action", "direct-to-video", "made-for-tv",
    "upcoming", "unreleased", "independent", "indie", "low-budget",
    "the", "a", "an", "and", "or", "of", "in", "by",
}
DECADE = re.compile(r"^\d{4}s?$")


def api_get(params: dict, retries: int = 5) -> dict:
    """GET with backoff. The API returns 429 readily for content-sized batches."""
    url = API + "?" + urllib.parse.urlencode({**params, "format": "json"})
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code != 429 or attempt == retries - 1:
                raise
            wait = int(e.headers.get("Retry-After") or 0) or 10 * (attempt + 1)
            print(f"    rate limited; waiting {wait}s")
            time.sleep(wait)
        except urllib.error.URLError as e:
            if attempt == retries - 1:
                raise
            print(f"    {e}; retrying")
            time.sleep(5 * (attempt + 1))
    raise AssertionError("unreachable")


def _infobox(text: str, kind: str) -> str | None:
    """Body of {{Infobox film|television}}, brace-balanced."""
    m = re.search(r"\{\{\s*Infobox\s+" + kind, text, re.I)
    if not m:
        return None
    i, depth = m.start(), 0
    while i < len(text):
        if text.startswith("{{", i):
            depth += 1
            i += 2
        elif text.startswith("}}", i):
            depth -= 1
            i += 2
            if depth == 0:
                return text[m.start():i]
        else:
            i += 1
    return None


def _strip_markup(s: str) -> str:
    """Wikitext -> plain text, keeping the *display* side of piped links."""
    s = re.sub(r"<!--.*?-->", " ", s, flags=re.S)
    s = re.sub(r"<ref[^>]*/>|<ref.*?</ref>", " ", s, flags=re.S | re.I)
    # List templates wrap the values we want; drop the wrapper, keep contents.
    s = re.sub(r"\{\{\s*(plainlist|plain list|ubl|unbulleted list|hlist|flatlist)\s*\|",
               " ", s, flags=re.I)
    for _ in range(3):  # nested templates
        s = re.sub(r"\{\{[^{}]*\}\}", " ", s)
    s = re.sub(r"\[\[(?:[^\]|]*\|)?([^\]|]*)\]\]", r"\1", s)
    s = re.sub(r"\[https?://\S+\s+([^\]]*)\]", r"\1", s)
    s = re.sub(r"</?[a-z][^>]*>", " ", s, flags=re.I)
    s = s.replace("{{", " ").replace("}}", " ").replace("[[", " ").replace("]]", " ")
    s = re.sub(r"''+", "", s)
    return re.sub(r"[ \t]+", " ", s)


def infobox_genres(text: str) -> list[str]:
    """|genre= from Template:Infobox television (TV only — film has no such field)."""
    box = _infobox(text, "television")
    if not box:
        return []
    # [ \t]* not \s* after the '=': an EMPTY "| genre = " would otherwise let the
    # capture swallow the newline and run on into the next field, which is how
    # Grand Designs ended up with a genre of "presenter = Kevin McCloud".
    m = re.search(r"\n\s*\|\s*genres?\s*=[ \t]*(.*?)(?=\n\s*\|\s*[a-z_0-9]+\s*=|\Z)",
                  box, re.S | re.I)
    if not m or not m.group(1).strip():
        return []
    body = _strip_markup(m.group(1))
    out = []
    for p in re.split(r"\*|\n|,|;|/|<br\s*/?>", body):
        p = p.strip(" \t*[]|{}-–—").strip()
        if p and len(p) < 40 and p.lower() not in {"genre", "genres"}:
            out.append(p)
    return out


def lead_genres(text: str) -> tuple[str | None, list[str]]:
    """The genre run from the lead sentence.

    "The Princess and the Frog is a 2009 American animated musical fantasy
    comedy film produced by ..." -> ("animated musical fantasy comedy",
    ["animated", "musical", "fantasy", "comedy"]).

    The word list is a convenience; the phrase is the real output, because
    splitting on spaces would shred multi-word genres ("science fiction",
    "space opera"). study/normalize.py matches terms against the phrase.
    """
    # Strip the leading infobox/hatnotes, then flatten to plain text so the
    # match can't run into link or template syntax.
    body = _strip_markup(text)
    body = re.sub(r"^\s*(\|.*)$", " ", body, flags=re.M)  # stray infobox rows
    # The genre statement is in the lead, before the first section heading.
    # Without this the regex happily matches "...is a the" deep in Reception.
    body = re.split(r"\n\s*={2,}", body)[0]
    m = re.search(r"\b(?:is|was)\s+(?:an?|the)\s+(.{0,200}?)\b"
                  r"(films?|movies?|television series|TV series|television show|"
                  r"series|sitcom|miniseries|serial|programme|program)\b",
                  body, re.S | re.I)
    if not m:
        return None, []
    phrase = re.sub(r"\s+", " ", m.group(1)).strip(" ,;:-–—")
    # A genre run has no punctuation in it; if we caught a clause, keep the tail.
    phrase = re.split(r"[.;:()]", phrase)[-1].strip()
    words = []
    for w in re.split(r"[\s/]+", phrase):
        w = w.strip(",;:()\"'").lower()
        if not w or DECADE.match(w) or w in NOT_GENRES:
            continue
        words.append(w)
    # Genre runs are short adjective strings; anything long is a parse miss.
    if len(words) > 8:
        return None, []
    return (phrase or None), words


def wanted_titles() -> dict[str, list[str]]:
    """Article title -> the IMDb ids whose Wikidata item links to it."""
    lib = json.loads(LIBRARY.read_text(encoding="utf-8"))
    wd = json.loads(WIKIDATA.read_text(encoding="utf-8"))
    wanted: dict[str, list[str]] = {}
    for item in lib["items"]:
        imdb = item["ids"].get("imdb")
        art = (wd.get(imdb) or {}).get("article")
        if not art:
            continue
        title = urllib.parse.unquote(art.rsplit("/", 1)[-1]).replace("_", " ")
        wanted.setdefault(title, []).append(imdb)
    return wanted


def fetch_wikitext(titles: list[str]) -> dict[str, str]:
    """Download article source, resuming from and appending to the cache."""
    cache: dict[str, str] = {}
    if WIKITEXT.exists():
        cache = json.loads(WIKITEXT.read_text(encoding="utf-8"))
    todo = [t for t in titles if t not in cache]
    if not todo:
        print(f"wikitext cache complete ({len(cache)} articles)")
        return cache
    print(f"{len(cache)} cached, fetching {len(todo)} articles")

    def save() -> None:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        WIKITEXT.write_text(json.dumps(cache, ensure_ascii=False),
                            encoding="utf-8")

    for i in range(0, len(todo), BATCH):
        chunk = todo[i:i + BATCH]
        print(f"  {i + 1}-{i + len(chunk)} of {len(todo)}…")
        try:
            data = api_get({"action": "query", "prop": "revisions",
                            "rvprop": "content", "rvslots": "main",
                            "titles": "|".join(chunk), "redirects": 1})
        except Exception:
            save()  # keep what we have so a re-run resumes here
            raise
        time.sleep(THROTTLE)
        # Map the API's title back to the one we asked for (redirects/normalising).
        alias = {}
        for key in ("normalized", "redirects"):
            for r in data.get("query", {}).get(key, []):
                alias[r["to"]] = alias.get(r["from"], r["from"])
        for page in data.get("query", {}).get("pages", {}).values():
            if "revisions" in page:
                asked = alias.get(page["title"], page["title"])
                cache[asked] = page["revisions"][0]["slots"]["main"]["*"]
    save()
    return cache


def main() -> int:
    wanted = wanted_titles()
    cache = fetch_wikitext(sorted(wanted))

    out = {}
    for title, imdb_ids in wanted.items():
        text = cache.get(title)
        if text is None:
            continue
        phrase, words = lead_genres(text)
        out[title] = {"infobox_genres": infobox_genres(text),
                      "lead_phrase": phrase,
                      "lead_genres": words,
                      "imdb": imdb_ids}

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    WIKIPEDIA.write_text(json.dumps(out, indent=1, ensure_ascii=False),
                         encoding="utf-8")
    ib = sum(1 for v in out.values() if v["infobox_genres"])
    ld = sum(1 for v in out.values() if v["lead_phrase"])
    print(f"\nparsed {len(out)}/{len(wanted)} articles -> {WIKIPEDIA}")
    print(f"  with infobox |genre= (TV): {ib}")
    print(f"  with lead-sentence phrase: {ld}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
