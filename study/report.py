"""Render the study as a standalone HTML report.

  uv run python -m study.report
"""

from __future__ import annotations

import html
import json
from collections import Counter

from study.compare import (build_rows, candidate_channels, lineup_health, load,
                           validate_against_known)
from study.normalize import SOFT_GENRES
from study.paths import REPORT, OUT_DIR

CSS = """
:root {
  --ground:#eff1f3; --surface:#fbfcfd; --surface-2:#e7eaee;
  --ink:#15181c; --ink-2:#41505f; --ink-3:#6d7b89;
  --rule:#cfd6dd; --rule-soft:#dfe4ea;
  --accent:#2c3a52; --over:#a8412a; --under:#1b6157; --soft:#8a5e00;
  --over-bg:#f6e6e1; --under-bg:#dff0eb; --soft-bg:#f7edd6;
  --display:"Avenir Next Condensed","HelveticaNeue-CondensedBold","Arial Narrow Bold",
            "Arial Narrow",system-ui,sans-serif;
  --body:Charter,"Iowan Old Style","Palatino Linotype",Georgia,serif;
  --mono:"SF Mono",SFMono-Regular,"IBM Plex Mono",Menlo,ui-monospace,monospace;
}
@media (prefers-color-scheme:dark){ :root:not([data-theme="light"]){
  --ground:#14171b; --surface:#1b1f25; --surface-2:#242a32;
  --ink:#e8ecf0; --ink-2:#aab6c2; --ink-3:#7d8b99;
  --rule:#333c46; --rule-soft:#272e36;
  --accent:#9fb4d4; --over:#e39179; --under:#6cc0ad; --soft:#d6a73f;
  --over-bg:#3a231d; --under-bg:#16302b; --soft-bg:#332812;
}}
:root[data-theme="dark"]{
  --ground:#14171b; --surface:#1b1f25; --surface-2:#242a32;
  --ink:#e8ecf0; --ink-2:#aab6c2; --ink-3:#7d8b99;
  --rule:#333c46; --rule-soft:#272e36;
  --accent:#9fb4d4; --over:#e39179; --under:#6cc0ad; --soft:#d6a73f;
  --over-bg:#3a231d; --under-bg:#16302b; --soft-bg:#332812;
}
*{box-sizing:border-box}
body{margin:0;background:var(--ground);color:var(--ink);font-family:var(--body);
  font-size:17px;line-height:1.6;-webkit-font-smoothing:antialiased}
.wrap{max-width:1180px;margin:0 auto;padding:0 28px 96px}
.col{max-width:68ch}
h1,h2,h3{font-family:var(--display);font-weight:600;text-wrap:balance;
  letter-spacing:.005em;margin:0}
h1{font-size:clamp(38px,6.4vw,68px);line-height:.98;letter-spacing:-.01em}
h2{font-size:30px;line-height:1.1;margin-bottom:6px}
h3{font-size:20px;line-height:1.2}
p{margin:0 0 15px}
a{color:var(--accent)}
.eyebrow{font-family:var(--mono);font-size:11px;letter-spacing:.14em;
  text-transform:uppercase;color:var(--ink-3);margin:0 0 10px}

header.top{padding:64px 0 34px;border-bottom:2px solid var(--ink)}
.lede{font-size:20px;line-height:1.45;color:var(--ink-2);max-width:60ch;margin-top:18px}

.figures{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));
  gap:1px;background:var(--rule);border:1px solid var(--rule);margin:34px 0 0}
.fig{background:var(--surface);padding:16px 18px}
.fig .n{font-family:var(--display);font-size:38px;line-height:1;
  font-variant-numeric:tabular-nums;display:block}
.fig .k{font-family:var(--mono);font-size:10.5px;letter-spacing:.1em;
  text-transform:uppercase;color:var(--ink-3);margin-top:8px;display:block}

section{padding:52px 0 0}
section+section{border-top:1px solid var(--rule-soft);margin-top:52px}

.chip{font-family:var(--mono);font-size:11.5px;padding:2px 7px;border-radius:2px;
  background:var(--surface-2);color:var(--ink-2);white-space:nowrap;display:inline-block}
.chip.over{background:var(--over-bg);color:var(--over)}
.chip.under{background:var(--under-bg);color:var(--under)}
.chip.soft{background:var(--soft-bg);color:var(--soft)}
.chips{display:flex;flex-wrap:wrap;gap:4px}

.listings{border-top:1px solid var(--rule);margin-top:22px}
.row{display:grid;grid-template-columns:minmax(180px,1.5fr) 1fr 1.2fr;gap:20px;
  padding:13px 2px;border-bottom:1px solid var(--rule-soft);align-items:start}
.row .t{font-family:var(--display);font-size:19px;line-height:1.15}
.row .yr{font-family:var(--mono);font-size:11px;color:var(--ink-3);
  font-variant-numeric:tabular-nums}
.row .lbl{font-family:var(--mono);font-size:10px;letter-spacing:.09em;
  text-transform:uppercase;color:var(--ink-3);display:block;margin-bottom:5px}
.src{font-size:14px;color:var(--ink-3);line-height:1.45;font-style:italic}

table{width:100%;border-collapse:collapse;font-size:15px}
.scroll{overflow-x:auto}
th{font-family:var(--mono);font-size:10.5px;letter-spacing:.09em;text-transform:uppercase;
  color:var(--ink-3);text-align:left;font-weight:400;padding:0 12px 8px 0;
  border-bottom:1px solid var(--rule)}
td{padding:8px 12px 8px 0;border-bottom:1px solid var(--rule-soft);vertical-align:middle}
td.num{font-family:var(--mono);font-variant-numeric:tabular-nums;text-align:right;
  width:1%;white-space:nowrap}
/* display:block matters — an inline span collapses to zero height and the
   absolutely-positioned fill never shows. */
.meter{display:block;height:9px;background:var(--surface-2);position:relative;
  min-width:120px;width:100%}
.meter i{position:absolute;inset:0 auto 0 0;background:var(--accent);display:block}
.meter i.thin{background:var(--soft)}

.note{background:var(--surface);border-left:3px solid var(--accent);
  padding:16px 20px;margin:22px 0;font-size:15.5px;line-height:1.55}
.note strong{font-family:var(--display);font-size:17px}
.verdict{display:flex;align-items:baseline;gap:14px;flex-wrap:wrap;margin:18px 0 6px}
.verdict .score{font-family:var(--display);font-size:52px;line-height:1;
  font-variant-numeric:tabular-nums}
.hit{color:var(--under)} .miss{color:var(--over)}
ul{padding-left:20px;margin:0 0 15px} li{margin-bottom:7px}
code{font-family:var(--mono);font-size:.87em;background:var(--surface-2);padding:1px 5px}
footer{margin-top:60px;padding-top:20px;border-top:2px solid var(--ink);
  font-family:var(--mono);font-size:11.5px;color:var(--ink-3);letter-spacing:.04em}
@media (max-width:720px){ .row{grid-template-columns:1fr;gap:8px} }
"""


