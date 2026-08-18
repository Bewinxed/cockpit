# Design Review: Phase 3 — Cockpit / FlowAI overhaul (review 4)

## Rendered Evidence (Step 0)
- Screenshots read: `mocks/v2-fleet.png`, `mocks/v2-dark.png`, `mocks/v2-mobile.png`, `mocks/v3-assistant.png`
- Re-rendered and measured independently via `playwright-core` + Chromium 150 (headless, `--force-color-profile=srgb`):
  3 pages × 2 schemes × widths {1440, 1024, 390, 320, 195} × pointer {fine, coarse}
- Captures produced by this review: `/tmp/rev4/perm-320.png`, `/tmp/rev4/perm-390.png`, `/tmp/rev4/hitl-320.png`
- Surface: `v2-fleet.html` (fleet board), `v3-assistant.html` (assistant panel), `v4-transcript.html` (session transcript + permission gate). High fidelity.

## Assessment B — Deterministic Detector
- Command: `node /home/bewinxed/.claude/plugins/cache/rtd/design-for-ai/4.2.0/scripts/detect.mjs mocks/v2-fleet.html mocks/v3-assistant.html mocks/v4-transcript.html > /tmp/detect-p3d.json`
- Exit: **0 (ran)**, `"status": "ran"`, stderr empty
- Findings: **18, all one rule — `nested-cards` (high)**. No other rule fired: no `purple-triplet`, no `shadcn-default`, no `cyan-on-dark`, no gradient/AI-tell hit.
- Opened only after Assessment A findings were frozen: **YES**

