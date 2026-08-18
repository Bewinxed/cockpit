# Design Review: Phase 3 — Cockpit / FlowAI overhaul (visual identity lock)

**Date:** 2026-08-18 · **Reviewer:** design-review-agent (independent, dual-blind)
**Verdict: FAIL** — one Critical defect proven in the rendered pixels. Every DW item
itself passes or partials; the blocker is a rendering failure the DW list does not cover.

---

## Rendered Evidence (Step 0)

- Screenshots read: `mocks/v2-fleet.png`, `mocks/v2-dark.png`, `mocks/v2-mobile.png`,
  plus live renders at 1440×1023 and 390×1023 via playwright-core / chromium-1234.
- Live measurement: every number below was read off the **rendered DOM or a painted
  pixel**, never quoted from CSS source. Method:
  - token values resolved through a probe element in the live document, both schemes;
  - chip tints sampled as the **modal painted colour** inside each chip's bounding box
    from a real screenshot (this matters — the tints are `oklab()`/`color-mix()` with
    alpha, so computed-style strings composite differently than they read);
  - geometry from `getBoundingClientRect()`;
  - clipping from `clientHeight` vs `scrollHeight` on elements with `overflow:hidden`.
- Surface: 3 mocks (fleet board, assistant, transcript), light + dark, desktop + mobile.

**Layout: Verified.** No coverage gap.

---

## Assessment B — Deterministic Detector

- Command: `node /home/bewinxed/.claude/plugins/cache/rtd/design-for-ai/4.2.0/scripts/detect.mjs mocks/v2-fleet.html mocks/v3-assistant.html mocks/v4-transcript.html > /tmp/detect-p3.json`
- Exit: **0 (ran)** · 16 rules · stderr empty
- Findings: **18 total, 100% `nested-cards` (High)**. Zero hits on the other 15 rules.
- Opened only after Assessment A findings were frozen: **YES**

### Container-level verification of all 18 hits → all false

The prompt documents this rule's false-positive behaviour, so a raw count is not a
signal. I re-measured every flagged element against its nearest true card ancestor:

| flagged | rendered size | child pad / radius | card ancestor | card pad / radius | uniform-padding form? |
|---|---|---|---|---|---|
| `.ghost` | 90×32 | `0px 13px` / 8px | none | — | no |
| `.icobtn` | 32×32 | `0px` / 8px | none | — | no |
| `.search` | 237×32 | `0px 11px` / 8px | `.panel` | 11px / 14px | no |
| `.sel` ×3 | 120×32 | `0px 11px` / 8px | `.panel` | 11px / 14px | no |
| `.ghost.exp` | 119×32 | `0px 13px` / 8px | `.panel` | 11px / 14px | no |
| `.a-orb` | 66×66 | `0px` / 999px | none | — | no |

Every hit is a **32px control** (button, search field, select) or a circular orb.
Not one shares its ancestor's padding *and* radius — which is precisely the
distinction DESIGN.md `## Never` item 1 draws and the prompt's edge case requires.
**Assessment B contributes 0 real findings.** Note this is 18 hits, not the ~77 the
prompt warned of — the surface is materially cleaner than the rule's worst case.

---

## Triage

- **Baseline (always-on):** visual (`design-dna`, `ai-tells`, `foundations`,
  chapter-03 typography, chapter-08/09 colour) + usability.
- **Dispatched:** `data-viz` — the stat row is a four-tile KPI strip encoding numbers,
  and the table encodes counts/cost/context. `content-design` — real product copy is
  present (status labels, empty/threshold copy, button microcopy).
- **Not applicable:** `behavioral` / `deceptive-patterns` (no conversion or persuasion
  surface — this is an internal operator console); `journey` (JOURNEY.md is committed
  and gate-passed in an earlier phase, out of scope here); `ai-native`, `design-systems`.
- **Deferred:** none.

---

## Cross-Pillar Findings (ONE ranked report)