def esc(s) -> str:
    return html.escape(str(s if s is not None else ""))


def chips(items, cls="") -> str:
    if not items:
        return '<span class="chip">—</span>'
    c = f" {cls}" if cls else ""
    return "".join(f'<span class="chip{c}">{esc(g)}</span>' for g in items)


def row_html(r: dict, field: str, cls: str) -> str:
    src = r["lead_phrase"] or ", ".join(r["wikidata_raw"][:4]) or "—"
    return f"""<div class="row">
  <div><div class="t">{esc(r['title'])}</div>
    <span class="yr">{esc(r['year'])} · {esc(r['kind'])}</span></div>
  <div><span class="lbl">Plex says</span><div class="chips">{chips(r['plex'])}</div></div>
  <div><span class="lbl">{'Not supported' if cls == 'over' else 'Both sources say, Plex lacks'}</span>
    <div class="chips">{chips(r[field], cls)}</div>
    <div class="src">Wikipedia: “{esc(src)}”</div></div>
</div>"""


def channel_table(entries, total) -> str:
    top = max((n for _, n in entries), default=1)
    out = ['<div class="scroll"><table><thead><tr><th>Channel</th><th>Titles</th>'
           '<th style="width:45%">Share</th></tr></thead><tbody>']
    for g, n in entries:
        thin = " thin" if n <= 2 else ""
        out.append(f'<tr><td>{esc(g)}</td><td class="num">{n}</td>'
                   f'<td><span class="meter"><i class="{thin.strip()}" '
                   f'style="width:{n / top * 100:.1f}%"></i></span></td></tr>')
    out.append("</tbody></table></div>")
    return "".join(out)


