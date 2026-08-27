# study/ — Plex vs. Wikipedia genre audit

A read-only pipeline that checks every title's Plex genres against an independent
account of its genre, and reports where they disagree. It never writes to Plex;
the most it does is emit a `corrections.json` for review and manual apply.

Genre data comes from Wikidata (CC0) and the English Wikipedia (CC BY-SA).

## Running it

Stages are separate and each caches its output, so re-running is cheap. Sign in
through the web app first (`bin/dev`) so `data/config.json` has a server token.

```bash
uv run python -m study.harvest     # Plex -> study/data/library.json     (~1 min)
uv run python -m study.wikidata    # SPARQL by IMDb id                   (~30 s)
uv run python -m study.wikipedia   # article source + parse              (~7 min, rate-limited)
uv run python -m study.compare     # join, score, emit corrections
uv run python -m study.report      # -> study/out/report.html
```

Only `harvest` needs Plex reachable. `wikipedia` caches raw article source in
`study/data/wikitext.json`, so re-parsing after a parser change is instant —
re-run `study.wikipedia` and it will skip straight to parsing.

## Applying what it finds

`compare` writes one corrections file per section, because `plex_genres.py apply`
takes a single `--section`/`--kind` for the whole file. It prints the exact
command for each. Always dry-run first:

```bash
python3 plex_genres.py apply --section 2 --kind movie \
    --file study/out/proposed_corrections_movie_section2.json --dry-run
```

Proposals are deliberately conservative: removals only where both sources are
present, specific, and silent on the tag; additions only for genres that are
already real channels with at least `MIN_SUPPORT` titles behind them. Titles
already hand-corrected (genre-locked in Plex) are skipped entirely.

## Why it's built this way

- **Joins on IMDb ID, not title.** Plex's per-item metadata carries `Guid[]` with
  imdb/tmdb/tvdb ids; 273 of 274 titles have one. No fuzzy matching.
- **Wikidata `P136` is the spine, not Wikipedia.** `Template:Infobox film` has no
  `genre` parameter — WikiProject Film removed it as too subjective — so films
  state genre only in lead-sentence prose. `Infobox television` does have one.
  Wikipedia is used to corroborate: infobox for series, lead sentence for films.
- **`normalize.py` is the actual study.** The sources use 154 labels against
  Plex's 18/22. Canonicalisation plus a subsumption table ("romantic comedy" ⇒
  Romance + Comedy, "space opera" ⇒ Science Fiction) is what makes the comparison
  mean anything. The tables are plain data — edit them.
- **Silence is not contradiction.** Wikidata records narrative genre, so it
  rarely asserts audience tags like Family. `SOFT_GENRES` are never proposed for
  removal, and titles with fewer than two outside labels are excluded from the
  over-tagging finding. Both guards exist because the first version of this study
  was wrong without them.

## Validating changes

`compare` scores itself against the eight corrections in the repo's root
`corrections.json` — hand-corrected titles, still detectable because the app
locks the genre field when it writes. It currently rediscovers **9 of 10**
removals. The one miss (*Alias* / Science Fiction) is genuine disagreement:
Wikidata lists Alias as science fiction.

After an edit to `normalize.py`, re-run `compare` and check that number. A drop
means the mapping or subsumption rules broke something.