| # | Severity | Pillar | Problem (in the rendered pixels) | Principle | Fix |
|---|---|---|---|---|---|
| 1 | **Critical** | usability / data-viz | **All four KPI values are clipped.** `.stat .v` measures `clientHeight 24px` vs `scrollHeight 38px` with `overflow-y:hidden` — 14px of every number is cut off. Affects "6", "3", "2 of 3", "$18.40" in v2 and v3, light **and** dark. At 390px it is `clientHeight 16px` vs `scrollHeight 38px` — **22px clipped, and none of the four numbers is legible** (see `v2-mobile.png`). | Nielsen #1 visibility of system status; Tufte — the data is the ink, and here the ink is amputated. Mobile is a stated first-class requirement and the operator approves permissions from a phone. | Remove the fixed height on `.stat .v` (or set `line-height:1.15` and `min-height` to the computed line box). Verify `scrollHeight === clientHeight` at 390px and 1440px before re-gating. |
| 2 | **Critical** | visual (typography) | **Body leading renders 1.45, not the locked 1.4.** Measured `line-height 21.025px / font-size 14.5px = 1.45` on **101 of 111** text-bearing elements. The measured-reference spec requires **1.2–1.4**. DESIGN.md `## Type` states 1.4 *and explicitly claims* "The incoming mocks shipped 1.45… **corrected**" — that claim is false against the rendered artifact. This is also the proximate cause of finding 1: `26.25px × 1.45 = 38.06px` is the line box that overflows the 24px well. | chapter-03 typography (leading is a medium-form constraint, not taste); design-dna — drift from a locked DESIGN.md value is a governance failure, not a nit. | Set the `body` shorthand to `/1.4`. Then re-run the stat-card overflow check, since 1.4 alone does not clear it. |
| 3 | Major | visual (colour) | **Nav count pill misses AA in light: 4.47:1.** In `v3-assistant.html` the "6" pill sits on an **active** nav row, so its semi-transparent warning tint composites over `--surface-hover` → painted tint `rgb(228,221,204)` under ink `rgb(111,97,68)` = **4.47:1** at 11.5px/500. The identical pill measures **4.96:1** in v2 where the row is not active. The prompt states both schemes must pass AA. | WCAG 2.2 §1.4.3 (4.5:1, small text). A state-dependent miss is still a miss. | Darken the pill ink one ramp step, or set the pill tint opaque so it does not composite with the row state. |
| 4 | Major | data-viz | **One identical glyph on four different metrics.** Sessions / Needs you / Machines / Spend today all carry the same orbital mark — and it is *also* every table row mark and every "Running now" item mark. A glyph that appears on everything distinguishes nothing. | Tufte data-ink ratio (decoration masquerading as encoding); Nielsen #4 consistency — same icon must mean the same thing, so one icon for four meanings breaks the contract. | Give each stat a distinct glyph, or drop the tiles entirely — the labels already carry the meaning and the well is the signature move. |
| 5 | Major | usability | **v4 composer hint row clips.** `.inner` measures `clientHeight 8px` vs `scrollHeight 17px` with overflow hidden — "/ commands  @ mention  ＋ attach" is cut through the middle. Same root cause family as finding 1. | Nielsen #6 recognition over recall — the affordance hints are the discoverability mechanism, and they are unreadable. | Same fix: unconstrain the line box. |
| 6 | Major | usability | **Mobile filter row overflows horizontally.** At 390px the "Last active" chip is sliced by the viewport edge (`v2-mobile.png`); there is no visible scroll affordance. | Nielsen #1; mobile is first-class per the brief. | Wrap the filter chips or give the row an explicit scroll affordance. |
| 7 | Minor | visual | `.run-i .mark` renders `border-radius: 6px`, overriding the `--radius-mark: 4.6px` token. 6px is not on the shipped ladder (4 / 4.6 / 5.5 / 7 / 8 / 10 / 14 / 999). The **table** row mark is correct at 4.6px. | design-systems — an off-ladder hardcoded value is how a token system starts to rot. | Use `var(--radius-mark)`. |
| 8 | Minor | visual | Stat card measures **281×90**; the reference is 280×90 (+1px). Sub-threshold for `fidelity.py`, noted for completeness. | — | Optional. |
| 9 | Minor | visual | v4's overlay shadow uses `rgba(20, 20, 20, 0.11)` rather than the `--shadow-tint-*` family used everywhere else. Not pure black and not hex, so DW-3.10 and DW-3.13c both hold literally — but it is a token leak in an otherwise fully tokenized system. | design-systems — token coverage. | Swap for `var(--shadow-overlay)`. |
| 10 | Note | visual | DESIGN.md `## Open questions` states "The mono face is **loaded**". `document.fonts` reports only `"Geist Variable loaded"`, and `mocks/fonts/` ships no mono `.woff2`. No visible effect (no `.mono` text renders), but the statement is not true of the mocks. | Evidence discipline. | Ship the mono file or reword. |
| 11 | Note | visual | Dark `--accent-solid` on `--background` = **3.32:1** against a 3:1 floor — the thinnest margin in the system. DESIGN.md already records this as an open question, which is the right handling. | WCAG 1.4.11. | Watch it. |
| 12 | Note | process | `palette.mjs --scheme both` **exactly as DW-3.1 writes it exits 1** (`missing --seed`). With the project's documented invocation (`--seed 263 --chroma muted --harmony analogous --scheme both`) it exits **0 with 0 FAIL lines**. Scored on the documented invocation. | — | Amend the DW wording. |

