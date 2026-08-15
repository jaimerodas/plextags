"""Turn free-form Wikidata/Wikipedia genre labels into something comparable
with Plex's small fixed vocabulary.

This module is the study. Everything else is plumbing.

Three layers:

1. canon()      surface normalisation — "Science fiction film",
                "science fiction television series" -> "science fiction".
                Collapses the 154 raw Wikidata labels to ~130.

2. PLEX_MAP     each canonical label -> the Plex genres it implies. This is
                where subsumption lives: "romantic comedy" implies BOTH Romance
                and Comedy, "space opera" implies Science Fiction. Without it
                every rom-com looks like "Plex is missing Comedy".

3. OUTSIDE      labels with no Plex equivalent are NOT discarded. They map to
                {} and surface in the report as candidate new channels — that's
                where "Spy", "Coming-of-age" and "Neo-noir" come from.

The tables are deliberately plain data: they encode editorial judgement, and
they are meant to be argued with and edited.
"""

from __future__ import annotations

import re

# Plex's own vocabulary, as observed across both libraries, plus the handful of
# standard Plex genres this library happens not to use yet.
PLEX_VOCAB = {
    "Action", "Adventure", "Animation", "Biography", "Comedy", "Crime",
    "Documentary", "Drama", "Family", "Fantasy", "Food", "Game Show",
    "History", "Home and Garden", "Horror", "Music", "Musical", "Mystery",
    "News", "Reality", "Romance", "Science", "Science Fiction", "Sport",
    "Talk Show", "Thriller", "War", "Western",
}

# Suffixes Wikidata appends to say "...but the TV version". Stripped so the
# film and series vocabularies collapse onto each other.
_SUFFIXES = (
    " television series", " tv series", " television programme",
    " television program", " television show", " tv show", " television drama",
    " anime and manga", " film genre", " films", " film", " movie",
    " series", " genre", " fiction film",
)

_ALIASES = {
    "comedy-drama": "comedy drama",
    "dramedy": "comedy drama",
    "sci-fi": "science fiction",
    "scifi": "science fiction",
    "rom-com": "romantic comedy",
    "lgbtq-related": "lgbt-related",
    "humor": "comedy",
    "humour": "comedy",
    "satirical": "satire",
    "sports": "sport",
    "biography": "biographical",
    "biographical drama": "biographical",
    "historical fiction": "historical",
    "period piece": "period drama",
    "children's": "children's",
    "kids": "children's",
    "youth": "coming-of-age",
    "espionage": "spy",
    "detective fiction": "detective",
    "suspense": "thriller",
    "action-adventure": "action adventure",
    "live-action/animated": "live-action/animated",
}


def canon(label: str) -> str:
    """'Science fiction television series' -> 'science fiction'."""
    s = label.lower().strip()
    s = re.sub(r"\s*\(.*?\)\s*", " ", s)          # drop disambiguators
    s = s.replace("’", "'").replace("–", "-")
    s = re.sub(r"\s+", " ", s).strip()
    for suf in _SUFFIXES:
        if s.endswith(suf) and len(s) > len(suf):
            s = s[: -len(suf)].strip()
            break
    s = re.sub(r"\s+", " ", s).strip(" -,")
    return _ALIASES.get(s, s)


# ---------------------------------------------------------------- the mapping
#
# canonical label -> Plex genres it implies (subsumption included).
# An empty set means "a real genre, but outside Plex's vocabulary" — kept and
# reported rather than dropped.

