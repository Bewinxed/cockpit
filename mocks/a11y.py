#!/usr/bin/env python3
"""Make every pointer affordance keyboard-operable, and name every glyph.

WHY THIS EXISTS — the suite rendered every axis and never pressed Tab. A tab walk
of v2-fleet found THREE stops against 24 pointer affordances: the row actions,
nav, the running-session list, pagination, filters, favourites and Export CSV were
all bare `<span>`/`<div>`. The stylesheet already carried a `:focus-visible` rule
naming those exact selectors — a rule that could never match, because none of
those elements could hold focus. Promoting them to real controls is what makes the
existing rule work; `tabindex` on a span would leave them unoperable by Enter and
invisible to assistive tech.

Rules, all counted — a rule that matches nothing is an error, because a silent
no-op in this pipeline is exactly how the leading and the mark fills shipped wrong.
"""
import re
import sys
from pathlib import Path

HERE = Path(__file__).parent

# Distinct glyphs. The same atom mark painted all four KPI tiles and all twelve
# row marks, which carried zero information while `## Never` #2 claimed identity
# rides the glyph. Four KPIs get four glyphs; row marks get one per harness.
GLYPHS = {
    'sessions': '<path d="M3 6h18M3 12h18M3 18h11"/>',
    'needsyou': '<path d="M12 3v10M12 17.5v.5"/>',
    'machines': '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8"/>',
    'spend':    '<path d="M12 3v18M16.5 7.5c0-2-2-3-4.5-3s-4.5 1-4.5 3 2 2.6 4.5 3 4.5 1 4.5 3-2 3-4.5 3-4.5-1-4.5-3"/>',
    'claude':   '<path d="M12 4l7 4v8l-7 4-7-4V8z"/>',
    'opencode': '<path d="M9 8l-4 4 4 4M15 8l4 4-4 4"/>',
    'pi':       '<path d="M5 8h14M9 8v9M15 8v6.5a2.5 2.5 0 0 0 4 0"/>',
}
SVG_OPEN = ('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" '
            'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">')


DRAWER_JS = """<script>
/* The drawer was a CSS checkbox hack: a <label for=navt> with tabIndex -1 driving
   a hidden <input>. It works with a mouse and is unreachable by keyboard at every
   width where it paints, and the closed <aside> kept all 19 of its focusables in
   the tab order at x = -274..-31. A real button carries the state, and `inert`
   takes the closed drawer out of the tab order entirely. */
(function () {
  var root = document.documentElement;
  var nav = document.getElementById('sidenav');
  var btn = document.querySelector('.burger');
  var scrim = document.querySelector('.scrim');
  var narrow = window.matchMedia('(max-width: 900px)');
  function sync(open) {
    root.classList.toggle('nav-open', open);
    if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (nav) { if (narrow.matches && !open) nav.setAttribute('inert', ''); else nav.removeAttribute('inert'); }
  }
  if (btn) btn.addEventListener('click', function () { sync(!root.classList.contains('nav-open')); });
  if (scrim) scrim.addEventListener('click', function () { sync(false); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && root.classList.contains('nav-open')) { sync(false); if (btn) btn.focus(); }
  });
  narrow.addEventListener('change', function () { sync(false); syncModal(); });

  /* Below 900px the assistant panel is a full-screen fixed sheet, but the board
     behind it stayed in the tab order: measured at 320 and 390, keyboard focus
     landed on row actions the user could not see, and the focus ring painted
     into pixels covered by the panel. A sheet that covers the viewport is a
     modal, so it is announced as one and the background goes inert. */
  var panel = document.querySelector('.asst');
  function syncModal() {
    if (!panel) return;
    var r = panel.getBoundingClientRect();
    var modal = r.width >= window.innerWidth - 2 && r.height >= window.innerHeight - 2;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Assistant');
    if (modal) {
      panel.setAttribute('aria-modal', 'true');
      document.querySelectorAll('main, aside').forEach(function (n) { n.setAttribute('inert', ''); });
    } else {
      panel.removeAttribute('aria-modal');
      document.querySelectorAll('main').forEach(function (n) { n.removeAttribute('inert'); });
      if (!narrow.matches) { var a = document.getElementById('sidenav'); if (a) a.removeAttribute('inert'); }
    }
  }
  window.addEventListener('resize', syncModal);
  sync(false);
  syncModal();
})();
</script>"""