### Distinctiveness (ai-tells.md CHECKER mode) — **PASS**

Nameable in three words: **quiet recessed ledger**. Choices a generic system would not
make, each verified in the render: the **25/21 asymmetric content padding**; the **7px
recessed well at r7 inside a r10 card** (a real signature move, not a default); a
**13px type anchor** with a 1.125 ratio stepped to quarter-pixels; a **weight ceiling of
500 with a 450 intermediate**; a **graphite brand mark instead of an accent one**, with
saturated colour confined to **2.26% of the surface, largest region 0.119%**. This is
not competent-but-generic — no Critical here.

---

## Requirement Fulfillment

### DW-3.1
PREMISE: *(smoke check only)* `palette.mjs --scheme both` exits 0 with no FAIL lines.
EVIDENCE: As literally written it exits **1** (`palette.mjs: missing --seed`). With the
project's documented invocation `--seed 263 --chroma muted --harmony analogous --scheme both`:
**exit 0, `grep -c FAIL` = 0, stderr 0 bytes.** Scored on the documented invocation.
VERDICT: **PASS** (see Note 12)

### DW-3.2
PREMISE: `--neutral-1`…`--neutral-12` and `--accent-1`…`--accent-12` present in both
schemes; all 13 semantic aliases resolve; functional colors `--error/success/warning/info-3/9/11` defined.
EVIDENCE: Probed live in the rendered document, both schemes. 24 ramp tokens + 12
functional tokens + 13 aliases resolved. **`MISSING light: none` · `MISSING dark: none` ·
`aliases resolved: 13/13 light, 13/13 dark`.** Spot values: `--neutral-11` = `rgb(96,99,106)`
light / `rgb(180,183,190)` dark; `--accent-9` = `rgb(68,102,172)` both.
VERDICT: **PASS**

### DW-3.3
PREMISE: Pairs `palette.mjs` does *not* verify, measured independently, in both light and
dark: `--error-11`, `--warning-11`, `--success-11`, `--info-11` each on `--surface` **and**
on `--surface-hover` ≥ 4.5:1 · `--text-secondary` on `--surface-hover` and on `--surface-active`
≥ 4.5:1 · `--accent-solid` on `--background` ≥ 3:1 non-text. Every status pill's
text-on-tint pair measured.
EVIDENCE: All 22 enumerated pairs computed from live-resolved token values —
**all pass**, range 4.90–9.00:

| pair | light | dark |
|---|---|---|
| `error-11` on `surface` / `surface-hover` | 5.92 / 5.48 | 8.54 / 7.74 |
| `warning-11` on `surface` / `surface-hover` | 5.74 / 5.31 | 8.79 / 7.97 |
| `success-11` on `surface` / `surface-hover` | 5.53 / 5.12 | 9.00 / 8.16 |
| `info-11` on `surface` / `surface-hover` | 5.65 / 5.22 | 8.86 / 8.03 |
| `text-secondary` on `surface-hover` / `surface-active` | 5.28 / **4.90** | 7.93 / 7.15 |
| `accent-solid` on `background` (≥3:1) | 5.51 | **3.32** |

Every status pill measured from **painted pixels**, both schemes, all three mocks —
14 distinct pill instances. All clear 4.5:1 **except one**: the `pill-n` count badge on
the *active* nav row in v3 light at **4.47:1** (finding 3). Passing pills: needs-you 4.96,
working 4.75, error 4.72, idle/paused 5.90 (v2 light); 6.18–7.93 (v2 dark); 5.84–6.13
(v3 light); 6.98–7.24 (v3 dark); 4.96 / 5.47 (v4 light); 6.18 / 8.75 (v4 dark).
VERDICT: **PARTIAL** — every enumerated threshold passes and every pill was measured;
one measured pill lands 0.03 under AA.

