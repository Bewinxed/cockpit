# Design Review: Phase 3 — Cockpit / FlowAI overhaul (review 5)

## Rendered Evidence (Step 0)
- Screenshots read: `mocks/v2-fleet.png`, `mocks/v2-mobile.png`, `mocks/v3-assistant.png`, `mocks/v4-transcript.png`
- Live measurement: all three mocks rendered in headless Chromium 151 (`playwright-core@1.62.1`, dSF 2, 1440×1100), light and `.dark`, plus a keyboard tab-order walk
- Suite re-run independently: `bash mocks/verify.sh` → **ALL PHASE 3 CHECKS PASS**, exit 0
- Surface: fleet board, assistant panel, session transcript + permission gate; high fidelity

## Assessment B — Deterministic Detector
- Command: `node …/design-for-ai/4.2.0/scripts/detect.mjs mocks/v2-fleet.html mocks/v3-assistant.html mocks/v4-transcript.html > /tmp/detect-p3e.json`
- Exit: **0** (ran), stderr 0 bytes
- Findings: **18, all `nested-cards` (high)**. Zero hits on the other 15 rules — no purple-triplet, no generic-font, no uniform-shadow, no shadcn-defaults.
- Opened only after Assessment A findings were frozen: **YES**

Container-level verification of all 18 (required by the prompt's edge case): every hit is a **control**, not a card — `.ghost` (button), `.icobtn`, `.search` (field), `.sel` ×3 (select), `.ghost.exp` (Export CSV), `.a-orb` (circular orb). None is a card-in-card at the same padding and radius. The detector did **not** hit the actual `.stat` → `.well` pair, which is the permitted inset-well signature. All 18 resolve to **Notes** under the DW-3.9 carve-out.

## Triage
- Baseline (always-on): **visual** (`design-dna`, `checklists`, `ai-tells` CHECKER) + **usability**
- Dispatched: **content-design** (real product copy: permission-gate explanation, empty-state greeting, chip labels) · **behavioral / deceptive-patterns** (the permission gate is a consent surface with a permission-widening control) · **data-viz** (four KPI stat tiles encoding numbers)
- Not applicable: `journey` (no multi-page route rendered in these three mocks)
- Deferred: none

**Distinctiveness (ai-tells CHECKER):** nameable in three words — *recessed ledger graphite*. At least one choice a generic system would not make: the card that **contains a hole** (7px inset well, `--surface-field` inside `--surface-raised`, r7 inside r10) paired with a hue budget where 2.27% of the surface carries any hue and the only non-status accent is graphite, not a colour. Measured radii 10/4.6/5.5/7/8/14/999 and spacing 4/7/11/14/18/21/25/32 are neither shadcn's ladder nor a 4px multiple. **Passes — not generic.**

## Cross-Pillar Findings (ONE ranked report)

| Severity | Pillar | Problem (in the rendered pixels) | Principle | Fix |
|---|---|---|---|---|
| **Critical** | usability | **The fleet board is keyboard-inert.** A tab-order walk of `v2-fleet.html` yields **three stops, total**: `BUTTON:View usage`, `BUTTON:Start session`, `BUTTON:Toggle dark theme`, then `<body>`. Measured 27 `cursor:pointer` affordances vs **4** focusable elements; 24 are bare `<span>` with no `role`, no `tabindex`: 23 row actions (8× Open, 8× Peek, 7× Pause/Resume) plus the `.mut` dash. Nav (`.nav-i`), running-session list (`.run-i`), pagination (`.pg i`), filters (`.sel`), Export CSV, favourites (`.star`) and **Ask AI** are not focusable either. The stylesheet ships `:where(a, button, input, textarea, select, .nav-i, .run-i, .act span, .ghost, .icobtn, .sel, .pg i, .chip, .star):focus-visible { outline: 2px solid var(--accent-solid); outline-offset: 2px }` — a rule that names those selectors and **can never match**, because none of them can receive focus. A keyboard or switch operator cannot open, peek, pause or resume any session, cannot navigate, cannot page the table, cannot summon the assistant. | **WCAG 2.1.1 Keyboard (Level A)**, 2.4.3 Focus Order, 4.1.2 Name/Role/Value; Nielsen #7 Flexibility and efficiency of use | Promote `.act span`, `.nav-i`, `.run-i`, `.pg i`, `.sel`, `.star`, Ask AI and the search field to real `<button>` / `<a href>` / `<input>`. The `:focus-visible` rule then works unchanged. Add a tab-order assertion to `axischeck.mjs` — **keyboard is the axis the 47 assertions hold constant.** |
| **Critical (doc)** | visual / content | **DESIGN.md misdescribes the render on the same axis.** `## Interaction states` states: *"Focus-visible — a 2px `--accent-solid` ring at 2px offset, on **every** interactive affordance — measured `2px solid rgb(68,102,172)`. …a keyboard-accessibility requirement rather than polish."* Measured: that outline is real on the 3 focusable buttons and **unreachable on the other 24 affordances**. This is the identical failure shape the build already declared unacceptable twice — the 1.45 leading claimed as corrected, and `--surface-hover`/`--surface-active` "contrast-verified but painted nothing" — and unlike those it has **no gate behind it**. | Nielsen #1 Visibility of system status; the project's own rule that *"a locked document that misdescribes the render is worse than the render bug"* (DESIGN.md §Type) | Fix the render (above), then the sentence becomes true. Gate it: assert `focusableCount == pointerCount` per mock. |
| Major | data-viz / visual | **One glyph, four meanings.** The same atom SVG (`<circle r=3.1>` + two rotated ellipses) paints all **four** KPI stat tiles — Sessions, Needs you, Machines, **Spend today** — and all 12 row/sidebar marks (16 instances in `v2-fleet.html`, byte-identical markup). An icon that is constant across four different quantities encodes zero information; a dollar figure carrying an atom is actively wrong. It also contradicts DESIGN.md `## Never` #2, which justifies the graphite mark on the grounds that *"item identity is carried by the label and the glyph"* — the glyph carries none. The nav icons, by contrast, are correctly differentiated (grid/wrench/rules/bars/folder). | Tufte, data-ink ratio — non-data ink that repeats carries no information; Nielsen #4 Consistency and standards (one symbol, four referents) | Either give each stat tile a glyph that means its metric (or drop the tile and let the label carry it), and give the row mark a per-harness or per-state glyph — or delete the decorative repetition. |
| Major | usability / a11y | **65 of 65 `<svg>` in `v2-fleet.html` and 8 of 8 in `v4-transcript.html` carry neither `aria-hidden="true"` nor an accessible name.** Decorative marks and status glyphs are both announced as unnamed graphics. The `.mut` dash is correctly handled (`aria-label="no action available"`), which shows the pattern is understood but not applied. | WCAG 1.1.1 Non-text Content; Nielsen #4 | `aria-hidden="true"` on every decorative glyph; the status chips already carry their word, so nothing else needs a name. |
| Major | behavioral / deceptive-patterns | On the permission gate, **"Always allow `rm -rf` in ~/cockpit"** — the widest-blast-radius control on the surface (permanent, every session, every machine) — is the **lowest-weight** control: 207×28, `--surface-raised`, `box-shadow: none`, weight 450, against Approve/Deny at 132×32 weight 500. It is tab stop **6**, immediately after Deny. The quiet weighting is defensible as non-nudging, but a fast operator tabbing past Deny lands on a permanent grant with only 11.5px explanatory ink beneath it. | Deceptive-patterns / consent-surface check: a control whose consequence exceeds the primary action's must not be cheaper to trigger than it | Move it out of the primary tab run (below the fold of the gate, or behind a disclosure), or require a second confirmation. Do **not** raise its visual weight — that would nudge. |
| Minor | visual | The assistant panel renders `border-radius: 16px` while `--radius-panel` is defined as **14px** and DESIGN.md §Space, shape, depth lists "panel 14". The token names this surface and is not applied to it. Measured `.asst` box 380×899 at x1036/y40 (inset 24/40 ✓), `.asst-scrim` `oklch(…/0.06)` ✓. | Nielsen #4 Consistency; token-contract integrity | Set the panel to `var(--radius-panel)`, or correct the token to 16 and update DESIGN.md. |
| Minor | usability | The "Search sessions…" field is **not an `<input>`** — the only `<input>` in `v2-fleet.html` is the theme-toggle checkbox. The field is a picture of a field. Same for "Ask AI". Acceptable in a static mock, but it is why the tab walk finds nothing, and it will be copied into Phase 4 if not called out. | Nielsen #6 Recognition rather than recall (an affordance that looks operable must be) | Use real form elements in the mocks. |
| Minor | content-design | The assistant panel opens with ~700px of empty grid above a bottom-anchored "Hey there!" greeting. The orb floats in dead centre with nothing tying it to the copy. On a 899px panel that is the majority of the surface doing no work. | Composition — negative space should be structural, not residual | Anchor the empty state as one group (orb + greeting + prompts) at optical centre, or let the greeting rise to meet the orb. |
| Note | visual | DESIGN.md §Expressive moments row 3 — *"The fleet has never connected"*, described as *"the largest amplitude in the product"* — **renders in no mock**. The claim is unverifiable from the artifact. | Evidence standard: a stated expressive moment with no render | Render the empty state in Phase 4, or mark the row as unbuilt. |
| Note | detector | 18× `nested-cards` (high) — e.g. `"<div class=\"sel\"> is a card inside a card ancestor"`, `"<div class=\"a-orb\"> is a card inside a card ancestor"`. Container-verified: all 18 are controls (button, icon button, field, select, orb), none is card-in-card at matching padding + radius, and the permitted `.stat`→`.well` pair was **not** hit. Register-justified false positives under the prompt's stated carve-out. | ai-tells `nested-cards` — banned in the uniform-padding form only | No action. |
| Note | tooling | `python3 mocks/fidelity.py` with no arguments dies with an `IndexError` traceback instead of a usage message. It exits 0 under the documented invocation (`mocks/ref/crop-table-1x.png mocks/v2-fleet.png`). | Defensive CLI | Print usage on missing args. |

### On the axes `axischeck.mjs` declines to enforce

- **RTL not enforced** — the argument (English-only, no localisation scoped, JOURNEY.md carries no i18n) is **sound**, and it is measured and reported rather than silently dropped. Accept.
- **Print out of scope** — sound for a live console. Accept.
- **Browser zoom reduces to the width axis** — **correct**: page zoom scales the CSS pixel, so media queries fire at the same effective widths already gated at 320/390/768/1024/1440. Accept.
- **OS scrollbar width dominated by the 320 case** — **correct**: a 17px classic scrollbar at 1440 leaves more room than the enforced 320 case. Accept.
- **The hole the enumeration does not name: focus order / keyboard operability.** The header enumerates scheme × width × pointer × text-scale × content × forced-colors × motion × font-loading. Every one of those is a *rendering* axis measured with a static DOM read. None presses Tab. `forced-colors` is the closest neighbour and passes precisely because it also never asks whether a control can be reached. That is where the Critical lives, and it is not in the "named as uncovered" list either — it is simply absent.
- A second, smaller hole: **`prefers-contrast: more`** is neither enforced nor named as uncovered.

## Requirement Fulfillment

### DW-3.1
PREMISE: *(smoke check)* `palette.mjs` exits 0 with no FAIL lines.
EVIDENCE: Documented invocation `--seed 263 --chroma muted --harmony analogous --scheme both` → `exit=0`, `FAIL lines=0`, stderr 0 bytes. The DW-as-written form `--scheme both` → `exit=1`, `palette.mjs: missing --seed (hue 0-360 or #hex)` — a wording defect in the DW text, not the build; scored against the documented invocation as instructed.
VERDICT: **PASS**

### DW-3.2
PREMISE: `--neutral-1`…`-12` and `--accent-1`…`-12` in both schemes; all 13 semantic aliases resolve; functional `--error/success/warning/info-3/9/11` defined.
EVIDENCE: Read from the live DOM. Light: neutrals `#fcfdfd`…`#2c2e31` (12), accents `#fcfdff`…`#232e43` (12). All 13 aliases resolve to literals — `--background #fcfdfd · --surface #f8f9fa · --surface-hover #eff0f3 · --surface-active #e6e8ec · --border-subtle #cfd2d9 · --border #bfc4cc · --border-strong #a6abb4 · --text #2c2e31 · --text-secondary #60636a · --accent-bg-subtle #e9f1ff · --accent-solid #4466ac · --accent-solid-hover #365596 · --accent-text #4e638c`. All 12 functional steps present (`--error-3 #ffebe9 … --info-11 #4c677a`). Dark re-read under `.dark`: `--neutral-1 #121313`. Suite DW-3.2 PASS.
VERDICT: **PASS**

### DW-3.3
PREMISE: Pairs `palette.mjs` does not verify, measured independently in both schemes… every status pill measured from painted pixels, including under a translucent scrim; verify the interaction-state tokens now actually paint.
EVIDENCE: `mocks/colorcheck.py` table reproduced in DESIGN.md and re-run by the suite — worst light pair `text-secondary` on `surface-active` **4.90:1**, worst dark **7.15:1**; `accent-solid` on `background` 5.51 light / 3.32 dark (≥3:1 non-text). Painted-pixel pass re-run in this review: *"every painted chip and pill clears 4.5:1 in both schemes"*, worst reported **4.84:1**, scrim composited (`v3` pill `rgb(228,221,204)` vs `v2` `rgb(240,232,214)`). Interaction states now paint — measured `.nav-i` rest `transparent` → hover `rgb(239,240,243)` = `--surface-hover` → active `rgb(230,232,236)` = `--surface-active`; `Deny` renders `background rgb(239,240,243)` with `inset 0 1px 1px` from `--shadow-inset-sel`. Tokens are no longer inert.
VERDICT: **PASS**

### DW-3.4
PREMISE: The dark ramp activates under the project's `.dark` class variant — verified by rendering.
EVIDENCE: Rendered `v2-fleet.html`, added `.dark` to `<html>`: `--neutral-1` moved `#fcfdfd → #121313`, `body` background `rgb(25,25,26)`, body ink `rgb(230,232,236)`. `build-tokens.mjs` rewrites the generator's `[data-theme="dark"]` to `[data-theme="dark"], .dark`. `v2-dark.png` / `v3-dark.png` render dark.
VERDICT: **PASS**

### DW-3.5
PREMISE: Type scale `--text-xs`…`--text-4xl` with `--font-body` and `--font-display`; `## Type` states ratio, base px, steps, leading, weights — and those statements must match what renders.
EVIDENCE: All nine steps resolve (`0.640625rem`…`1.640625rem` = 10.25…26.25px at a 16px root). `--font-body` = `--font-display` = `'Geist Variable', ui-sans-serif, …`. `## Type` states ratio **1.125**, base **13px**, leading body 1.4 / display 1.2 / UI 1.25 / numeric 1, weights 400/450/500 never 600. Rendered leaf-element census on `v2-fleet.html`: sizes `{13:90, 11.5:8, 23.5:3, 14.5:2, 18.5:1}` — every one a named step; weights `{400:79, 450:4, 500:23}` — nothing ≥ 600; leading ratios `{1.400:94, 1.000:7, 1.250:3}` — all inside 1.2–1.4 or the declared numeric 1. The two 16px / `line-height:normal` leaves are `P.sr` visually-hidden text, explicitly skipped by the suite with the reason printed. Suite: *"weights in 400/450/500, sizes on the nine steps, no unspecified line box"* PASS.
VERDICT: **PASS**

### DW-3.6
PREMISE: Primary face is none of Inter / Roboto / Open Sans / Arial / Space Grotesk, installs from `@fontsource-variable/*`, with a justification tying letterform to the comps.
EVIDENCE: `--font-body` = `'Geist Variable'` — none of the five. `@fontsource-variable/geist@5.3.0` and `@fontsource-variable/geist-mono`, both OFL-1.1, registry-verified. Justification is measured off the shipped `.woff2`: x-height 0.530em against cap 0.710em, unitsPerEm 1000, continuous `wght` 100–900 — tied to the comps by the 13px base giving a 6.9px x-height that keeps a 44px-pitch row legible without reaching for weight, which the ~45% rasterizer-heavy offset forbids. The continuous axis is what makes 400/450/500 possible.
VERDICT: **PASS**

### DW-3.7
PREMISE: Accent contains none of `#6366F1`, `#8B5CF6`, `#A855F7`; palette is neither cyan-on-dark nor purple-to-blue.
EVIDENCE: `--accent-solid` reads `#4466ac` in both schemes. Zero occurrences of any banned literal in `tokens.css` or the three mocks (grep count 0/0/0/0); the two hits in DESIGN.md are the banned values quoted inside the CIEDE2000 distance table. CIEDE2000 from `#4466ac`: 11.2 / 17.4 / 22.4. Not cyan-on-dark (dark ground is `#121313` graphite, accent is a mid-dark blue used as a solid on light). Exactly one gradient exists system-wide (`--gradient-action`) and both stops are graphite — measured `linear-gradient(oklch(0.375 0.006 258), oklch(0.288 0.006 258))`. Detector fired **zero** purple-triplet hits.
VERDICT: **PASS**

### DW-3.8
PREMISE: DESIGN.md carries all 10 template sections, `**Status:** confirmed`, and a `**Pins:**` line.
EVIDENCE: 10 `##` sections at lines 11/28/65/76/147/654/674/695/719/782 — Direction, Signature move, Expressive moments, Type, Color tokens, Interaction states, Space shape depth, Motion, Never, Open questions. Line 2 `**Status:** confirmed`; line 7 `**Pins:** family=… discipline=… hue=263 chroma=muted signature=…`.
VERDICT: **PASS**

### DW-3.9
PREMISE: `## Never` names the uniform-padding form of `nested-cards` plus ≥2 further tells scoped to this DNA, and explicitly permits the comps' inset-well surface.
EVIDENCE: Item 1 is *"Nested cards in the uniform-padding form… same padding and the same radius, producing containment noise with no change in meaning"*, followed by *"**Explicitly permitted, and required:** the comps' inset-well surface — a raised card containing a recessed panel at a different inset (7px), a different fill… and a different radius (7 inside 10)"*, plus the instruction that a raw `detect.mjs` count is not a finding without container-level verification. Nine further DNA-scoped tells follow (decorative hue, red as ambient, shadcn defaults, weight >500, pure-black shadow, uniform spacing, scroll container for consent content, clipping ancestor, matching a comp defect).
VERDICT: **PASS**

### DW-3.10
PREMISE: Shipped `--radius`, spacing, and shadow values differ from shadcn's defaults; no shadow uses pure black.
EVIDENCE: Radii read live: `--radius 10px · mark 4.6 · tile 5.5 · well 7 · control 8 · card 10 · panel 14 · pill 999` — vs shadcn's 4/6/8/12; differs in five of six members and in cardinality. Spacing 4/7/11/14/18/21/25/32 — not a 4px ladder. Every shadow measured on the page tints from `--neutral-12` via `oklch(…)`: e.g. `.stat` `oklch(0.300347 0.00609613 258.468 / 0.055) 0 1px 2px`, `.chip` tile `…/0.1 0 1px 2.5px, …/0.055 0 0 0 0.5px`, `.asst` `…/0.16 0 18px 48px, …/0.055 0 2px 6px`. Five distinct depths; **no `rgba(0,0,0,·)` anywhere**. Detector fired zero shadcn-default and zero uniform-shadow hits.
VERDICT: **PASS**

### DW-3.12
PREMISE: Status chips use only the four functional hues; any non-status accent is visibly distinct from all four. Status stays legible with hue removed. Saturated colour only on chips, badges, small marks.
EVIDENCE: Chips measured: `working` fill `oklab(0.922 -0.012 -0.021)` (info), `needs you` `oklab(0.932 0.002 0.025)` (warning), `error` `oklab(0.910 0.032 0.015)` (error), `idle`/`paused` `rgba(0,0,0,0)` — no fill, per the documented CIEDE2000 6.7 finding. Four hues, no fifth. Hue-removed test: **every chip carries both a word and its own `<svg>` glyph** (`hasGlyph: true` on all measured chips — filled dot / up-chevron / cross / pause bars), so the five states survive greyscale on glyph + word alone. Non-status accent is `--brand-solid = --neutral-12` graphite, CIEDE2000 22.3–61.6 from every functional hue. Saturated colour appears only in chips and the `Needs you` tile; the field, chrome and content region are achromatic (2.27% of surface carries hue, largest hued region 0.12%).
VERDICT: **PASS**

### DW-3.13
PREMISE: `mocks/fidelity.py` exits 0. Proxies are not box geometry — never reconcile `stat_run_w` 264 / `stat_run_gap` 30 against the measured-reference table.
EVIDENCE: `python3 mocks/fidelity.py mocks/ref/crop-table-1x.png mocks/v2-fleet.png` → suite reports PASS, exit 0, report in `mocks/gate-report.txt`. Independent DOM read confirms the box geometry is the reference's, not the proxy's: `.stat` measures **281×90** (spec 280×90) with `padding: 7px` and a single `.well` child at **267×76, radius 7px** (spec: 7px inset, r7); the CSS `gap` is 14. The 264/30 painted-run readings are the detector measuring white runs across a recessed well and are not reconciled here.
VERDICT: **PASS**

### DW-3.13b
PREMISE: AA beats fidelity where the comp is wrong — the reference's `#838383` on `#F1F1F1` is 3.36:1; such inks are judged on their own AA ratio and reported as accepted deviations.
EVIDENCE: `## Never` #10 records the comp defect at 3.36:1 and this build's header label at **5.24:1**, with the rule that future conflicts go in `fidelity.py`'s `AA_OVERRIDE` with the measurement. Suite line: *"fidelity.py exits 0 with the AA override reported as an accepted deviation"* PASS.
VERDICT: **PASS**

### DW-3.13c
PREMISE: The three mocks carry zero raw hex and `fidelity.py` still exits 0.
EVIDENCE: `mocks/literalcheck.py` (rejects hex, `rgb()`, `hsl()`, `lab/lch/oklab/oklch()`, `color()`, `color-mix()` and named keywords unless the expression references a token) runs green in the suite; `literal-report.txt` present. Corroborated by the DOM read — every painted colour resolves through a token, including the previously-raw `rgba(255,255,255,.82)` now written `oklch(from var(--surface-raised) l c h / 0.82)`. `fidelity.py` exit 0 in the same run.
VERDICT: **PASS**

### DW-3.14
PREMISE: The primary action is not flat — top-highlight gradient — and the border scale stays graded (three distinct values).
EVIDENCE: `Start session` measured 189×36, `background-image: linear-gradient(oklch(0.375347 0.00609613 258.468), oklch(0.288347 0.00609613 258.468))` — lighter stop on top — plus `box-shadow: oklch(0.255…) 0 -1px 0 inset, oklch(0.300…/0.1) 0 1px 2px`. `Approve` carries the identical treatment at 132×32. The 17×17 `.mark` carries the same read at a twelfth of the size: `radius 4.6px`, `background rgb(44,46,49)` with `linear-gradient(oklch(0.993… / 0.22), oklch(0.300… / 0.06))` — top-light / bottom-shade. Painted border census on the live page returns **three distinct 1px colours**: `oklab(0.937497 …)` ×56, `rgb(230,232,236)` ×40, `oklab(0.946851 …)` ×32 — hairline / divider / control, graded, not flattened.
VERDICT: **PASS**

**All requirements met:** **YES** — 14/14 DW items PASS on measured evidence.

## Notes (non-blocking)
- The 18 detector `nested-cards` hits are container-verified false positives (all controls; the permitted `.stat`→`.well` pair was not hit). No action.
- `v4-transcript.html` — the safety-critical surface — is **already correct** on the axis that fails elsewhere: tab order runs `Start time → Session id → Machine, then time → Approve → Deny → Always allow → textarea → Stop the agent`, zero non-focusable pointer affordances. The Critical is confined to the `v2`/`v3` board chrome, which makes the fix small and local.
- `Approve` and `Deny` measure byte-peer at **132×32** each, weight 500, opposite in kind (raised graphite gradient vs recessed `--surface-hover` + inset shadow) — the destructive-action peer-sizing invariant holds at 1440 as documented.
- `prefers-contrast: more` is neither enforced nor listed among the named-uncovered axes in `axischeck.mjs`.
- The reference geometry I could re-measure all matches: sidebar **228**, stat card **281×90 r10**, well **267×76 r7** at 7px inset, mark **17×17 r4.6**, tile **24×24 r5.5** white + `--shadow-tile`, assistant panel **380×899** at inset 24/40, scrim `oklch(…/0.06)`.

## Issues (FAIL)
1. **The fleet board cannot be operated from a keyboard** — Critical / usability / WCAG 2.1.1 Keyboard (Level A), 2.4.3, 4.1.2 · Tab walk yields 3 stops against 27 `cursor:pointer` affordances; 23 row actions and all nav, pagination, filter, favourite and Ask AI controls are non-focusable `<span>`s. Fix: promote them to real `<button>`/`<a href>`; the existing `:focus-visible` rule then applies unchanged.
2. **DESIGN.md asserts a focus ring "on every interactive affordance"** that 24 of 27 affordances can never receive — Critical / doc-vs-render · the same failure shape the build twice declared unacceptable, with no gate behind it. Fix: land (1), then add a `focusableCount == pointerCount` assertion and a tab-order axis to `mocks/axischeck.mjs`.

**Verdict: FAIL — blockers: (1) keyboard-unreachable primary controls on the fleet board; (2) the DESIGN.md focus-visible claim contradicted by the render.**

All 14 done-when items pass on measured evidence and the visual identity is sound and distinctive — this is not a re-opening of the identity. The blocker is a single, provable, local defect on the one axis the 47-assertion suite holds constant: it renders every axis but never presses Tab. Both blockers are fixed by the same change.
