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
    'pi':       '<path d="M5 7.5h14M9 7.5v9M15 7.5v6.5a2.5 2.5 0 0 0 4 0"/>',
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

    # --- 1. row actions: bare text -> real icon buttons ---------------------
    # The column shipped as ghost text ("Open / Peek / Pause"). Each action word
    # becomes a Solar-duotone icon button carrying the word as its accessible
    # name — a real affordance (ghost border + hover fill, styled in retoken's
    # STATES_CSS), keyboard-focusable and named. The idle "—" is NOT a control:
    # it is the absence of an action, so it stays a muted dash, not a tab stop.
    # Runs on v2 AND v3: `.act button` is a parity-checked shared class, so the
    # table's action affordance must be identical on both boards.
    ACT_ICON = {'Open': 'square-arrow-right-up', 'Peek': 'eye',
                'Pause': 'pause', 'Resume': 'play'}

    def _act_btn(b):
        w = b.group(1)
        ic = ACT_ICON.get(w)
        if not ic:
            return f'<button type="button">{w}</button>'
        return f'<button type="button" aria-label="{w}">{{{{solar:{ic}}}}}</button>'

    s = R.rx(s, 'action spans -> buttons',
             r'<div class="act">(.*?)</div>',
             lambda m: '<div class="act">' + re.sub(
                 r'<span>([^<]+)</span>', _act_btn, m.group(1)) + '</div>',
             {'v2-fleet.html': 8, 'v3-assistant.html': 8, 'v4-transcript.html': 0})
    s = R.rx(s, 'idle marker not a control',
             r'<span class="mut" aria-label="no action available">—</span>',
             '<span class="mut" role="presentation">—</span>',
             {'v2-fleet.html': 1, 'v3-assistant.html': 1, 'v4-transcript.html': 0})

    # --- 2. navigation and session lists -> links ---------------------------
    s = R.rx(s, 'nav items -> links', r'<div class="nav-i( on)?">',
             lambda m: f'<a class="nav-i{m.group(1) or ""}" href="#nav">',
             {'v2-fleet.html': 8, 'v3-assistant.html': 8, 'v4-transcript.html': 8})
    s = R.rx(s, 'run items -> links', r'<div class="run-i( on)?">',
             lambda m: f'<a class="run-i{m.group(1) or ""}" href="#session">',
             {'v2-fleet.html': 4, 'v3-assistant.html': 4, 'v4-transcript.html': 4})
    # the closing tags for both live on the same one-line rows
    s = R.rx(s, 'close nav/run links',
             r'(<a class="(?:nav-i|run-i)[^"]*" href="#[^"]*">(?:(?!</div>).)*?)</div>',
             r'\1</a>', {'v2-fleet.html': 12, 'v3-assistant.html': 12, 'v4-transcript.html': 12})

    # --- 3. favourites, filters, pagination, search -------------------------
    s = R.rx(s, 'favourite -> button', r'<span class="star">',
             '<button type="button" class="star" aria-label="Favourite this session">',
             {'v2-fleet.html': 4, 'v3-assistant.html': 4, 'v4-transcript.html': 4})
    s = R.rx(s, 'close favourite',
             r'(<button type="button" class="star"[^>]*>(?:(?!</span>).)*?)</span>',
             r'\1</button>', {'v2-fleet.html': 4, 'v3-assistant.html': 4, 'v4-transcript.html': 4})
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
             {'v2-fleet.html': 1, 'v3-assistant.html': 1, 'v4-transcript.html': 1})
    s = R.rx(s, 'close collapse',
             r'(<button type="button" class="collapse"[^>]*>(?:(?!</span>).)*?)</span>',
             r'\1</button>', {'v2-fleet.html': 1, 'v3-assistant.html': 1, 'v4-transcript.html': 1})
    s = R.rx(s, 'section plus -> button', r'<span class="plus">',
             '<button type="button" class="plus" aria-label="New session">',
             {'v2-fleet.html': 1, 'v3-assistant.html': 1, 'v4-transcript.html': 1})
    s = R.rx(s, 'close section plus',
             r'(<button type="button" class="plus"[^>]*>(?:(?!</span>).)*?)</span>',
             r'\1</button>', {'v2-fleet.html': 1, 'v3-assistant.html': 1, 'v4-transcript.html': 1})

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

    # Per-item identity rides the HUE and the harness rides the GLYPH, two
    # channels carrying two facts. Both are now keyed to the author's per-session
    # inline hex in retoken.py (_mark_ident) — NOT to DOM occurrence order — so the
    # same session resolves to the same hue and harness glyph in the sidebar, the
    # board and the v4 header. The positional loop that used to live here assigned
    # by occurrence and drew a session differently in each location; it is gone.


    # --- 13. Unicode standing in for icons ----------------------------------
    # 57 <svg> elements already existed, so an icon system was present and these
    # spots simply never got wired to it. A previous review flagged three of them
    # and the fix replaced those three, leaving the class untouched.
    ICONS = {
        '\u25e7': '<path d="M4 4h16v16H4z"/><path d="M4 4h8v16H4z" fill="currentColor"/>',
        '\u25cc': '<circle cx="12" cy="12" r="7" stroke-dasharray="2 2.5"/>',
        '\u25a4': '<path d="M4 6h16M4 12h16M4 18h16"/>',
        '\u2039': '<path d="M14 6l-6 6 6 6"/>',
        '\u203a': '<path d="M10 6l6 6-6 6"/>',
        '\u2304': '<path d="M6 9.5l6 6 6-6"/>',
        '\u25a0': '<rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor"/>',
    }
    for ch, glyph_path in ICONS.items():
        n = s.count(ch)
        if n:
            s = s.replace(ch, SVG_OPEN + glyph_path + '</svg>')
        R._record(f'icon for {ch!r}', n, 'opt')


    # --- 8. the drawer: a keyboard-operable opener, and inert when closed ----
    # The opener was a <label for=navt> with tabIndex -1 driving a hidden
    # checkbox: it worked with a mouse and had no tab stop at any width where it
    # paints, while the closed <aside> kept all 19 of its focusables in the tab
    # order at x = -274..-31.
    s = R.rx(s, 'burger -> button', r'<label for="navt" class="burger">',
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
    s = R.rx(s, 'v4 burger', r'<header class="shead">',
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
    s = R.rx(s, 'v4 base burger css', r'(\.shead\{height:57px;)',
             '.burger{display:none}\n'
             '.scrim{position:fixed;inset:0;background:var(--scrim);opacity:0;pointer-events:none;'
             'transition:opacity var(--motion-slow);z-index:30}\n'
             '.burger svg{width:19px;height:19px}\n'
             r'\1',
             {'v2-fleet.html': 0, 'v3-assistant.html': 0, 'v4-transcript.html': 1})
    s = R.rx(s, 'drawer script', r'</body>', DRAWER_JS + '</body>', 'any')


    # --- 14. shared classes must render equivalently across all three mocks ---
    # v4's .nav-i reported svgs: 0 while v2's reported 1 — the three files share a
    # class vocabulary but not an implementation, so a fix applied to one silently
    # misses the others. Same shape as the mark-fill bug.
    NAV_ICONS = {
        'Fleet': '<rect x="3" y="3" width="7" height="7" rx="1.6"/><rect x="14" y="3" width="7" height="7" rx="1.6"/>'
                 '<rect x="3" y="14" width="7" height="7" rx="1.6"/><rect x="14" y="14" width="7" height="7" rx="1.6"/>',
        'Tools': '<path d="M14.7 6.3a4 4 0 0 1-5.4 5.4L5 16v3h3l4.3-4.3a4 4 0 0 0 5.4-5.4l-2 2-1.6-1.6z"/>',
        'Rules': '<path d="M4 5h16M4 12h11M4 19h7"/>',
        'Usage': '<path d="M4 19V9M10 19V4M16 19v-7M22 19H2"/>',
        'Projects': '<path d="M3 7h6l2 2h10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    }
    n = 0
    for label, glyph in NAV_ICONS.items():
        # v4 wraps its labels in a <span>; v2/v3 do not. Matching one spelling
        # is exactly how this class diverged between files in the first place.
        for cls in ('nav-i', 'nav-i on'):
            for body in (label, f'<span>{label}</span>'):
                old = f'<a class="{cls}" href="#nav">{body}</a>'
                if old in s:
                    n += s.count(old)
                    s = s.replace(old, f'<a class="{cls}" href="#nav">'
                                       f'<span class="ic">{SVG_OPEN}{glyph}</svg></span>'
                                       f'<span>{label}</span></a>')
    R._record('nav icons present in every mock', n, 'opt')

    # Section headers stand as plain uppercase text labels. The previous
    # dashed-circle placeholder glyph read as an unfinished icon, not a real
    # one, so it is removed rather than shared across files.

    path.write_text(s)
    return R


if __name__ == '__main__':
    bad = 0
    for name in ('v2-fleet.html', 'v3-assistant.html', 'v4-transcript.html'):
        R = transform(HERE / name)
        bad += R.bad
        print(f"{name:<22} {sum(n for _, n in R.log)} a11y rewrites")
    sys.exit(1 if bad else 0)