### DW-3.4
PREMISE: The dark ramp activates under the project's `.dark` class variant — verified by
rendering, not by the presence of a token block.
EVIDENCE: Verified by rendering. `tokens.css` bridges the generator's selector to
`[data-theme="dark"], .dark` (L77-78, L218-219). Toggling `documentElement.classList.add('dark')`
in the live page moves `--neutral-1` from `rgb(252,253,253)` → `rgb(18,19,19)`,
`--text-secondary` from `rgb(96,99,106)` → `rgb(180,183,190)`, and all 22 contrast pairs
re-resolve to the dark column above. `v2-dark.png` confirms visually, and it is a
**re-solved twin, not an inversion** — the raised surface climbs the ramp.
VERDICT: **PASS**

### DW-3.5
PREMISE: Type scale `--text-xs`…`--text-4xl` present with `--font-body` and `--font-display`;
`## Type` states ratio, base px, enumerated steps, leading, and weights.
EVIDENCE: All 11 tokens resolve live. `--font-body` and `--font-display` both
`'Geist Variable', ui-sans-serif, system-ui, …`. `## Type` states ratio **1.125**, base
**13px**, all 9 steps enumerated in a table (10.25 → 26.25), leading (**body 1.4** /
display 1.2 / UI 1.25), and weights (400 / 450 / 500, never 600). Rendered weights confirm:
**400 ×93, 450 ×14, 500 ×36 — zero at 600+.**
VERDICT: **PASS** — the section states everything required. That the *rendered* leading
is 1.45 rather than the stated 1.4 is finding 2, not a defect of this item.

### DW-3.6
PREMISE: Primary face is none of Inter / Roboto / Open Sans / Arial / Space Grotesk,
installs from `@fontsource-variable/*`, and carries a one-line justification tying
letterform to the comps' character.
EVIDENCE: Rendered `fontFamily` on 141 of 143 text elements is **`"Geist Variable"`**
(the other 2 are `<title>` and `<style>`, non-rendered). `document.fonts` → `"Geist Variable loaded"`.
Sourced `@fontsource-variable/geist@5.3.0`, OFL-1.1, self-hosted at
`mocks/fonts/geist-latin-wght-normal.woff2` with a `100 900` variable axis. Justification
is present and *measured from the shipped file*: x-height 0.530em against 0.710em cap
height, giving a 6.9px x-height at the 13px base — tied explicitly to holding a 44px row
pitch legible without reaching for weight. None of the banned five.
VERDICT: **PASS**

### DW-3.7
PREMISE: Accent contains none of `#6366F1`, `#8B5CF6`, `#A855F7`; palette is neither
cyan-on-dark nor a purple-to-blue gradient.
EVIDENCE: `--accent-solid` resolves live to **`rgb(68,102,172)` = `#4466AC`** in both
schemes — a muted mid blue, none of the three banned hexes. Despite the `hue=263` pin
reading as violet, the generator's 263° lands in the blue band; verified against the
render, not assumed. The ground is achromatic neutral (`#FCFDFD` light / `#121313` dark),
so not cyan-on-dark. No purple-to-blue gradient anywhere: the only multi-stop fills are
the CTA (two lightness steps of one neutral) and the row mark (white 22% → neutral 6%).
The `--violet-*` harmony tokens exist in the ramp but are referenced **0 times** across
all three mocks, and `var(--accent-N)` is used as a fill **0 times**.
VERDICT: **PASS**

### DW-3.8
PREMISE: DESIGN.md carries all 10 template sections, `**Status:** confirmed`, and a
`**Pins:**` line recording the comp-pinned axes.
EVIDENCE: Header block (L1-7) carries title, Date/Status, Archetype/Register, Grounding,
DNA/Dominant axis, Composition, Pins — followed by the 9 `##` sections in template order:
Direction, Signature move, Expressive moments, Type, Color tokens, Space/shape/depth,
Motion, Never, Open questions. L2: `**Status:** confirmed`. L7: `**Pins:**` recording
`family` · `discipline` · `hue=263` · `chroma` · `signature`, including the converge swap.
VERDICT: **PASS**