PLEX_MAP: dict[str, set[str]] = {
    # --- direct equivalents
    "action": {"Action"},
    "adventure": {"Adventure"},
    "animation": {"Animation"},
    "animated": {"Animation"},
    "comedy": {"Comedy"},
    "crime": {"Crime"},
    "documentary": {"Documentary"},
    "drama": {"Drama"},
    "family": {"Family"},
    "fantasy": {"Fantasy"},
    "horror": {"Horror"},
    "music": {"Music"},
    "musical": {"Musical"},
    "mystery": {"Mystery"},
    "romance": {"Romance"},
    "science fiction": {"Science Fiction"},
    "sport": {"Sport"},
    "thriller": {"Thriller"},
    "war": {"War"},
    "western": {"Western"},
    "historical": {"History"},
    "history": {"History"},
    "biographical": {"Biography"},
    "talk show": {"Talk Show"},
    "late-night talk show": {"Talk Show"},
    "game show": {"Game Show"},
    "panel game": {"Game Show"},
    "reality television": {"Reality"},
    "cooking show": {"Food"},
    "news": {"News"},
    "current affairs": {"News"},

    # --- compounds: the reason subsumption exists
    "romantic comedy": {"Romance", "Comedy"},
    "comedy drama": {"Comedy", "Drama"},
    "musical comedy": {"Musical", "Comedy"},
    "fantasy comedy": {"Fantasy", "Comedy"},
    "action comedy": {"Action", "Comedy"},
    "black comedy": {"Comedy"},
    "cringe comedy": {"Comedy"},
    "workplace comedy": {"Comedy"},
    "stand-up comedy": {"Comedy"},
    "sketch show": {"Comedy"},
    "sitcom": {"Comedy"},
    "parody": {"Comedy"},
    "satire": {"Comedy"},
    "political satire": {"Comedy"},
    "mockumentary": {"Comedy"},
    "tragicomedy": {"Comedy", "Drama"},
    "comedy of remarriage": {"Comedy", "Romance"},
    "romantic drama": {"Romance", "Drama"},
    "romantic fantasy": {"Romance", "Fantasy"},
    "melodrama": {"Drama"},
    "crime drama": {"Crime", "Drama"},
    "crime thriller": {"Crime", "Thriller"},
    "action thriller": {"Action", "Thriller"},
    "political thriller": {"Thriller"},
    "spy thriller": {"Thriller"},
    "psychological thriller": {"Thriller"},
    "legal drama": {"Drama"},
    "medical drama": {"Drama"},
    "political drama": {"Drama"},
    "period drama": {"Drama", "History"},
    "historical drama": {"Drama", "History"},
    "sports drama": {"Drama", "Sport"},
    "serial drama": {"Drama"},
    "procedural television drama": {"Drama", "Crime"},
    "police procedural": {"Crime", "Drama"},
    "detective": {"Crime", "Mystery"},
    "gangster": {"Crime"},
    "heist": {"Crime"},
    "prison": {"Crime", "Drama"},
    "trial": {"Drama"},
    "vigilante": {"Action", "Crime"},
    "neo-noir": {"Crime", "Thriller"},
    "espionage thriller": {"Thriller"},
    "martial arts": {"Action"},
    "superhero": {"Action", "Adventure"},
    "swashbuckler": {"Action", "Adventure"},
    "pirate": {"Adventure"},
    "treasure hunt": {"Adventure"},
    "survival": {"Adventure"},
    "disaster": {"Action"},
    "epic": {"Adventure"},
    "sword-and-sandal": {"Action", "Adventure", "History"},
    "space opera": {"Science Fiction"},
    "space western": {"Science Fiction", "Western"},
    "science fiction western": {"Science Fiction", "Western"},
    "contemporary western": {"Western"},
    "adventure science fiction": {"Science Fiction", "Adventure"},
    "cyberpunk": {"Science Fiction"},
    "stitchpunk": {"Science Fiction", "Animation"},
    "dystopian": {"Science Fiction"},
    "post-apocalyptic": {"Science Fiction"},
    "alien invasion": {"Science Fiction"},
    "time-travel": {"Science Fiction"},
    "alternate history": {"Science Fiction"},
    "planetary romance": {"Science Fiction", "Adventure"},
    "speculative fiction": {"Science Fiction"},
    "dark fantasy": {"Fantasy"},
    "magic realist": {"Fantasy"},
    "cinematic fairy tale": {"Fantasy", "Family"},
    "supernatural": {"Fantasy"},
    "ghost": {"Fantasy"},
    "monster": {"Horror"},
    "satanic": {"Horror"},
    "splatter": {"Horror"},
    "children's": {"Family"},
    "puppetoon animation": {"Animation", "Family"},
    "clay animation": {"Animation"},
    "adult animated": {"Animation"},
    "supernatural anime": {"Animation", "Fantasy"},
    "drama anime": {"Animation", "Drama"},
    "fantasy anime": {"Animation", "Fantasy"},
    "live-action/animated": {"Animation"},
    "musical play": {"Musical"},
    "dance": {"Musical"},
    "jukebox musical": {"Musical"},
    "american football": {"Sport"},
    "anti-war": {"War"},
    "submarine": {"War"},
    # NB: keys here are post-canon(), so the " television program" forms of
    # these have already had their suffix stripped by the time we look them up.
    "factual": {"Documentary"},
    "variety show": {"Talk Show"},
    "college life": {"Comedy"},
    "procedural": {"Crime", "Drama"},

    # --- real genres with no Plex equivalent: kept, reported, never auto-applied
    "spy": set(),
    "coming-of-age": set(),
    "buddy": set(),
    "buddy cop": set(),
    "female buddy": set(),
    "teen": set(),
    "christmas": set(),
    "lgbt-related": set(),
    "anthology": set(),
    "miniseries": set(),
    "flashback": set(),
    "crossover fiction": set(),
    "ninja": set(),
    "action adventure": {"Action", "Adventure"},
}


