#!/usr/bin/env python3
"""Give every status chip a second, hueless channel (DW-3.12).

Two defects this closes, both found by measurement rather than by reading:

 1. "needs you" (s-att) and "paused" (s-warn) resolved to the SAME amber pair.
    The journey's peak moment and its opposite were the same colour. The five
    states now map one-to-one onto the token vocabulary, and idle carries no
    fill at all — a hueless grey pill measures only 6.7 CIEDE2000 from the live
    blue pill, so "no pill" is the honest idle treatment.
 2. Chips carried a label and nothing else. Strip the hue — greyscale, or a
    dichromatic operator — and the four hued chips collapse toward one another.
    Each now leads with a distinct glyph, so hue is the third cue, never the
    first.

usage: python3 mocks/statuschips.py
"""
import re
from pathlib import Path

HERE = Path(__file__).parent

SVG = ('<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" '
       'stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">')

GLYPH = {
    # live: a filled dot — the only state that is still moving
    'live': '<svg viewBox="0 0 12 12" fill="currentColor"><circle cx="6" cy="6" r="3.1"/></svg>',
    # attn: an upward chevron — "this one is asking"
    'attn': SVG + '<path d="M6 9.4V2.6M3 5.6 6 2.6l3 3"/></svg>',
    'done': SVG + '<path d="M2.4 6.3 4.9 8.8l4.7-5.6"/></svg>',
    'fail': SVG + '<path d="M3.2 3.2l5.6 5.6M8.8 3.2l-5.6 5.6"/></svg>',
    # idle: two bars — paused, deliberately, by a human
    'idle': SVG + '<path d="M4.4 3v6M7.6 3v6"/></svg>',
}

# old class -> (new class, state key, label it must now read)
REMAP = {
    's-att':  ('s-attn', 'attn'),
    's-ok':   ('s-live', 'live'),
    's-err':  ('s-fail', 'fail'),
    's-warn': ('s-idle', 'idle'),
    's-none': ('s-idle', 'idle'),
}

CSS = """.chip-s{display:inline-flex;align-items:center;gap:5px;height:22px;padding:0 10px;
        border-radius:var(--radius-pill);font-size:var(--text-sm);font-weight:var(--weight-strong)}
.chip-s svg{width:9px;height:9px;flex:0 0 auto;display:block}
.s-live{background:var(--status-live-bg);color:var(--status-live-ink)}
.s-attn{background:var(--status-attn-bg);color:var(--status-attn-ink)}
.s-done{background:var(--status-done-bg);color:var(--status-done-ink)}
.s-fail{background:var(--status-fail-bg);color:var(--status-fail-ink)}
.s-idle{background:var(--status-idle-bg);color:var(--status-idle-ink);padding:0}
"""


def transform(path: Path):
    s = path.read_text()

    # --- CSS: replace the old .s-* rules with the five-state vocabulary -------
    s = re.sub(r'\.chip-s\{[^}]*\}\n?', '', s)
    for cls in ('s-ok', 's-warn', 's-err', 's-att', 's-none', 's-done'):
        s = re.sub(r'\.' + cls + r'\{[^}]*\}\n?', '', s)
    s = s.replace('</style>', CSS + '</style>', 1)

    # --- markup: remap the class and prepend the glyph ------------------------
    def fix(m):
        old, label = m.group(1), m.group(2)
        new, key = REMAP.get(old, ('s-idle', 'idle'))
        return f'<span class="chip-s {new}">{GLYPH[key]}{label}</span>'

    n = len(re.findall(r'<span class="chip-s (s-[a-z]+)">([^<]*)</span>', s))
    s = re.sub(r'<span class="chip-s (s-[a-z]+)">([^<]*)</span>', fix, s)

    # bare .s-none spans (idle with no chip-s wrapper) keep their glyph too
    s = re.sub(r'<span class="s-none">([^<]*)</span>',
               lambda m: f'<span class="chip-s s-idle">{GLYPH["idle"]}{m.group(1)}</span>', s)

    path.write_text(s)
    return n


if __name__ == '__main__':
    for name in ('v2-fleet.html', 'v3-assistant.html', 'v4-transcript.html'):
        print(f"{name:<22} chips rewritten: {transform(HERE / name)}")