### DW-3.9
PREMISE: `## Never` names the **uniform-padding** form of `nested-cards` plus at least two
further tells scoped to this DNA, and explicitly **permits** the comps' inset-well surface.
EVIDENCE: Item 1 names it precisely — "A card inside a card where **both carry the same
padding and the same radius**" — and in the same item states "**Explicitly permitted, and
required:** the comps' **inset-well** surface… a different inset (7px), a different fill
… and a different radius (7 inside 10)". Seven further DNA-scoped tells follow
(decorative hue, red-as-ambient, unmodified shadcn defaults, weight >500, pure-black
shadow, uniform spacing, matching a comp defect) — well past the two required.
VERDICT: **PASS**

### DW-3.10
PREMISE: Shipped `--radius`, spacing, and shadow values differ from shadcn's defaults;
no shadow uses pure black.
EVIDENCE: `--radius: 10px` (shadcn default 0.5rem = 8px) with a ladder of
4 / 4.6 / 5.5 / 7 / 8 / 10 / 14 / 999 — not shadcn's 4/6/8/12. Spacing
**4 / 7 / 11 / 14 / 18 / 21 / 25 / 32** — neither shadcn's nor Tailwind's 4/8/12/16/20/24/32.
Every rendered shadow resolves through `oklch(from var(--neutral-12) l c h / α)`, e.g.
`oklch(0.300347 0.00609613 258.468 / 0.055)` — chroma 0.006 at hue 258, i.e. cool-tinted.
**Zero `rgba(0,0,0,·)` shadows** across all three mocks; the nearest is v4's
`rgba(20,20,20,0.11)`, which is not pure black (finding 9).
VERDICT: **PASS**

### DW-3.12
PREMISE: Status chips use only the four functional hues; any non-status accent is visibly
distinct from all four. Status stays legible **with hue removed** — glyph and label carry
it. Saturated colour appears only on chips, badges, and small marks; no large surface is
saturated.
EVIDENCE: Rendered chips resolve to exactly four functional inks — warning `rgb(111,97,68)`
(needs you), info `rgb(76,103,122)` (working), error `rgb(134,83,79)` (error), neutral
`rgb(96,99,106)` (idle/paused). No fifth hue. **Hue-removed legibility:** every `chip-s`
carries `glyphs: 1` plus a word — ↑ needs you, ● working, ✕ error, ‖ idle, ‖ paused —
so the state survives desaturation on glyph + label alone. **Saturation census
(`satcensus-report.txt`, run on the shipped PNGs):** v2-fleet **2.262%** of the surface
saturated across 3737 regions, **largest region 1753px = 0.1190%**; v2-dark 2.361%,
largest 0.0992%. Nothing above chip/mark scale. Red appears only on the `error` chip and
the 191k context figure — never as decoration.
VERDICT: **PASS**

### DW-3.13
PREMISE: `mocks/fidelity.py` exits 0 against a rendered mock.
EVIDENCE: Reproduced independently: `python3 fidelity.py /tmp/flowai/crop-table-1x.png v2-fleet.png`
→ **exit 0**, final line `PASS`. All 27 detected quantities `ok`. Per the DW's own
instruction I did **not** reconcile the painted-run proxies against the measured-reference
box table: `stat_run_w` 264→265, `stat_run_gap` 30→30, `sidebar_w` 228→227 are stable and
identical in kind across reference and build, which is what makes the comparison valid.
VERDICT: **PASS**

### DW-3.13b
PREMISE: **AA beats fidelity where the comp is wrong.** The reference's header-label ink
`#838383` on band `#F1F1F1` is 3.36:1, below the 4.5 floor. Such inks are judged on their
own AA ratio and reported as accepted deviations.
EVIDENCE: `gate-report.txt` and my own `fidelity.py` run both carry the override block
verbatim: `band_label_ink  build 5.24:1 on #F1F1F1   ref 3.36:1   min 4.5   PASS`, listed
under "AA overrides — reference is defective here; build judged on AA, not on match". The
build ships `#646464` (−31L from the comp) and is scored on its ratio, not its match.
DESIGN.md `## Never` item 8 records the same decision as standing policy.
VERDICT: **PASS**

