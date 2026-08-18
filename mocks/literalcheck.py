#!/usr/bin/env python3
"""Hand-typed colour in ANY notation, not just hex.

WHY THIS EXISTS — the constraint is "no hard-coded colour in any mock", but the
gate implemented "zero raw hex", which is a strictly weaker claim. A hex-shaped
grep sees nothing in `background: rgba(255,255,255,.82)`, so that literal rode
through every pass and then only manifested in one scheme: the dark-mode
composer capsule painted rgb(213,213,213) on a #19191a page, with its placeholder
at 1.37:1 and typed text at 1.20:1. Same failure mode as the `.s-i` white-on-white
before it — a literal that does not theme.

Checks every colour notation CSS accepts: #rgb/#rrggbb/#rrggbbaa, rgb()/rgba(),
hsl()/hsla(), oklch()/oklab()/lab()/lch(), color(), and the named keywords.

Two deliberate exemptions, both narrow and justified in place:
  - `transparent` and a `black`/`white` used purely as a MASK or gradient
    alpha stop carry no design colour; only their alpha is observable.
  - the tokens file itself is generated, and is checked separately.

usage: python3 mocks/literalcheck.py v2-fleet.html v3-assistant.html ...
"""
import re
import sys
from pathlib import Path

HERE = Path(__file__).parent

NAMED = (
    'aliceblue|antiquewhite|aqua|aquamarine|azure|beige|bisque|black|blanchedalmond|blue|'
    'blueviolet|brown|burlywood|cadetblue|chartreuse|chocolate|coral|cornflowerblue|cornsilk|'
    'crimson|cyan|darkblue|darkcyan|darkgoldenrod|darkgray|darkgreen|darkgrey|darkkhaki|'
    'darkmagenta|darkolivegreen|darkorange|darkorchid|darkred|darksalmon|darkseagreen|'
    'darkslateblue|darkslategray|darkslategrey|darkturquoise|darkviolet|deeppink|deepskyblue|'
    'dimgray|dimgrey|dodgerblue|firebrick|floralwhite|forestgreen|fuchsia|gainsboro|ghostwhite|'
    'gold|goldenrod|gray|green|greenyellow|grey|honeydew|hotpink|indianred|indigo|ivory|khaki|'
    'lavender|lavenderblush|lawngreen|lemonchiffon|lightblue|lightcoral|lightcyan|lightgray|'
    'lightgreen|lightgrey|lightpink|lightsalmon|lightseagreen|lightskyblue|lightslategray|'
    'lightsteelblue|lightyellow|lime|limegreen|linen|magenta|maroon|mediumaquamarine|mediumblue|'
    'mediumorchid|mediumpurple|mediumseagreen|mediumslateblue|mediumspringgreen|mediumturquoise|'
    'mediumvioletred|midnightblue|mintcream|mistyrose|moccasin|navajowhite|navy|oldlace|olive|'
    'olivedrab|orange|orangered|orchid|palegoldenrod|palegreen|paleturquoise|palevioletred|'
    'papayawhip|peachpuff|peru|pink|plum|powderblue|purple|rebeccapurple|red|rosybrown|royalblue|'
    'saddlebrown|salmon|sandybrown|seagreen|seashell|sienna|silver|skyblue|slateblue|slategray|'
    'snow|springgreen|steelblue|tan|teal|thistle|tomato|turquoise|violet|wheat|white|whitesmoke|'
    'yellow|yellowgreen'
)

PATTERNS = [
    ('hex', r'#[0-9a-fA-F]{3,8}\b'),
    ('rgb', r'\brgba?\([^)]*\)'),
    ('hsl', r'\bhsla?\([^)]*\)'),
    ('lab/lch/oklab/oklch', r'\bok?(?:lab|lch)\([^)]*\)'),
    ('color()', r'\bcolor\(\s*(?:srgb|display-p3|rec2020|a98-rgb|prophoto-rgb|xyz)[^)]*\)'),
    ('color-mix', r'\bcolor-mix\([^;]*?\)(?=[;\s}])'),
    ('named', r'(?<![\w-])(?:' + NAMED + r')(?![\w-])'),
]

# A mask or a gradient alpha stop observes only the alpha channel, so the colour
# keyword there carries no design decision. Narrow on purpose.
MASK_CTX = re.compile(r'(?:-webkit-)?mask(?:-image)?\s*:[^;]*$')


def scan(path: Path):
    raw = path.read_text()
    # strip CSS and HTML comments — prose about a banned colour is not a use of it
    css = re.sub(r'/\*.*?\*/', '', raw, flags=re.S)
    css = re.sub(r'<!--.*?-->', '', css, flags=re.S)
    # only look inside style/attribute territory, not visible copy: a session
    # named "blue" is text, not a colour declaration
    hits = []
    for kind, pat in PATTERNS:
        for m in re.finditer(pat, css):
            before = css[max(0, m.start() - 200):m.start()]
            # inside a declaration? (a `prop:` since the last `;`, `{` or `>`)
            decl = re.search(r'[;{>"]\s*([-a-zA-Z]+)\s*:[^;{]*$', before)
            if not decl:
                continue
            prop = decl.group(1).lower()
            if 'mask' in prop:
                continue
            if kind == 'named' and m.group(0) in ('transparent',):
                continue
            # A colour expression that REFERENCES A TOKEN is derived, not typed:
            # `oklch(from var(--surface-raised) l c h / 0.82)` follows the scheme,
            # which is the whole point. Only self-contained values are literals.
            if 'var(--' in m.group(0):
                continue
            line = css[:m.start()].count('\n') + 1
            hits.append((line, prop, kind, m.group(0)))
    return hits


def main():
    files = sys.argv[1:] or ['v2-fleet.html', 'v3-assistant.html', 'v4-transcript.html']
    total = 0
    for name in files:
        p = HERE / name if not Path(name).is_absolute() else Path(name)
        hits = scan(p)
        total += len(hits)
        print(f"  {p.name:<22} {len(hits)} hand-typed colour literal(s)")
        for line, prop, kind, text in hits:
            print(f"      L{line:<5} {prop:<18} [{kind}] {text}")
    print('  every colour in every mock resolves through a token'
          if not total else f"  {total} hand-typed colour literal(s) — none may ship")
    sys.exit(1 if total else 0)


main()