def build(rows, health, cands, val, lib) -> str:
    conf = [r for r in rows if r["extras_confident"]]
    miss = [r for r in rows if r["missing"]]
    soft = [r for r in rows if r["extras_soft"]]
    both = [r for r in rows if r["sources"] == 2]
    n_extra = sum(len(r["extras_confident"]) for r in rows)
    n_miss = sum(len(r["missing"]) for r in rows)
    locked = sum(1 for r in rows if r["locked"])
    n_locked_findings = sum(1 for r in conf if r["locked"])

    conf.sort(key=lambda r: (-len(r["extras_confident"]), r["title"]))
    miss.sort(key=lambda r: (-len(r["missing"]), r["title"]))

    val_rows = "".join(
        f'<tr><td>{esc(c["title"])}</td><td>{esc(c["genre"])}</td>'
        f'<td class="{"hit" if c["flagged"] else "miss"}">'
        f'{"rediscovered" if c["flagged"] else "not flagged"}</td></tr>'
        for c in val.get("checks", []))

    cand_rows = "".join(
        f'<tr><td>{esc(g)}</td><td class="num">{n}</td>'
        f'<td class="src">{esc(", ".join(t[:5]))}'
        f'{"…" if len(t) > 5 else ""}</td></tr>'
        for g, n, t in cands if n >= 3)

    def health_block(kind, label):
        h = health.get(kind)
        if not h:
            return ""
        return f"""<h3>{label}</h3>
<p class="src" style="font-style:normal;margin-bottom:14px">{h['titles']} titles ·
 {h['avg_plex']:.1f} genres each in Plex vs {h['avg_wikidata']:.1f} labels each on
 Wikidata · {len(h['singletons'])} one-title channels</p>
{channel_table(h['plex_channels'], h['titles'])}"""

    return f"""<title>Genre Drift</title>
<style>{CSS}</style>
<div class="wrap">
<header class="top">
  <p class="eyebrow">Plex library audit · {esc(lib['server'])}</p>
  <h1>Where Plex and<br>Wikipedia disagree</h1>
  <p class="lede">Every film and series in the library, checked against an
  independent account of its genre. Plex's tags come from TMDB; these come from
  Wikidata and the English Wikipedia. Neither is truth — but where both outside
  sources contradict Plex, it's worth a look.</p>
  <div class="figures">
    <div class="fig"><span class="n">{len(rows)}</span><span class="k">titles</span></div>
    <div class="fig"><span class="n">{len(both)}</span><span class="k">with both sources</span></div>
    <div class="fig"><span class="n">{n_extra}</span><span class="k">over-tags found</span></div>
    <div class="fig"><span class="n">{n_miss}</span><span class="k">under-tags found</span></div>
    <div class="fig"><span class="n">{val.get('hit', 0)}/{val.get('total', 0)}</span>
      <span class="k">hand-fixes rediscovered</span></div>
  </div>
</header>

<section><div class="col">
  <p class="eyebrow">Does the method work</p>
  <h2>Checked against the hand-corrected titles first</h2>
  <p>The eight hand-corrected titles are a labelled answer key: run the pipeline
  blind and see whether it finds the same problems.</p>
  <div class="verdict"><span class="score">{val.get('hit', 0)}/{val.get('total', 0)}</span>
    <span>removals independently rediscovered</span></div>
</div>
<div class="scroll" style="max-width:760px"><table>
  <thead><tr><th>Title</th><th>Genre removed</th><th>Pipeline</th></tr></thead>
  <tbody>{val_rows}</tbody></table></div>
<div class="col"><div class="note"><strong>The one miss is the interesting one.</strong>
  <p style="margin:8px 0 0">The hand-correction removed <em>Science Fiction</em> from
  <em>Alias</em>. Wikidata explicitly lists it as a science fiction series, and the
  Wikipedia lead calls it a “spy action thriller”. The pipeline sided with Wikidata.
  That's the method working correctly and still disagreeing with the hand-correction
  — a reminder that these sources are a second opinion, not an authority.</p></div></div>
</section>

<section>
  <p class="eyebrow">Finding 1 · over-tagging</p>
  <h2>Genres Plex asserts that nothing else supports</h2>
  <div class="col"><p>{len(conf)} titles carry at least one genre that neither
  Wikidata nor Wikipedia backs up. Both sources had to be present and specific
  for a title to appear here.</p></div>
  <div class="listings">{"".join(row_html(r, 'extras_confident', 'over') for r in conf)}</div>
</section>

<section>
  <p class="eyebrow">Finding 2 · under-tagging</p>
  <h2>Genres both sources agree on that Plex is missing</h2>
  <div class="col"><p>The half you haven't been looking at. {len(miss)} titles are
  missing a genre that <em>both</em> Wikidata and Wikipedia assert — requiring
  both is what keeps one source's idiosyncratic label from becoming a new tag.</p></div>
  <div class="listings">{"".join(row_html(r, 'missing', 'under') for r in miss)}</div>
</section>

<section><div class="col">
  <p class="eyebrow">Finding 3 · a method caveat, not a result</p>
  <h2>Family and Adventure are excluded on purpose</h2>
  <p>An early version of this study named <em>Family</em> and <em>Adventure</em>
  the two most-over-tagged genres in the library. That was wrong. Wikidata's genre
  property records <em>narrative</em> genre, so it rarely says “family film” at
  all — it describes <em>Cars</em> as “buddy, comedy, flashback” and <em>Moana</em>
  as “action, adventure, comedy, musical”. Silence isn't contradiction, and
  scoring it as one produced {len(soft)} false accusations.</p>
  <p>Those two genres are now reported separately and never proposed for removal.
  They're listed here for review.</p>
  <div class="chips" style="margin-top:14px">{chips(
      sorted({r['title'] for r in soft})[:40])}</div>
</div></section>

<section>
  <p class="eyebrow">Lineup health</p>
  <h2>How the channels actually sit</h2>
  <div class="col"><p>Genre counts are the channel sizes. Bars in amber are
  one- or two-title channels — real tags, but thin as channels.</p></div>
  {health_block('movie', 'Movies')}
  {health_block('show', 'TV Shows')}
</section>

<section>
  <p class="eyebrow">Outside the vocabulary</p>
  <h2>Channels not yet in the library</h2>
  <div class="col"><p>Genres the outside sources assert that Plex has no equivalent
  for. These are never written back automatically — they're channel ideas, shown
  where at least three titles support them.</p></div>
  <div class="scroll"><table><thead><tr><th>Candidate channel</th><th>Titles</th>
    <th>Examples</th></tr></thead><tbody>{cand_rows}</tbody></table></div>
</section>

<section><div class="col">
  <p class="eyebrow">Method</p>
  <h2>How this was built</h2>
  <p><strong>Matching.</strong> Every title joins by IMDb ID, taken from Plex's
  own <code>Guid[]</code> metadata — no fuzzy title matching. 273 of 274 titles
  carry one; 271 resolve to a Wikidata item.</p>
  <p><strong>Wikipedia has no genre field for films.</strong> The film infobox
  deliberately omits one — WikiProject Film removed it as too subjective — while
  the television infobox keeps <code>|genre=</code>. So for series the study reads
  the infobox, and for films it parses the lead sentence (“a 2009 American
  animated musical fantasy comedy film”). Wikidata's genre property is the spine;
  Wikipedia corroborates.</p>
  <p><strong>Vocabulary.</strong> The outside sources use 154 distinct genre
  labels against Plex's 18 for film and 22 for TV. They're canonicalised
  (“science fiction television series” → “science fiction”) and mapped onto
  Plex's vocabulary with subsumption, so “romantic comedy” implies both Romance
  and Comedy and “space opera” implies Science Fiction. Without that, every
  rom-com would read as missing Comedy.</p>
  <p><strong>What it won't tell you.</strong> Plex's genres are TMDB's opinion and
  Wikidata's are crowd-sourced; both are uneven. A disagreement is a prompt to
  look, not a verdict. Titles described by only a single outside label are
  excluded from the over-tagging finding entirely.</p>
  <p><strong>Locked titles are skipped.</strong> Every write PlexTags makes sets
  <code>genre.locked=1</code>, and the study refuses to second-guess a genre list
  a human already curated. {locked} of {len(rows)} titles are now locked — so
  proposals can only ever come from the {len(rows) - locked} that aren't.
  {n_locked_findings} titles still show over-tagging but are locked, and are
  listed in the findings above without being proposed for any automatic change.</p>
</div></section>

<footer>study/ · {len(rows)} titles · Wikidata P136 + en.wikipedia · run
  <code>uv run python -m study.report</code> to regenerate</footer>
</div>"""


def main() -> int:
    lib, wd, wp = load()
    rows = build_rows(lib, wd, wp)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(build(rows, lineup_health(rows), candidate_channels(rows),
                            validate_against_known(rows), lib), encoding="utf-8")
    print(f"wrote {REPORT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