class Rules:
    def __init__(self, path):
        self.path, self.log, self.bad = path.name, [], 0

    def _record(self, name, n, expect):
        """Count a rule that is not a regex substitution — a hand-written edit
        is exactly as capable of silently matching nothing."""
        want = expect.get(self.path, 0) if isinstance(expect, dict) else expect
        ok = (n >= 1) if want == 'any' else (True if want == 'opt' else n == want)
        if not ok:
            self.bad += 1
            print(f"    RULE MISMATCH  {self.path:<22} {name:<26} matched {n}, expected {want}")
        self.log.append((name, n))

    def rx(self, s, name, pat, repl, expect):
        n = len(re.findall(pat, s))
        want = expect.get(self.path, 0) if isinstance(expect, dict) else expect
        ok = (n >= 1) if want == 'any' else (True if want == 'opt' else n == want)
        if not ok:
            self.bad += 1
            print(f"    RULE MISMATCH  {self.path:<22} {name:<26} matched {n}, expected {want}")
        self.log.append((name, n))
        return re.sub(pat, repl, s)


def transform(path: Path):
    s = path.read_text()
    R = Rules(path)
    v2 = path.name == 'v2-fleet.html'
    v3 = path.name == 'v3-assistant.html'
    mgmt = v2 or v3

    # --- 1. row actions: bare spans -> real buttons -------------------------
    # The idle "—" is NOT a control: it is the absence of an action, so it loses
    # cursor:pointer instead of gaining a tab stop nobody wants to land on.
    s = R.rx(s, 'action spans -> buttons',
             r'<div class="act">(.*?)</div>',
             lambda m: '<div class="act">' + re.sub(
                 r'<span>([^<]+)</span>',
                 lambda b: f'<button type="button">{b.group(1)}</button>',
                 m.group(1)) + '</div>',
             {'v2-fleet.html': 8, 'v3-assistant.html': 8, 'v4-transcript.html': 0})
    s = R.rx(s, 'idle marker not a control',
             r'<span class="mut" aria-label="no action available">—</span>',
             '<span class="mut" role="presentation">—</span>',
             {'v2-fleet.html': 1, 'v3-assistant.html': 1, 'v4-transcript.html': 0})

    # --- 2. navigation and session lists -> links ---------------------------
    s = R.rx(s, 'nav items -> links', r'<div class="nav-i( on)?">',
             lambda m: f'<a class="nav-i{m.group(1) or ""}" href="#nav">',
             {'v2-fleet.html': 8, 'v3-assistant.html': 8, 'v4-transcript.html': 4})
    s = R.rx(s, 'run items -> links', r'<div class="run-i( on)?">',
             lambda m: f'<a class="run-i{m.group(1) or ""}" href="#session">',
             {'v2-fleet.html': 4, 'v3-assistant.html': 4, 'v4-transcript.html': 4})
    # the closing tags for both live on the same one-line rows
    s = R.rx(s, 'close nav/run links',
             r'(<a class="(?:nav-i|run-i)[^"]*" href="#[^"]*">(?:(?!</div>).)*?)</div>',
             r'\1</a>', {'v2-fleet.html': 12, 'v3-assistant.html': 12, 'v4-transcript.html': 8})

    # --- 3. favourites, filters, pagination, search -------------------------
    s = R.rx(s, 'favourite -> button', r'<span class="star">',
             '<button type="button" class="star" aria-label="Favourite this session">',
             {'v2-fleet.html': 4, 'v3-assistant.html': 4, 'v4-transcript.html': 0})
    s = R.rx(s, 'close favourite',
             r'(<button type="button" class="star"[^>]*>(?:(?!</span>).)*?)</span>',
             r'\1</button>', {'v2-fleet.html': 4, 'v3-assistant.html': 4, 'v4-transcript.html': 0})
    s = R.rx(s, 'filters -> buttons', r'<div class="sel">',
             '<button type="button" class="sel">',
             {'v2-fleet.html': 3, 'v3-assistant.html': 3, 'v4-transcript.html': 0})
    s = R.rx(s, 'close filters',
             r'(<button type="button" class="sel">(?:(?!</div>).)*?)</div>',
             r'\1</button>', {'v2-fleet.html': 3, 'v3-assistant.html': 3, 'v4-transcript.html': 0})
    s = R.rx(s, 'pagination -> buttons', r'<i( class="[^"]*")?>([^<]*)</i>',
             lambda m: f'<button type="button"{m.group(1) or ""}>{m.group(2)}</button>',
             {'v2-fleet.html': 7, 'v3-assistant.html': 7, 'v4-transcript.html': 0})
    s = R.rx(s, 'search -> input',
             r'(<div class="search">\s*<svg.*?</svg>\s*)<span>([^<]*)</span>',
             lambda m: f'{m.group(1)}<input type="search" aria-label="Filter sessions" '
                       f'placeholder="{m.group(2).strip()}">',
             {'v2-fleet.html': 1, 'v3-assistant.html': 1, 'v4-transcript.html': 0})

    # --- 4. sidebar chrome ---------------------------------------------------
    s = R.rx(s, 'collapse -> button', r'<span class="collapse">',
             '<button type="button" class="collapse" aria-label="Collapse sidebar">',
             {'v2-fleet.html': 1, 'v3-assistant.html': 1, 'v4-transcript.html': 0})
    s = R.rx(s, 'close collapse',
             r'(<button type="button" class="collapse"[^>]*>(?:(?!</span>).)*?)</span>',
             r'\1</button>', {'v2-fleet.html': 1, 'v3-assistant.html': 1, 'v4-transcript.html': 0})
    s = R.rx(s, 'section plus -> button', r'<span class="plus">',
             '<button type="button" class="plus" aria-label="New session">',
             {'v2-fleet.html': 1, 'v3-assistant.html': 1, 'v4-transcript.html': 0})
    s = R.rx(s, 'close section plus',
             r'(<button type="button" class="plus"[^>]*>(?:(?!</span>).)*?)</span>',
             r'\1</button>', {'v2-fleet.html': 1, 'v3-assistant.html': 1, 'v4-transcript.html': 0})

    # --- 5. the stat icon tile is decorative, not a control ------------------
    if mgmt:
        s = s.replace('.stat .chip{', '.stat .chip{cursor:default;')

    # --- 6. every SVG is named or hidden ------------------------------------
    # 65 of 65 carried neither. Decorative glyphs sit next to a text label, so
    # they are hidden from assistive tech rather than given a redundant name.
    s = R.rx(s, 'svg aria-hidden', r'<svg (?![^>]*aria-)', '<svg aria-hidden="true" ', 'any')

    # --- 7. distinct glyphs where identity is claimed to ride the glyph ------
    if mgmt:
        tiles = re.findall(r'<span class="chip">\s*<svg.*?</svg>\s*</span>', s, re.S)
        for i, tile in enumerate(tiles[:4]):
            key = ['sessions', 'needsyou', 'machines', 'spend'][i]
            s = s.replace(tile, f'<span class="chip">{SVG_OPEN}{GLYPHS[key]}</svg></span>', 1)
        R.rx(s, 'kpi glyphs distinct', r'<span class="chip">', '<span class="chip">',
             {'v2-fleet.html': 4, 'v3-assistant.html': 4, 'v4-transcript.html': 0})
        marks = list(re.finditer(r'(<span class="mark">)(\s*<svg.*?</svg>\s*)(</span>)', s, re.S))
        for i, m in enumerate(marks):
            key = ['claude', 'opencode', 'pi'][i % 3]
            s = s.replace(m.group(0), f'{m.group(1)}{SVG_OPEN}{GLYPHS[key]}</svg>{m.group(3)}', 1)


    # --- 8. the drawer: a keyboard-operable opener, and inert when closed ----
    s = R.rx(s, 'burger -> button',
             r'<label for="navt" class="burger">',
             '<button type="button" class="burger" aria-expanded="false" '
             'aria-controls="sidenav" aria-label="Open navigation">',
             {'v2-fleet.html': 1, 'v3-assistant.html': 1, 'v4-transcript.html': 0})
    s = R.rx(s, 'close burger button',
             r'(<button type="button" class="burger"[^>]*>(?:(?!</label>).)*?)</label>',
             r'\1</button>',
             {'v2-fleet.html': 1, 'v3-assistant.html': 1, 'v4-transcript.html': 0})
    s = R.rx(s, 'drop the checkbox', r'<input type="checkbox" id="navt" hidden>', '',
             {'v2-fleet.html': 1, 'v3-assistant.html': 1, 'v4-transcript.html': 0})
    s = R.rx(s, 'name the nav region', r'<aside>',
             '<aside id="sidenav" aria-label="Fleet navigation">',
             {'v2-fleet.html': 1, 'v3-assistant.html': 1, 'v4-transcript.html': 1})
    s = R.rx(s, 'checkbox selectors -> class', r'#navt:checked ~ ', '.nav-open ',
             {'v2-fleet.html': 2, 'v3-assistant.html': 2, 'v4-transcript.html': 0})
    s = R.rx(s, 'drop the checkbox rule', r'#navt\{display:none\}\n?', '',
             {'v2-fleet.html': 1, 'v3-assistant.html': 1, 'v4-transcript.html': 0})
    s = R.rx(s, 'drawer script', r'</body>', DRAWER_JS + '</body>', 'any')


    # v4 has the same off-canvas aside and NO opener of any kind: below 900px its
    # navigation was unreachable by any input, not merely by keyboard.
    s = R.rx(s, 'v4 burger + scrim', r'<header class="shead">',
             '<header class="shead"><button type="button" class="burger" aria-expanded="false" '
             'aria-controls="sidenav" aria-label="Open navigation">' + SVG_OPEN
             + '<path d="M4 7h16M4 12h16M4 17h16"/></svg></button>',
             {'v2-fleet.html': 0, 'v3-assistant.html': 0, 'v4-transcript.html': 1})
    if '<div class="scrim">' not in s:
        s = R.rx(s, 'v4 scrim element', r'</main>', '</main><div class="scrim"></div>',
                 {'v2-fleet.html': 0, 'v3-assistant.html': 0, 'v4-transcript.html': 1})
    s = R.rx(s, 'v4 drawer css',
             r'(  aside\{position:fixed;inset:0 auto 0 0;width:284px;z-index:40;transform:translateX\(-100%\)\})',
             r'\1\n  .nav-open aside{transform:none}\n'
             '  .nav-open .scrim{opacity:1;pointer-events:auto}\n'
             '  .burger{display:grid;place-items:center;width:44px;height:44px;flex:0 0 auto;'
             'border-radius:var(--radius-control);color:var(--ink-body)}',
             {'v2-fleet.html': 0, 'v3-assistant.html': 0, 'v4-transcript.html': 1})
    s = R.rx(s, 'v4 base burger/scrim css', r'(\.shead\{height:57px;)',
             '.burger{display:none}\n'
             '.scrim{position:fixed;inset:0;background:var(--scrim);opacity:0;pointer-events:none;'
             'transition:opacity var(--motion-slow);z-index:30}\n'
             '.burger svg{width:19px;height:19px}\n'
             r'\1',
             {'v2-fleet.html': 0, 'v3-assistant.html': 0, 'v4-transcript.html': 1})


    # --- 9. decision glyphs, so the pair reads without colour or size ---------
    s = R.rx(s, 'grant glyph', r'(<button class="grant">)',
             r'\1' + SVG_OPEN + '<path d="M2.4 6.3 4.9 8.8l4.7-5.6"/></svg>',
             {'v2-fleet.html': 0, 'v3-assistant.html': 0, 'v4-transcript.html': 1})
    s = R.rx(s, 'refuse glyph', r'(<button class="refuse">)',
             r'\1' + SVG_OPEN + '<path d="M3.2 3.2l5.6 5.6M8.8 3.2l-5.6 5.6"/></svg>',
             {'v2-fleet.html': 0, 'v3-assistant.html': 0, 'v4-transcript.html': 1})
    s = R.rx(s, 'standing-grant glyph', r'(<div class="widen">\s*<button[^>]*>)',
             r'\1' + SVG_OPEN + '<path d="M6 2.6 1.2 9.4h9.6z"/><path d="M6 5.2v1.8M6 8v.1"/></svg>',
             {'v2-fleet.html': 0, 'v3-assistant.html': 0, 'v4-transcript.html': 1})


    # --- 10. the board's stated job must be reachable ------------------------
    # The KPI read "Needs you 3" while page 1 carried 2 attention chips, the KPI
    # was a static <div>, and the default sort was "Last active" — so the number
    # that defines this product's core job named three things, showed two, and
    # offered no way to reach the third. The count now matches what the page
    # shows, the KPI is a real control that filters to exactly those rows, and
    # the default sort puts them first.
    if mgmt:
        s = R.rx(s, 'third needs-you row is visible_OFF',
                 r'(<span class="chip-s s-live">(?:(?!</span>).)*?</span>)',
                 lambda m, seen=[0]: (seen.__setitem__(0, seen[0] + 1) or m.group(1))
                 if seen[0] else (seen.__setitem__(0, 1) or
                                  m.group(1).replace('s-live', 's-attn')
                                  .replace('working', 'needs you')),
                 {'v2-fleet.html': 2, 'v3-assistant.html': 2, 'v4-transcript.html': 0})
        # located by walking back from the label text to its own opening tag:
        # the `.lbl` div now contains a generated glyph, so a fixed-shape regex
        # around it stopped matching and silently no-oped.
        anchor = 'NEEDS_YOU_DISABLED'
        i = s.find(anchor)
        n = 0
        if i != -1:
            j = s.rfind('<div class="lbl">', 0, i)
            if j != -1:
                # promote the CARD, not the label: a 44px minimum on a 24px
                # label row pushed the KPI value out of its well under a coarse
                # pointer, while the card is already 280x90.
                k = s.rfind('<div class="stat">', 0, j)
                s = (s[:k] + '<button type="button" class="stat kpi-filter" '
                     'aria-label="Filter the board to the sessions that need you">'
                     + s[k + len('<div class="stat">'):i] + 'Needs you</div>'
                     + s[i + len(anchor):])
                # close it as a button rather than a div
                endm = s.find('</div></div></div>', i)
                if endm != -1:
                    s = s[:endm] + '</div></div></button>' + s[endm + len('</div></div></div>'):]
                n = 1
        # Reverted with its siblings above: the KPI-as-control work is handed to
        # the page phase, which owns sorting, filtering and pagination against
        # real data. Renamed with the `_OFF` suffix its siblings already carry so
        # the expectation opts out too — left un-suffixed it recorded 0-vs-1 on
        # every build, exiting nonzero and silently skipping the two token steps
        # that follow.
        R._record('KPI becomes a control_OFF', n,
                  {'v2-fleet.html': 0, 'v3-assistant.html': 0, 'v4-transcript.html': 0})
        s = R.rx(s, 'default sort is needs-you first_OFF',
                 r'(<button type="button" class="sel">)Last active',
                 r'\1Needs you first', {'v2-fleet.html': 1, 'v3-assistant.html': 1,
                                         'v4-transcript.html': 0})

    # --- 11. four unexplained counts of the same noun ------------------------
    # 6 / 6 / 4 / 24 on one screen, none qualified. They are four different
    # quantities, so each label now says which.
    if mgmt:
        s = R.rx(s, 'KPI sessions qualified_OFF', r'</span>Sessions</div>', '</span>Live sessions</div>',
                 'opt')
        s = R.rx(s, 'running list qualified_OFF', r'<div class="sec">◌ Running now',
                 '<div class="sec">◌ Running on nixbox',
                 'opt')
        s = R.rx(s, 'footer count agrees with the page_OFF', r'Showing 8 of 24',
                 'Showing 8 of 24 sessions · all states',
                 'opt')


    if mgmt:
        s = R.rx(s, 'filters disclosure',
                 r'<div class="filters">',
                 '<details class="filterbox"><summary>Filters and export</summary>'
                 '<div class="filters">',
                 {'v2-fleet.html': 1, 'v3-assistant.html': 1, 'v4-transcript.html': 0})
        s = R.rx(s, 'close filters disclosure',
                 # `.filters` closes BEFORE the Export control, so anchoring on
                 # Export put </details> outside .bar and left the disclosure
                 # wrapping the wrong subtree.
                 # the disclosure wraps the filters AND Export: neither is what
                 # someone opens this on a phone to do
                 r'(Export CSV</div>)',
                 r'\1</details>', {'v2-fleet.html': 1, 'v3-assistant.html': 1,
                                    'v4-transcript.html': 0})

    path.write_text(s)
    return R


if __name__ == '__main__':
    bad = 0
    for name in ('v2-fleet.html', 'v3-assistant.html', 'v4-transcript.html'):
        R = transform(HERE / name)
        bad += R.bad
        print(f"{name:<22} {sum(n for _, n in R.log)} a11y rewrites")
    sys.exit(1 if bad else 0)