### DW-3.13c
PREMISE: The three mocks are re-expressed against the DESIGN.md tokens with **zero raw
hex**, and `fidelity.py` still exits 0.
EVIDENCE: `grep -oiE '#[0-9a-f]{3,8}\b'` returns **zero matches** in all three of
`v2-fleet.html`, `v3-assistant.html`, `v4-transcript.html`. All colour flows from
`./tokens.css` via `var()`, `color-mix(in oklab, …)` and `oklch(from …)`. `fidelity.py`
exits 0 on the retokenized build (above).
VERDICT: **PASS**

### DW-3.14
PREMISE: The primary action is not flat — it carries a top-highlight gradient — and the
border scale stays **graded** (three distinct values) rather than flattened to one.
EVIDENCE: Rendered `.cta` ("Start session", 189×36, r8px, weight 500):
`background-image: linear-gradient(oklch(0.375347 …), oklch(0.288347 …))` — **L 0.375 at
top → 0.288 at bottom**, i.e. lighter on top, a true top-highlight, plus
`box-shadow: inset 0 -1px 0 oklch(0.255347 …)` grounding the bottom edge. Not flat.
**Border scale, three distinct resolved values:** `--border-hairline`
`oklab(0.946851 …)`, `--border-divider` `oklab(0.937497 …)`, `--border-control`
`rgb(230,232,236)` — all three in live use in v2 (56 / 32 / 40 rendered edges
respectively). The `--border-subtle` / `--border` / `--border-strong` ramp tier resolves
to a further three distinct values. Graded, not flattened.
VERDICT: **PASS**

**All requirements met:** NO — DW-3.3 is PARTIAL (one pill at 4.47:1). All other
14 items PASS.

---

## Notes (non-blocking)

- Assessment B firing 18 `nested-cards` rather than the warned ~77 suggests the container
  structure was already tightened; all 18 verify false and none is the banned form.
- Geometry that the fidelity script does **not** cover, measured on the rendered page and
  matching the reference exactly: **assistant panel 380×899 at x=1036, y=40** (right inset
  1440−1416 = **24**, top inset **40**); **assistant scrim alpha 0.06**, hue-shifted rather
  than pure black; **stat well 7px inset, r7px**; **stat icon tile 24×24, r5.5px, white
  `rgb(252,253,253)`, with a two-part drop shadow**; **table row mark 17×17, r4.6px,
  gradient fill, glyph at 0.62 opacity**. All exact.
- The `hue=263` pin reads as violet but resolves blue in this generator. The prompt's edge
  case asked for verification rather than assumption — verified: `#4466AC`.
- Findings 1, 2 and 5 share one root cause (an unconstrained line box meeting a fixed
  container height). One fix pass should clear all three.

---

## Issues (FAIL blockers)

1. **All four KPI values are clipped, and unreadable on mobile.** `.stat .v` —
   `clientHeight 24px` vs `scrollHeight 38px` desktop (14px cut); `16px` vs `38px` at
   390px (22px cut). Both schemes, v2 and v3.
   Severity **Critical** / Pillar usability + data-viz / Principle: Nielsen #1 visibility
   of system status, Tufte data-ink / Fix: unconstrain the value line box and re-verify
   `scrollHeight === clientHeight` at 390px and 1440px.
2. **Body leading renders 1.45 against a locked 1.4 and a 1.2–1.4 spec** — measured on
   101 of 111 text-bearing elements (`21.025px / 14.5px`). DESIGN.md's `## Type` claim
   that this was "corrected" is false against the rendered artifact.
   Severity **Critical** / Pillar visual / Principle: chapter-03 typography; design-dna
   governance drift / Fix: set the `body` shorthand to `/1.4` and re-render.
3. **Nav count pill measures 4.47:1 in light** (v3, active nav row) against a stated AA
   floor of 4.5:1.
   Severity **Major** / Pillar visual (colour) / Principle: WCAG 2.2 §1.4.3 / Fix: darken
   the ink one ramp step or make the pill tint opaque.

---

**Verdict: FAIL** — blockers 1 and 2 above (Critical), with blocker 3 (Major) to clear in
the same pass.

The identity work underneath is strong and I want to be clear about that: the token
system, the contrast discipline, the reference-exact geometry, the accent derivation and
the distinctiveness criterion all hold up under independent measurement, and 14 of 15 DW
items pass outright. The gate fails on a rendering defect that the DW list happens not to
cover — the product's four headline numbers are cut in half on desktop and unreadable on
the phone the operator is supposed to approve permissions from. That is worth one more
pass before the identity locks for the whole product.