# ------------------------------------------------------------------- guards
#
# These three rules are the difference between a useful suggestion and a wrong
# one. Each was earned by getting it wrong first; see study/README.md.

# Genres whose ABSENCE outside Plex means nothing. Wikidata's P136 records
# *narrative* genre, so it rarely asserts the audience/mode tags Plex leans on:
# it calls Cars "buddy, comedy, flashback" and never "family film". Scoring that
# silence as contradiction made Family and Adventure the two most-flagged genres
# in the library — a bug in the method, not a finding about the library.
SOFT_GENRES = {"Family", "Adventure"}

# Pairs Plex distinguishes but the outside sources don't. Plex splits Music
# (music is the subject) from Musical (characters sing); Wikidata has only
# "musical film" for both, which made School of Rock and This Is Spinal Tap look
# mistagged. If a genre's neighbour is supported, the genre isn't contradicted.
ADJACENT = {
    "Music": {"Musical"},
    "Musical": {"Music"},
    "Science": {"Science Fiction", "Documentary"},
}


def evaluate(plex: set[str], wd_plex: set[str], wp_plex: set[str],
             sources: int, evidence: int) -> dict:
    """Compare Plex's genres with the outside sources' and apply every guard.

    The single place that decides what counts as a disagreement, shared by the
    study (study/compare.py) and the live app (server/evidence.py) so the two
    can never drift apart.

    `sources` is how many of the two outside sources said anything at all;
    `evidence` is how many distinct labels they produced between them.
    """
    union = wd_plex | wp_plex
    supported = set(union)
    for g in plex:
        if ADJACENT.get(g, set()) & union:
            supported.add(g)

    # A title described only as "disaster film" is not evidence that Plex's
    # Drama and Thriller are wrong — it's evidence nobody wrote much down.
    well_evidenced = sources == 2 and evidence >= 2

    extras = (plex - supported) if union else set()
    confident = (extras - SOFT_GENRES) if well_evidenced else set()

    # Never strip a title to nothing. Plex's lifestyle categories (Home and
    # Garden, News, Food) have no Wikidata equivalent at all, so a title carrying
    # only one of those can have its whole list "disproved".
    if confident and not (plex - confident):
        confident = set()

    return {
        "supported": sorted(supported),
        "remove": sorted(confident),
        "remove_soft": sorted(extras & SOFT_GENRES) if well_evidenced else [],
        # Adding needs corroboration from BOTH sources; one source's
        # idiosyncratic label is a weak basis for inventing a tag.
        "add": sorted((wd_plex & wp_plex) - plex) if sources == 2 else [],
        "wellEvidenced": well_evidenced,
    }


def to_plex(labels: list[str]) -> tuple[set[str], set[str]]:
    """(Plex-vocabulary genres implied, canonical labels with no Plex equivalent).

    Unknown labels — ones not in PLEX_MAP at all — are treated as outside the
    vocabulary rather than silently dropped, so the report can show them.
    """
    plex: set[str] = set()
    outside: set[str] = set()
    for raw in labels:
        c = canon(raw)
        if not c:
            continue
        mapped = PLEX_MAP.get(c)
        if mapped:
            plex |= mapped
        else:
            outside.add(c)
    return plex, outside


# ------------------------------------------------------- lead-sentence terms

# Longest-first so "science fiction" wins over "science", and "romantic comedy"
# over "comedy".
def _flatten(s: str) -> str:
    """Hyphens -> spaces, so 'action-adventure' and 'action adventure' match.

    Lead sentences hyphenate compounds freely ('action-thriller', 'science-
    fiction') while Wikidata spaces them, and the two must not be treated as
    different genres.
    """
    return re.sub(r"\s+", " ", s.lower().replace("-", " ").replace("/", " ")).strip()


_PHRASE_TERMS = sorted(
    {_flatten(t): t for t in
     set(PLEX_MAP) | {"science fiction", "space opera", "romantic comedy",
                      "coming-of-age", "action adventure", "jukebox musical",
                      "buddy cop", "black comedy", "dark fantasy",
                      "spy thriller", "superhero", "sports"}}.items(),
    key=lambda kv: len(kv[0]), reverse=True,
)


def terms_in_phrase(phrase: str | None) -> list[str]:
    """Pull known genre terms out of a lead sentence's genre run.

    Word-splitting would shred "science fiction" into "science" + "fiction", so
    match multi-word terms against the phrase directly, longest first.
    """
    if not phrase:
        return []
    text = " " + _flatten(phrase) + " "
    found = []
    for flat, term in _PHRASE_TERMS:
        pat = r"(?<!\w)" + re.escape(flat) + r"(?!\w)"
        if re.search(pat, text):
            found.append(term)
            text = re.sub(pat, " ", text)  # don't double-count sub-phrases
    return found