**Container-level verification (required by the edge cases and by DESIGN.md `## Never` #1):** all 18 hits resolve to false positives. Every flagged node is a 32px-tall *control* on `--radius-control`, not a card with uniform padding inside a card — `.ghost`, `.icobtn`, `.search`, `.sel`, `.ghost.exp` (toolbar controls inside `.bar`), `.a-orb`, `.a-composer`, `.a-send`, `.stop` (controls inside the assistant panel). The one genuine card-inside-card in this system — the stat card containing the recessed well — the detector did *not* flag, and it is the explicitly permitted inset-well form, verified by measurement: `.stat` r10 / padding 7px / `--surface-raised` containing `.well` r7 / `--surface-field`. Different inset, different fill, different radius. Register-justified → **Notes, not FAIL**.

## Triage
- **Baseline (always-on):** visual (`design-dna`, `checklists`, `ai-tells` CHECKER) + usability
- **Dispatched:** `color` (a full generated ramp in two schemes, status hues, a scrim); `fonts` (a locked type ladder DW-3.5 says failed twice before); `journey` (a page-to-page sequence: board → transcript → permission gate); `content-design` (real product copy — the permission scope statement, chip labels, empty/assistant states)
- **Not applicable:** `data-viz` (no chart, graph, or numeric encoding beyond four KPI figures — the design explicitly bans charts); `behavioral`/`deceptive-patterns` (no pricing, signup, or conversion surface — though the Approve/Deny asymmetry question is handled below under usability)
- **Deferred:** none

---

## Cross-Pillar Findings (ONE ranked report)

| # | Severity | Pillar | Problem (in the rendered pixels) | Principle | Fix |
|---|----------|--------|----------------------------------|-----------|-----|
| 1 | **Critical** | usability / journey | On `v4-transcript` at **320** and **390** CSS px, the permission gate's `.scope` values run off the right edge with **no ellipsis and no truncation cue**. Measured at 320: every `<dd>` has `right = 410.5` against a `320` viewport — **90.5px off-screen**; `.hitl` scrollWidth 394 vs clientWidth 286 (**108px lost**), `.scope` 380 vs 258 (**122px lost**). At 390: `.hitl` loses 38px, `.scope` 52px. The lost text is exactly what justifies the grant — **Path** renders as `/home/bewinxed/cockpit/apps/dashboard/.svel` ⏎ `kit` (the `.svelte-` segment is off-screen, so the operator reads a path that is not the real path), **Machine** as `nixbox — mba-m3 and hetzner-01 are not a…`, **Undo** and **Future** likewise cut. `Approve` renders fully legible at 125×44 directly beneath. Reachable only by horizontally scrolling `.tr` (`overflow-x:auto`, scrollWidth 411/414 vs clientWidth 390/320) — and the page-level gate reports clean (`docScrollW == docClientW == 320`) precisely because the overflow lives *inside* that scroll container. | WCAG 1.4.10 Reflow (AA) — content requiring two-dimensional scrolling at 320px; Nielsen #5 error prevention; **DESIGN.md `## Never` #8 verbatim** — "Mobile surfaces **wrap**; they do not hide", and the file's own comment already names this exact gate blind spot for `.tscroll` | Make `.hitl`/`.scope` wrap: `dl.scope{grid-template-columns:1fr}` under the mobile query, or `dd{overflow-wrap:anywhere;min-width:0}` and drop the fixed `dd` width. Then extend the overflow gate to assert `scrollWidth <= clientWidth` on **every descendant of a scroll container**, not just on `documentElement`. |
| 2 | Major | usability | **Target size.** `.act span` action controls measure `▶` **10×18.2**, `▮▮` **14×18.2**, `Peek` **30×18.2** at 1440 with a fine pointer *and unchanged at 1024 with `pointer:coarse` matching*. At 390 the height rises to 44 but the **width stays 10–14px**. `.star` favourite toggle is **13×17.1 at every width and both pointer types**. Root cause: `@media (pointer:coarse)` raises only `.nav-i,.run-i,.icobtn,.ghost`; `.act span{min-height:44px}` sits in the *width* query, and nothing ever sets a min-width. | WCAG 2.5.8 Target Size (Minimum, AA) = 24×24 CSS px; Fitts's law (1954) | Move `.act span` and `.star` into the `pointer:coarse` block and give both `min-width:44px` (or `min-inline-size`). A 10px-wide pause control on a running agent is the smallest target in the product. |
| 3 | Major | usability / visual | **No hover, active, or focus state exists on `v2-fleet` or `v3-assistant`.** Grep across both files: `:hover` 0, `:active` 0, `:focus-visible` 0, `outline` 0. `--surface-hover` and `--surface-active` are defined in `tokens.css` (lines 64–65 light, 126–127 dark) and are DW-3.3-measured pairs, yet appear **zero times in all three mocks** — a token passed a contrast gate while never painting a pixel. On the fleet board, 24 clickable action spans and 12 nav rows offer `cursor:pointer` as their entire affordance. (`v4-transcript` correctly ships `.choice button:focus-visible{outline:2px solid var(--accent-solid);outline-offset:2px}` — the pattern exists, it just is not applied anywhere else.) | Nielsen #1 visibility of system status; WCAG 2.4.7 Focus Visible | Apply `--surface-hover`/`--surface-active` to `tbody tr`, `.nav-i`, `.run-i`, `.act span`, `.pg i`; lift the existing `:focus-visible` ring from `.choice button` to a global rule. |
| 4 | Major | visual | **The row mark paints two different radii on one page.** `v2-fleet` renders `mark 17×17 r6px ×4` (sidebar "Running now") alongside `mark 17×17 r4.6px ×8` (table rows); `v3-assistant` adds `.s-i 22×22 r6`; `v4-transcript` is uniformly r4.6. The measured reference specifies row mark 17×17 **r4.6**. The same named component, same size, two radii, same viewport. Not covered by `fidelity.py` — its own report prints `well_inset  None  None  —  (not detected)`, showing how much of the signature move the script leaves unmeasured. | Nielsen #4 consistency and standards; systematic radius ladder (foundations) | Set one `--radius-mark: 4.6px` and use it for `.mark` and `.s-i` on all three surfaces. |
| 5 | Major | content-design | **The Action column's three controls are unlabeled Unicode placeholders.** `<span class="mut">▮▮</span>` (U+25AE ×2), `▶` (U+25B6), `—` (em dash) — no label, no `title`, no accessible name. The em dash on the errored row is undecodable: nothing distinguishes "no action available" from "loading" or "not yet rendered". The page uses real vector icons everywhere else (`.ic svg`, `.crumb svg`, `.ghost svg`, `.icobtn svg`) under a comment that reads *"real vector icons replace the unicode placeholders"* — these three are the placeholders that pass missed. Width-probe evidence that they render from a fallback face, not Geist: `'▮▶◧▤'` measures **41px identically** under `"Geist Variable"`, `serif` and `sans-serif`. | Nielsen #6 recognition rather than recall; ai-tells — placeholder glyph standing in for a designed mark; medium/portability mismatch (ch03) | Replace with the same SVG set used elsewhere; give each an accessible name ("Pause session" / "Resume session" / "Unavailable — session errored"). |
| 6 | Minor | visual / usability | **RTL does not mirror.** With `dir=rtl` the sidebar mirrors correctly (`aside` x 0 → 1212) but the assistant panel stays at **x=1036, w=380** — it is pinned with a physical `right`. 19–26 physical-direction declarations (`margin-left`, `padding-left`, `left:`, `right:`, `text-align:left/right`) across the three files, including the signature `25 left / 21 right` asymmetry (`.shead` padding `0px 21px 0px 25px`), which flips to the wrong side in RTL. **No requirement asked for RTL — recorded as a note, not a blocker.** | Logical properties (better-layout) | Migrate to `padding-inline`, `inset-inline-end`, `text-align: start` when RTL becomes a requirement. |
| 7 | Minor | usability | **200% zoom on a phone** (390 @ 200% = 195 CSS px): `v4-transcript` clips `MAIN` by 16px and five `.arg` spans by 49–133px; `v2-fleet` clips `.panel` by 27px. At 320 the composer placeholder clips mid-word to `"Messag"`, and the free-text answer input's placeholder ("Type an answer…") renders larger than its box and spills below the border. Desktop 200% (720 CSS px) is clean on all three pages. | WCAG 1.4.4 Resize Text | Same wrap fix as #1; shrink the answer input's font at the mobile step. |
| 8 | Minor | visual | `.chip-s` status pills use `border-radius: 999px` — the only fully-round radius in a system otherwise on a 4.6 / 5.5 / 7 / 8 / 10 / 14 / 16 ladder. Defensible as the departure-board pill, but it is an unstated exception to the shape rule. | Systematic shape ladder (foundations) | State the exception in `## Space, shape, depth`, or bring the pill onto the ladder. |
| 9 | Minor | visual | `tokens.css` ships `--violet-3 / -9 / -11 / -on-solid` (`#705ab0`) in both schemes, **consumed by no mock**. A generator artifact sitting immediately adjacent to the banned violet band, one careless reference away from a DW-3.7 breach. | Dead tokens invite drift (design-dna) | Delete the violet ramp, or gate that it is never referenced. |
| 10 | Minor | usability | **Non-semantic markup.** `v2-fleet` ships 3 `<button>` + 1 `<input>` against ~57 interactive affordances; nav items are `<div class="nav-i">`, row actions are `<span>`. Nothing in the fleet board is keyboard-reachable. Acceptable in a visual comp; **it must not carry into the dashboard build**, and these mocks are the component reference. | WCAG 2.1.1 Keyboard | Note it in the handoff so the Svelte implementation uses `<button>`/`<a>`. |

### Recorded as passing (measured, not assumed)
- **All text ink ≥ 4.5:1 in both schemes on all three pages.** The dark composer regression is fixed — `.a-in` / composer measures **7.15:1** in dark against the reported 1.20:1.
- Painted-pixel (DPR 2): `.act .mut` glyph **5.9:1** light / **7.93:1** dark · `.star` **5.9:1** · `needs-you` chip ink **7.43:1** · row mark **11.72:1** light / **12.39:1** dark · `.logo` **13.36:1**.
- Assistant panel **380×899 at x=1036, y=40** → right inset **24**, top inset **40**. `.asst-scrim` alpha **0.0588**, tinted from `--neutral-12`, not pure black.
- Stat card **281×90 r10**, well **7px inset r7**, stat icon tile **24×24 r5.5** white + drop shadow. Sidebar **228**. `.shead` padding **0 21px 0 25px**. Header band **32**. Row pitch **44**.
- **3 distinct border colours** (graded). **0 pure-black shadows** across all three pages, both schemes.
- Approve/Deny peer parity holds at every width: **132×32 / 132×32** desktop, **160×44 / 160×44** at 390, **125×44 / 125×44** at 320. The `flex:1 1 0` fix is real.
- Page-level reflow clean at 320 and 390 (`docScrollW == docClientW`) on all six page × scheme combinations.

---

## Requirement Fulfillment

### DW-3.1
PREMISE: "*(smoke check)* `palette.mjs` exits 0 with no FAIL lines. Certifies almost nothing. NOTE: the DW text says `--scheme both`, which exits 1 with `missing --seed`; score against the project's documented invocation and note the wording defect."
EVIDENCE: Documented invocation from `DESIGN.md ## Color tokens` — `node scripts/palette.mjs --seed 263 --chroma muted --harmony analogous --scheme both` → **exit 0**, `grep -c FAIL` on both stdout and stderr = **0**. The DW's literal `--scheme both` alone → **exit 1**, `palette.mjs: missing --seed (hue 0-360 or #hex)`. Wording defect confirmed as predicted; scored against the documented invocation.
VERDICT: **PASS** (DW wording defect noted)

### DW-3.2
PREMISE: "`--neutral-1`…`--neutral-12` and `--accent-1`…`--accent-12` in both schemes; all 13 semantic aliases resolve; functional colors `--error/success/warning/info-3/9/11` defined."
EVIDENCE: Per-index count inside `:root` and inside `.dark` — all 24 of `neutral-1..12` and `accent-1..12` present exactly once in **each** block. 12 functional declarations × 2 schemes (`error/success/warning/info` × `3/9/11`). Semantic aliases resolve at runtime: `--surface`, `--surface-hover/-active/-field/-raised/-sunken/-overlay`, `--background`, `--text-secondary`, `--accent-solid`, `--brand-solid`, `--on-brand`, `--border` + 4 border grades, `--scrim-soft`, `--ink-*` — read back non-empty from `getComputedStyle(document.documentElement)` in both schemes.
VERDICT: **PASS**

### DW-3.3
PREMISE: "Pairs `palette.mjs` does not verify, measured independently in both schemes: `--error-11`, `--warning-11`, `--success-11`, `--info-11` on `--surface` AND `--surface-hover` ≥ 4.5:1 · `--text-secondary` on `--surface-hover` and `--surface-active` ≥ 4.5:1 · `--accent-solid` on `--background` ≥ 3:1 non-text. Every status pill measured **from painted pixels**, including under a translucent scrim."
EVIDENCE: Measured in-browser, both schemes. Light — error-11 **5.92** / hover **5.48**; warning-11 **5.74** / **5.31**; success-11 **5.53** / **5.12**; info-11 **5.65** / **5.22**. Dark — **8.54/7.74**, **8.79/7.97**, **9.00/8.16**, **8.86/8.03**. `--text-secondary`: hover **5.28** light / **7.93** dark, active **4.90** light / **7.15** dark. `--accent-solid` on `--background`: **5.51** light / **3.32** dark, both ≥ 3. Painted-pixel at DPR 2: `needs-you` chip ink `[78,72,60]` on fill `[240,232,214]` = **7.43:1**. Under the `v3-assistant` translucent scrim (`asst-scrim`, measured alpha **0.0588**) the composited board ink stays ≥ **4.94:1**, lowest element `P` / `SMALL`. Every listed pair clears its threshold in both schemes.
VERDICT: **PASS**

### DW-3.4
PREMISE: "The dark ramp activates under the project's `.dark` class variant — verified by rendering."
EVIDENCE: `tokens.css` declares both `[data-theme="dark"]` **and** `.dark` (lines 77–78, 227–228), so the generator's emitted selector and the project's class variant are both covered. Verified by rendering, not by reading: adding `document.documentElement.classList.add('dark')` flips the whole measured token set — e.g. `--error-11` on `--surface` **5.92 → 8.54**, `.cta` painted fill **[45,47,50] → [225,227,231]**, `.mark` **11.72 → 12.39** — and produces the dark board in `v2-dark.png`.
VERDICT: **PASS**

### DW-3.5
PREMISE: "Type scale `--text-xs`…`--text-4xl` with `--font-body` and `--font-display`; `## Type` states ratio, base px, steps, leading, weights — **and those statements must match what renders.** … Measure computed weights and sizes across the pages and compare to the document."
EVIDENCE: Computed census over every element with a non-empty text node, 3 pages × 2 schemes × 3 widths, excluding `display:none` nodes. **Sizes rendered:** `{13, 14.5, 11.5, 18.5, 23.5, 16.5, 10.25}px` — every one a named step in the `## Type` table; **no 12.5px anywhere**. **Weights rendered:** `{400: 93, 450: 14, 500: 36}` per page — **nothing at 600 or above, no 650**. **Leading rendered:** exactly three ratios, `1.400`, `1.000`, `1.250` — matching the documented body 1.4 / numeric 1 / UI 1.25, and inside the required 1.2–1.4 band. `--text-xs` (10.25) and `--text-4xl` (26.25) both declared; `--font-body` and `--font-display` both resolve. The two prior failure modes are genuinely gone. *(My first census flagged `16px` / `line-height: normal` / `Times New Roman` ×2 per page — traced to `<title>` and `<style>`, both `display:none`, i.e. never rendered. False positive, withdrawn.)*
VERDICT: **PASS**

### DW-3.6
PREMISE: "Primary face is none of Inter / Roboto / Open Sans / Arial / Space Grotesk, installs from `@fontsource-variable/*`, with a justification tying letterform to the comps."
EVIDENCE: Computed `font-family` first token on every rendered text element across all three pages = **`Geist Variable`** (the only other family in the census is the fallback on the two `display:none` nodes). None of the banned five. `DESIGN.md ## Type` names `@fontsource-variable/geist@5.3.0` (OFL-1.1) and `@fontsource-variable/geist-mono`, and carries a measured justification — x-height **0.530 em** against cap height **0.710 em** (unitsPerEm 1000, `fontTools` on the shipped `.woff2`), giving a **6.9px x-height at the 13px base** — tied to keeping the comps' 44px-pitch row legible without reaching for weight the design has already stepped down.
VERDICT: **PASS**

### DW-3.7
PREMISE: "Accent contains none of `#6366F1`, `#8B5CF6`, `#A855F7`; palette is neither cyan-on-dark nor purple-to-blue."
EVIDENCE: Grep for all three literals across `tokens.css` and all three mocks: **zero hits**. Accent ramp is `#fcfdff → #4466ac (accent-9) → #232e43`, seed hue **263°**, chroma muted — a desaturated slate-blue. Light is primary and achromatic (neutrals `#fcfdfd → #2c2e31`), so it is not cyan-on-dark; the accent appears as a single solid fill on the assistant orb, never as a purple→blue gradient — the detector's `purple-triplet` rule did not fire. Edge case discharged by measurement, not assumption.
VERDICT: **PASS** (note: an unused `--violet-9: #705ab0` ramp ships in `tokens.css` — finding #9)

### DW-3.8
PREMISE: "DESIGN.md carries all 10 template sections, `**Status:** confirmed`, and a `**Pins:**` line."
EVIDENCE: `DESIGN.md` carries the header block plus the 9 `##` sections of the `design-dna.md` template in order — Direction, Signature move, Expressive moments, Type, Color tokens, Space/shape/depth, Motion, Never, Open questions (10 with the front-matter block). Line 2: `**Date:** 2026-08-18 · **Status:** confirmed`. Line 8 carries the `**Pins:**` line with five pins (`family`, `discipline`, `hue=263`, `chroma`, `signature`).
VERDICT: **PASS**

### DW-3.9
PREMISE: "`## Never` names the **uniform-padding** form of `nested-cards` plus ≥2 further tells scoped to this DNA, and explicitly **permits** the comps' inset-well surface."
EVIDENCE: `## Never` item 1 names the ban precisely — "A card inside a card where **both carry the same padding and the same radius**" — and explicitly permits the inset well: "**Explicitly permitted, and required:** the comps' **inset-well** surface … 7px inset, `--surface-field` inside `--surface-raised`, radius 7 inside 10", with the container-level-verification caveat for `detect.mjs`. Eight further DNA-scoped tells follow (decorative hue, red as ambient colour, shadcn defaults, weight >500, pure-black shadow, uniform spacing, content trapped behind a non-scrolling ancestor, matching a comp defect). Permitted form verified in the render: `.stat` r10 pad 7px vs `.well` r7 — different inset, fill and radius.
VERDICT: **PASS**

### DW-3.10
PREMISE: "Shipped `--radius`, spacing, and shadow values differ from shadcn's defaults; no shadow uses pure black."
EVIDENCE: Radii measured on the rendered pages are **4.6 / 5.5 / 6 / 7 / 8 / 10 / 14 / 16 / 999** — not shadcn's `0.5rem` 4/6/8/12 ladder. Spacing is the 7/11/14 inner ladder with the 25/21 content asymmetry (`.shead` padding `0px 21px 0px 25px`), not the default scale. Shadows tint from `--neutral-12`, e.g. `.stat` = `oklch(0.300347 0.00609613 258.468 / 0.055) 0 1px 2px`. Programmatic sweep of `box-shadow` on every element, all three pages, both schemes, for `rgba?(0, 0, 0`: **0 hits**. The detector's `shadcn-default` rule did not fire.
VERDICT: **PASS**

### DW-3.12
PREMISE: "Status chips use only the four functional hues; any non-status accent is visibly distinct from all four. Status stays legible **with hue removed**. Saturated colour only on chips, badges, and small marks."
EVIDENCE: Chip fills measured: `s-attn` `[240,232,214]` amber, `s-live` blue, `s-fail` `[248,217,214]` red, `s-idle` untinted — the four functional hues only. The single non-status accent is `--accent-solid` `#4466ac` on the assistant orb, hue 263° against functional 25 / 85 / 145 / 240 — visibly distinct from all four. **Legible with hue removed:** each status carries a distinct glyph as well as a tint — `↑ needs you`, `• working`, `× error`, `‖ idle`, `‖ paused` — and the two untinted states (`idle`, `paused`) carry no pill at all, so state survives greyscale on glyph + pill-presence, not hue. Saturated colour appears only in 22px chips, the 24×24 stat tile and the 17×17 mark; the field, chrome and content region carry none — red never appears as ambient colour on the analytical surface, discharging that edge case.
VERDICT: **PASS**

### DW-3.13
PREMISE: "`mocks/fidelity.py` exits 0. **Proxies are not box geometry** — `stat_run_w` reads 264 where the stat card box is 280, and `stat_run_gap` reads 30 where the CSS gap is 14 … Never reconcile these against the measured-reference table."
EVIDENCE: `python3 mocks/fidelity.py mocks/ref/crop-table-1x.png mocks/v2-fleet.png` → **exit 0**, final line `PASS`. `stat_run_w  264  265  +1  ok`; `stat_run_gap  30  30  +0  ok`. Both treated as painted-white-run proxies and **not** reconciled against the reference table's 280 box / 14 gap — the true box geometry I measured independently is `.stat` **281×90** with CSS `gap` **14**, exactly the documented divergence. Independently confirmed that the script leaves the signature move unmeasured: its own report prints `well_inset  None  None  —  (not detected)`.
VERDICT: **PASS**

### DW-3.13b
PREMISE: "**AA beats fidelity where the comp is wrong** — the reference's `#838383` on `#F1F1F1` is 3.36:1; such inks are judged on their own AA ratio and reported as accepted deviations."
EVIDENCE: Gate report line: `band_label_ink  #838383  #646464  -31L  ok  AA 5.24:1 on #F1F1F1  (ref 3.36:1 — below 4.5, override)`, and a dedicated trailer — `AA overrides — reference is defective here; build judged on AA, not on match: band_label_ink  build 5.24:1 on #F1F1F1  ref 3.36:1  min 4.5  PASS`. The build ships the darker `#646464` and the deviation is reported rather than silently matched.
VERDICT: **PASS**

### DW-3.13c
PREMISE: "The three mocks carry **zero raw hex** and `fidelity.py` still exits 0."
EVIDENCE: `grep -coE '#[0-9a-fA-F]{3,8}'` → `v2-fleet.html: 0`, `v3-assistant.html: 0`, `v4-transcript.html: 0`. `fidelity.py` exit **0** with the same three mocks in place.
VERDICT: **PASS**

### DW-3.14
PREMISE: "The primary action is not flat — top-highlight gradient — and the border scale stays **graded** (three distinct values)."
EVIDENCE: `.choice button.grant` computed `background-image: linear-gradient(oklch(0.375347 …), oklch(…))` plus `box-shadow: oklch(0.255347 …) 0 -1px 0 0 inset, …` — top-highlight gradient and inset bottom edge, both present, in both schemes. `.cta` "Start session" carries the same treatment; painted pixels across its 189×36 box span `[45,47,50] → [61,63,66]`, a live vertical ramp, not a flat fill. The 17×17 `.mark` carries the same `linear-gradient(oklch(0.993285 … / 0.22), …)` at a twelfth of the size. **Border scale graded:** three distinct non-transparent border colours in use per page — `oklab(0.946851 …)` ×32, `rgb(230,232,236)` ×40, `oklab(0.937497 …)` ×56.
VERDICT: **PASS**

**All requirements met:** **YES** — all 14 DW items pass on rendered evidence.

---

## Notes (non-blocking)
- The detector's 18 `nested-cards` hits are entirely the predicted false-positive class (controls, not cards); container-level verification is documented above. Nothing else fired.
- The gate suite's specific remaining blind spot, constructed and demonstrated: **it checks `documentElement.scrollWidth` for horizontal overflow, but the permission-gate overflow lives inside `.tr{overflow-x:auto}`**, so the document reports clean while 90px of the destructive-command scope sits off-screen. The codebase already *knows* this hazard — `v2-fleet.html` carries a comment naming it verbatim for `.tscroll` — but the guard was never generalised to `v4-transcript`. Assert `scrollWidth <= clientWidth` on **every descendant of every scroll container**, not on the document.
- Second blind spot: no gate exercises `pointer: coarse` at a **desktop-width** viewport. At 1024 with a coarse pointer the fleet board serves 10–14px action controls, because the 44px rule lives in a width query.
- Third blind spot: no gate asserts that a *defined* token is ever *consumed*. `--surface-hover`, `--surface-active` and the `--violet-*` ramp all pass every contrast and lint check while painting nothing.
- Distinctiveness (ai-tells CHECKER, always-on): **passes.** The direction is nameable in three words — *recessed-well ledger* — and the recessed-well-plus-never-flat-action rule (a card that contains a hole; a 17×17 mark carrying the same top-light/bottom-shade read as the primary button) is a choice a generic system would not make. Measured colour budget of 2.27% hued surface with the largest single hued region at 0.12% is a genuine constraint, not a default. Not competent-but-generic.
- The identity was not reopened, per the brief.

## Issues (if FAIL)
1. **Permission-gate scope is cut off-screen with no truncation cue at 390 and 320, adjacent to a fully-legible Approve** — Critical / usability + journey / WCAG 1.4.10 Reflow, Nielsen #5, DESIGN.md `## Never` #8 / wrap `.hitl`/`.scope` at the mobile step and generalise the overflow gate to scroll-container descendants.

**Verdict: FAIL — one blocker: finding #1.**

All 14 done-when items pass. The failure is a Critical cited-principle violation outside every DW item, on the mobile axis of the destructive-action surface — the same shape as the three prior rounds, and in the blind spot the brief predicted. Findings #2–#5 are Major and should be fixed in the same pass; #6–#10 can follow without another full cycle.
