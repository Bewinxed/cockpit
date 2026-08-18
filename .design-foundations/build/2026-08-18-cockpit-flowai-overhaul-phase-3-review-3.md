# Design Review: Phase 3 — Cockpit / FlowAI overhaul (revision 3)

## Rendered Evidence (Step 0)
- Screenshots: captured by me, not reused from the build — `/tmp/rev3/v2L.png`, `/tmp/rev3/v3L.png`, `/tmp/rev3/v4m-390.png`, `/tmp/rev3/v4m-320.png`, `/tmp/rev3/cin-D.png`, `/tmp/rev3/gate-L.png`, `/tmp/rev3/gate-D.png`
- Browser: attached over CDP to the live session on `:9222` via `playwright-core.connectOverCDP`. **Layout: verified by measurement**, not by screenshot.
- Surface: `v2-fleet.html`, `v3-assistant.html`, `v4-transcript.html` at 1440×1023 and 390 / 375 / 360 / 320 × 844 (`isMobile`, `hasTouch`, `pointer:coarse` confirmed `true`), light and `.dark`, DSF 1–3.
- Harnesses I wrote for this review (independent of `mocks/*`): `/tmp/rev3/measure.mjs` (type census), `geom.mjs` (geometry + border grade), `paint2.mjs` (occlusion-aware painted-pixel contrast, both luminance polarities), `gate.mjs` (greyscale Approve/Deny), `mobile.mjs` + `v4m.mjs` + `v4chip.mjs` (overflow / occlusion / tap targets), `cin3.mjs` (composer ink), `nested.mjs` (container-level nested-cards).

## Assessment B — Deterministic Detector
- Command: `node /home/bewinxed/.claude/plugins/cache/rtd/design-for-ai/4.2.0/scripts/detect.mjs mocks/v2-fleet.html mocks/v3-assistant.html mocks/v4-transcript.html > /tmp/detect-p3c.json 2>/tmp/detect-p3c.err`
- Exit: **0** (`"status": "ran"`, 16 rules, stderr 0 bytes)
- Findings: **18, all `nested-cards`, all `high`**. Zero findings on the other 15 rules — no purple triplet, no generic gradient, no shadcn defaults, no uniform-alpha shadow.
- Opened only after Assessment A findings were frozen: **YES**

## Triage
- Baseline (always-on): **visual** (`design-dna`, `foundations`, `ai-tells` CHECKER, `chapter-03-typography`, `chapter-08/09-color`) + **usability** (Nielsen's 10, WCAG 2.5.8, Fitts).
- Dispatched: **content-design** (real product copy — status words, empty state, permission-gate consequence text); **behavioral + deceptive-patterns** (an `rm -rf` permission gate is a consent surface); **journey** (mobile ↔ desktop route through the same permission decision).
- Not applicable: **data-viz** — no chart, graph or numeric encoding beyond four KPI figures; the design explicitly bans charts ("a status is one word, one glyph, one tint, and never a chart").
- Deferred: none.

## Cross-Pillar Findings (ONE ranked report)

| Severity | Pillar | Problem (in the rendered pixels) | Principle | Fix |
|---|---|---|---|---|
| **Critical** | visual / usability | `v4-transcript` dark scheme: the composer capsule paints **`rgb(213,213,213)`** — a near-white bar on a `#19191a` page. Placeholder ink `rgb(180,183,190)` measures **1.37:1**; typed ink `rgb(230,232,236)` measures **1.20:1**. Root cause: `.cin{background:rgba(255,255,255,.82)}` at `v4-transcript.html:147` is a hand-typed literal that does not theme. | WCAG 2.1 **1.4.3** (4.5:1 minimum); brief: "light is primary, dark is its twin. **Both must pass AA**"; ai-tells: unthemed literal | Replace with `var(--surface-overlay)` / `color-mix(in oklab, var(--surface-raised) 82%, transparent)`; add a `.dark` branch. This is the **identical failure mode** as the previously-fixed `.s-i` white-on-white at 1.09:1. |
| **Critical** | usability / journey | `v4-transcript` on mobile: `.shead` has `scrollWidth 442` against `clientWidth 390`, and its parent `main` carries `overflow-x:hidden`; document `scrollWidth === viewport`. The `needs you` chip is **clipped by 52px at 390 and 122px at 320** with **no scroll affordance to recover it** — at 320 the chip begins at x=374, i.e. entirely off-screen. `.path` "nixbox : ~/cockpit" is clipped a further 44px at 320 (visible mid-glyph in `/tmp/rev3/v4m-320.png`). | Nielsen **#1** visibility of system status; content loss with no recovery affordance | Let `.shead` wrap or truncate with an ellipsis; do not rely on an ancestor `overflow-x:hidden` to absorb it. Same shape as the previously-fixed "filter row hid content by 75px at 390". The lost content is the product's single most important signal. |
| **Critical** | behavioral / deceptive-patterns | The `rm -rf` permission gate **loses Approve/Deny size parity on mobile**. Desktop: 132×32 / 132×32 (parity holds). At 390: **Approve 170×44, Deny 150×44**. At 320: **Approve 135×44, Deny 115×44** — the destructive grant is **13–17% wider**. `.choice button{flex:1 1 auto}` with `width:auto` under `pointer:coarse` sizes each button to its own text. Approve is simultaneously the filled, high-salience button. | **Fitts's law (1954)** — acquisition cost falls with target width; DESIGN.md's own law: "They stay **peers in size and weight**"; deceptive-patterns: visual interference | Set an explicit equal basis (`flex:1 1 0; min-width:0`) in the coarse-pointer branch. The brief names this exact context: "the operator approves permissions from a phone under time pressure." |
| Major | usability | `v4-transcript` at 320: the inline answer affordance collides — "Or answer in your own words" is overlapped and clipped by the "Type an answer…" field, whose own right edge runs past the viewport, and the floating composer capsule sits on top of both (`/tmp/rev3/v4m-320.png`). | Nielsen #8 aesthetic and minimalist design; overlapping interactive regions | Stack `.qfree` vertically below 400px; reserve composer height instead of floating over live controls. |
| Major | behavioral | Even at desktop, the destructive grant is the **filled graphite gradient** button (mean greyscale 67) and the refusal is the **recessed** one (235). Size and weight are matched, and the pair *is* greyscale-separable — but the higher-salience treatment is on the destructive side. | Deceptive-patterns: prominence asymmetry on a consent surface | Consider giving the recessed treatment to the grant and leaving the refusal neutral, or making both peers in salience as well as size. *Does not fail the stated criterion — reported as a judgement.* |
| Major | visual | `v4-transcript` carries five hand-typed colour literals that do not theme: `rgba(255,255,255,.82)` (`.cin`), `rgba(255,255,255,.22)` (mark overlay), `rgba(244,244,244,0)` (`.fade`), and `box-shadow:0 10px 30px rgba(20,20,20,.11), 0 1px 3px rgba(20,20,20,.07)`. DESIGN.md §Never #6: "Shadows tint from `--neutral-12` and stay cool." | ai-tells: unthemed literal; DESIGN.md's own token contract | Route all five through the tier-2 tokens. *(Not a DW-3.13c failure — that item bans raw **hex**, and hex count is 0.)* |
| Major | usability | **The shipped gate suite still exits 0 on all three Criticals above.** `mocks/overflowcheck.mjs` asserts *document*-level overflow only, so content clipped by an ancestor's `overflow-x:hidden` is invisible to it. `mocks/paintcheck.mjs` scopes to "every chip and pill", so a form control at 1.20:1 is out of scope. `mocks/measure.mjs` / `typecheck.mjs` assert the action pair is "distinct" at desktop width only, so the mobile size split is out of scope. | Test-oracle scope gap | Extend `overflowcheck` to per-element `getBoundingClientRect().right > clientWidth` with a scrollable-ancestor walk; extend `paintcheck` to `input, textarea, [contenteditable]` and their placeholders; re-run the action-pair assertion at 320/390. |
| Minor | visual | The same 17×17 signature mark ships **two radii**: `.run-i .mark` is a literal `6px` (`v2-fleet.html:49`), the table `.mark` is `4.6px` (`--radius-mark`). Measured on the render: sidebar computed `6px`, table computed `4.6px`. | Nielsen **#4** consistency and standards | Point both at `var(--radius-mark)`. |
| Minor | visual | Three radii bypass the six-value ladder as literals: `.stat .chip` `5.5px` (should be `--radius-tile`), `thead th:first-child` `6px`, `.sec .plus` `6px`. | Token discipline; DESIGN.md "six measured radii" | Replace with the tokens. |
| Minor | content-design / visual | All four KPI tiles — Sessions, Needs you, Machines, Spend today — carry **one identical glyph**, as do all sidebar and table row marks. The icon encodes nothing and implies sameness across four different quantities. | **Data-ink ratio (Tufte)**; recognition over recall | Give the four stat tiles four distinct glyphs, or drop the tile and let the label carry it. |
| Minor | visual | `.logo` is flat `--brand-solid` in `v2`/`v3` but `--gradient-action` in `v4` (`v4-transcript.html:33`). The logo is not pressable, so `v4` is the deviation from "nothing that can be pressed is flat, and nothing that reports a number is raised." | Nielsen #4 consistency | Use `--brand-solid` in `v4`. |
| Minor | visual | Worst painted text pair I measure across the system is **4.56:1** (`.mut` "nixbox", v3 dark, under the assistant scrim), below DESIGN.md's stated system worst of 4.84:1. Still clears 4.5. | WCAG 1.4.3 | Update the claim, or deepen `--ink-muted` one step in dark. |
| Minor | visual | `v3` assistant panel: ~350px of empty grid separates the orb from the "Hey there!" block and its three prompts. | Gestalt proximity | Centre the orb+greeting as one group, or shorten the panel's empty lead. |
| Note | detector | 18 × `nested-cards` / high. Evidence verbatim: `"<div class=\"ghost\"> is a card inside a card ancestor"`, `"<div class=\"sel\"> is a card inside a card ancestor"`, `"<div class=\"a-orb\"> is a card inside a card ancestor"`. **Register-justified — all 18 are controls, verified at container level on the live DOM:** `.ghost`/`.icobtn`/`.sel`/`.search` are 32px controls, `padding 0 11–13px`, `radius 8px`, inside `.panel` `padding 11px` `radius 14px`; `.a-orb` is `radius 999px` inside `.asst` `radius 16px`; `.choice button`/`.qopts button` are `radius 8px` inside `.hitl` `padding 13px 14px` `radius 14px`. The `.well` (`radius 7px`, `padding 13px 15px`, `--surface-field`) inside `.stat` (`radius 10px`, `padding 7px`, `--surface-raised`) is the DW-3.9-permitted inset well. **No uniform-padding card-in-card exists.** | Prompt edge case: "detect.mjs fires many false positives on nested-cards — container-level verification required" | No action. |

## Requirement Fulfillment

### DW-3.1
PREMISE: "*(smoke check)* `palette.mjs` exits 0 with no FAIL lines. … NOTE: the DW text says `--scheme both`, which exits 1 with `missing --seed`; score against the project's documented invocation and note the wording defect."
EVIDENCE: Documented invocation (`--seed 263 --chroma muted --harmony analogous --scheme both`, plugin path) → `exit=0, FAIL lines=0, stderr=0 bytes`. The bare `--scheme both` form exits 1. Wording defect confirmed and noted; scored against the documented invocation.
VERDICT: **PASS**

### DW-3.2
PREMISE: "`--neutral-1`…`--neutral-12` and `--accent-1`…`--accent-12` in both schemes; all 13 semantic aliases resolve; functional colors `--error/success/warning/info-3/9/11` defined."
EVIDENCE: Resolved on the live DOM via a probe element in both schemes. `--neutral-1` → `#fcfdfd` light / `#121313` dark; `--neutral-12` → `rgb(44,46,49)` / `rgb(230,232,236)`. All 13 aliases resolve to real colours in both schemes (`--background`, `--surface`, `--surface-hover`, `--surface-active`, `--border-subtle/-/-strong`, `--text-secondary`, `--text`, `--accent-bg-subtle`, `--accent-solid`, `--accent-solid-hover`, `--accent-text`). All 12 functional steps resolve, e.g. `--error-11` `rgb(134,83,79)` light / `rgb(224,167,161)` dark. Missing tokens: none.
VERDICT: **PASS**

### DW-3.3
PREMISE: "Pairs `palette.mjs` does not verify, measured independently in both schemes: `--error-11`, `--warning-11`, `--success-11`, `--info-11` each on `--surface` AND `--surface-hover` ≥ 4.5:1 · `--text-secondary` on `--surface-hover` and `--surface-active` ≥ 4.5:1 · `--accent-solid` on `--background` ≥ 3:1 non-text. Every status pill measured **from painted pixels**, on the surface it lands on, including under a translucent scrim."
EVIDENCE: Computed by me from resolved DOM values — light: error-11 5.92 / 5.48 · warning-11 5.74 / 5.31 · success-11 5.53 / 5.12 · info-11 5.65 / 5.22 · text-secondary 5.28 / 4.90 · accent-solid on background **5.51**. Dark: 8.54/7.74 · 8.79/7.97 · 9.00/8.16 · 8.86/8.03 · 7.93/7.15 · accent-solid **3.32** (≥3.0). Painted pixels, occlusion-checked, both luminance polarities — v2 light: `needs you` **7.43**, `working` **7.17**, `error` **7.01**, `idle`/`paused` **5.90**, `.pill-n` 7.43 / 5.28. v2 dark: 7.89 / 8.17 / 8.59 / 7.93. **Under the v3 translucent scrim** (`--scrim-soft`, painted amber pill drops 240,232,214 → 228,221,204): `.pill-n` **6.91** light / **4.84** dark, `.num.warn` 8.26 / 5.70, `thead th` 6.07 / 4.75, `.mut` 5.57 / **4.56**. Every measured pair ≥ 4.5.
VERDICT: **PASS** (system worst measured 4.56, not the claimed 4.84 — Minor, filed above)

### DW-3.4
PREMISE: "The dark ramp activates under the project's `.dark` class variant — verified by rendering."
EVIDENCE: `document.documentElement.classList.add('dark')` on the live page moves the painted ground from `rgb(252,253,253)` → `rgb(33,34,36)`, the table header band `rgb(239,240,243)` → `rgb(18,19,19)`, and inverts the primary action from `bg rgb(45,47,50) / ink rgb(252,253,253)` to `bg rgb(226,228,232) / ink rgb(18,19,19)`. `--neutral-1` resolves `#fcfdfd` → `#121313`. The ramp activates on all three mocks.
VERDICT: **PASS** — *the ramp activates. Note that one surface inside it does not honour it (`.cin`, Critical #1); that is filed against the AA standing rule, not against this item's wording.*

### DW-3.5
PREMISE: "Type scale `--text-xs`…`--text-4xl` present with `--font-body` and `--font-display`; `## Type` states ratio, base px, steps, leading, and weights — **and those statements must match what actually renders.** … Measure computed weights and sizes across the rendered pages and compare to the document's claims."
EVIDENCE: Full computed census over every text-bearing element, all three mocks, both schemes. **Sizes:** v2 `{13:106, 14.5:13, 11.5:17, 18.5:1, 23.5:4}` · v3 `{13:111, 14.5:15, 11.5:17, 18.5:1, 23.5:4, 16.5:1}` · v4 `{13:15, 11.5:65, 14.5:6, 10.25:1}` — **every value is one of the nine enumerated steps; no 12.5px anywhere.** **Weights:** `{400, 450, 500}` only — v2 `{400:91, 450:14, 500:36}`, v3 `{400:93, 450:18, 500:38}`, v4 `{400:51, 450:6, 500:30}`. **Zero elements at ≥600; no `font-weight:650`.** **Computed leading ratios:** exactly three values, `1.400`, `1.250`, `1.000` — body 1.400 is inside the locked 1.2–1.4; no element left at `line-height: normal`. Tokens present: `--text-xs` 10.25px … `--text-4xl` 26.25px, `--font-body`/`--font-display` both `'Geist Variable'`. Ratio 1.125 from a 13px base reproduces every step. Both prior failures are repaired and the document now matches the render.
VERDICT: **PASS**

### DW-3.6
PREMISE: "Primary face is none of Inter / Roboto / Open Sans / Arial / Space Grotesk, installs from `@fontsource-variable/*`, with a justification tying letterform to the comps."
EVIDENCE: Computed `font-family` on rendered body text is `"Geist Variable"` on all three mocks; the woff2 loads from `mocks/fonts/geist-latin-wght-normal.woff2`. None of the banned five appears in `tokens.css`. `@fontsource-variable/geist` → HTTP 200 on the npm registry. Justification in DESIGN.md is measured from the shipped file (x-height 0.530em against 0.710em cap, unitsPerEm 1000, continuous `wght` 100–900) and tied to the comps' 13px row name → 6.9px x-height at a 44px pitch.
VERDICT: **PASS**

### DW-3.7
PREMISE: "Accent contains none of `#6366F1`, `#8B5CF6`, `#A855F7`; palette is neither cyan-on-dark nor purple-to-blue."
EVIDENCE: `--accent-solid` resolves to `rgb(68, 102, 172)` (`#4466ac`) in both schemes — a mid-dark blue, not violet. My own grep for the three literals across `tokens.css` and all three mocks returns **0**. Not cyan-on-dark: the dark ground is `#121313`, a near-neutral graphite, and the accent is used as a solid on light. Not purple-to-blue: the only gradient in the system is `--gradient-action`, whose measured stops are `oklch(0.375347 0.00609613 258.468)` → `oklch(0.288347 …)` — both graphite at chroma 0.006. Detector reported **0** hits on its purple/gradient rules.
VERDICT: **PASS**

### DW-3.8
PREMISE: "DESIGN.md carries all 10 template sections, `**Status:** confirmed`, and a `**Pins:**` line."
EVIDENCE: Nine `##` sections (Direction, Signature move, Expressive moments, Type, Color tokens, Space/shape/depth, Motion, Never, Open questions) plus the header block = 10. `**Status:** confirmed` present on line 2. `**Pins:**` present on line 7 with five pinned values and the converge-swap recorded.
VERDICT: **PASS**

### DW-3.9
PREMISE: "`## Never` names the **uniform-padding** form of `nested-cards` plus ≥2 further tells scoped to this DNA, and explicitly **permits** the comps' inset-well surface."
EVIDENCE: `## Never` item 1 names "Nested cards in the uniform-padding form" and carries an "**Explicitly permitted, and required:**" clause for the inset well (7px inset, `--surface-field` inside `--surface-raised`, radius 7 inside 10). Seven further tells follow, each DNA-scoped (decorative hue, red-as-ambient, shadcn defaults, weight >500, pure-black shadow, uniform spacing, matching a comp defect). Verified on the render: `.well` computes `radius 7px`, `padding 13px 15px` inside `.stat` `radius 10px`, `padding 7px` — different inset, fill and radius, so the permitted form is what ships.
VERDICT: **PASS**

### DW-3.10
PREMISE: "Shipped `--radius`, spacing, and shadow values differ from shadcn's defaults; no shadow uses pure black."
EVIDENCE: Resolved radius ladder on the render — `--radius 10px`, mark 4.6, tile 5.5, well 7, control 8, card 10, panel 14, pill 999. shadcn ships 4/6/8/12 off `--radius: 0.5rem`; this set differs in five of six members and in cardinality. Spacing 4/7/11/14/18/21/25/32 — not a 4px ladder. Every computed shadow tints from `--neutral-12`, e.g. `.stat` → `oklch(0.300347 0.00609613 258.468 / 0.055)` at hue 258°, and `.cta` → `oklch(0.255347 …) 0 -1px 0 inset, oklch(… / 0.1) 0 1px 2px`. Pure-black values in any mock `box-shadow`: **0**.
VERDICT: **PASS** *(the `rgba(20,20,20,·)` literals in `v4` `.cin` are not pure black and do not fail this item — filed Major for not being token-derived)*

### DW-3.12
PREMISE: "Status chips use only the four functional hues; any non-status accent is visibly distinct from all four. Status stays legible **with hue removed** — glyph and label carry it. Saturated colour only on chips, badges, and small marks; no large surface saturated."
EVIDENCE: Five states render with a distinct word **and** a distinct glyph — `• working` (filled dot), `↑ needs you` (chevron), `× error` (cross), `‖ idle` / `‖ paused` (pause bars, **no fill at all**). Strip the hue and five distinct words and five distinct glyphs remain, so the states survive greyscale. The non-status brand is `--brand-solid` = `--neutral-12` = `rgb(44,46,49)`, achromatic — visibly distinct from all four functional hues by construction. Painted saturation census on my own render: **2.29% of the light surface and 2.40% of the dark surface carries any hue; the largest single hued region is 0.12%** (1770px), i.e. chip/mark scale. No large surface is saturated — the field, chrome and content region are achromatic in the render.
VERDICT: **PASS**

### DW-3.13
PREMISE: "`mocks/fidelity.py` exits 0. **Proxies are not box geometry** — `stat_run_w` reads 264 where the stat card box is 280, and `stat_run_gap` reads 30 where the CSS gap is 14 … Never reconcile these against the measured-reference table."
EVIDENCE: `python3 mocks/fidelity.py mocks/ref/crop-table-1x.png mocks/v2-fleet.png` → **exit 0**, report ends `PASS`, every quantity `ok`. `stat_run_w` reads ref 264 / build 265 and `stat_run_gap` reads ref 30 / build 30 — both compared reference-to-build only, **not** against the 280 box or the 14px CSS gap. Independently: my DOM probe reads the real box as `281×90` at x 253/548/843/1138 (pitch 295, gap 14) and the well as `267×76` at a 7px inset — the painted-white-run proxy and the box geometry are correctly kept apart.
VERDICT: **PASS**

### DW-3.13b
PREMISE: "**AA beats fidelity where the comp is wrong** — the reference's `#838383` on `#F1F1F1` is 3.36:1, below the 4.5 floor; such inks are judged on their own AA ratio and reported as accepted deviations."
EVIDENCE: `gate-report.txt`: `band_label_ink #838383 → #646464, -31L, ok, AA 5.24:1 on #F1F1F1 (ref 3.36:1 — below 4.5, override)`, and an explicit `AA overrides — reference is defective here; build judged on AA, not on match` block naming the pair, both ratios and the 4.5 floor. Independently on the render, the table header label paints `rgb(82,85,91)` on `rgb(239,240,243)` = **6.56:1**, comfortably above AA and above the reference. DESIGN.md §Never #8 records the policy.
VERDICT: **PASS**

### DW-3.13c
PREMISE: "The three mocks carry **zero raw hex** and `fidelity.py` still exits 0."
EVIDENCE: My own scan — `grep -oE '#[0-9a-fA-F]{3,8}\b'` across `v2-fleet.html`, `v3-assistant.html`, `v4-transcript.html` returns **0** matches in all three files. `fidelity.py` exits 0 (evidence under DW-3.13).
VERDICT: **PASS** *(five non-hex `rgb()`/`rgba()` literals in `v4` are outside this item's wording — filed Major)*

### DW-3.14
PREMISE: "The primary action is not flat — it carries a top-highlight gradient — and the border scale stays **graded** (three distinct values)."
EVIDENCE: `.cta` computed `background-image: linear-gradient(oklch(0.375347 0.00609613 258.468), oklch(0.288347 0.00609613 258.468))` with `box-shadow: oklch(0.255347 …) 0 -1px 0 inset, oklch(… / 0.1) 0 1px 2px` — lighter stop on top, inset bottom edge. The `.grant` button carries the same pair in both schemes (dark inverts the stops to `oklch(0.910605 …) → oklch(0.950605 …)`). **Border grade measured as three distinct computed colours in the live DOM:** `oklab(0.946851 -0.0000797671 -0.00468505)` (hairline) · `oklab(0.937497 -0.000328133 -0.00530599)` (divider) · `rgb(230, 232, 236)` (control). Not flattened.
VERDICT: **PASS**

### Explicit revision-3 verification: "is the primary action now distinguishable from its destructive peer without relying on colour alone (test in greyscale), and are they still appropriately matched in size so nothing nudges the operator toward granting a destructive permission?"
PREMISE: quoted above.
EVIDENCE — **greyscale**: rendered, converted to greyscale, measured. Light: Approve mean grey **67.2** (modal 65) vs Deny mean grey **235.4** (modal 240) — Δ168.2, modal-to-modal **8.96:1**. Dark: Approve **218.2** vs Deny **26.2** — Δ192, **14.34:1**. Neither uses colour at all; both are graphite. Approve carries `--gradient-action` + `--shadow-action`, Deny carries `--surface-sunken` + `--shadow-inset-sel`. Byte-identical rendering is gone. Scope-widening control sits **45px** below the pair's bottom edge, above the file's stated 40px minimum. **Greyscale distinguishability: PASS.**
EVIDENCE — **size parity**: desktop 132×32 / 132×32 — parity holds. **390: Approve 170×44, Deny 150×44. 320: Approve 135×44, Deny 115×44.** `.choice button{flex:1 1 auto}` with auto width sizes each to its own label under `pointer:coarse` (confirmed `matchMedia('(pointer:coarse)').matches === true`). The destructive grant is 13–17% wider on the device the brief names as the primary permission-approval context, and is also the higher-salience filled button.
VERDICT: **FAIL** — greyscale criterion met; size-parity criterion **not** met on mobile.

**All requirements met:** **NO**

## Notes (non-blocking)
- The numbered DW items **3.1–3.14 all pass**, verified from the render. The identity is sound and is not reopened: the aesthetic direction is nameable in three words — **recessed-well ledger** — and it makes at least two choices a generic system would not: the 7px sunken well inside every value-bearing card, and the decision to ship **no decorative hue at all** (graphite brand, blue bound to one meaning), justified with a measured 5° hue sweep. The distinctiveness criterion (`ai-tells.md` CHECKER) **passes**; the detector found nothing on 15 of its 16 rules.
- The three blockers are all in `v4-transcript.html`, and all three are **dark-mode or mobile** — the axes the gate suite measures least. `v2-fleet` and `v3-assistant` are clean at every width and in both schemes.
- `.stat` renders 281px against the reference's 280 and the sidebar 227–228 against 228 — grid-division rounding, inside tolerance, `fidelity.py` reports `ok`. Not a finding.
- `v4-transcript.html` contains no `.dark`-specific rule of its own; it inherits the ramp from `tokens.css`, which is why the one hard-coded surface in it is the only thing that fails.
- Tap targets under `pointer:coarse`: rows and gate buttons do relax to 44px as claimed. `.icobtn` renders 32×44 — clears WCAG 2.5.8 AA (24×24) but not the 44×44 the file implies. Minor.

## Issues (if FAIL)
1. **Dark-mode composer is unreadable** — Critical / visual+usability / WCAG 1.4.3 / `.cin` background `rgba(255,255,255,.82)` paints `rgb(213,213,213)`; placeholder **1.37:1**, typed text **1.20:1**. Fix: token-derive the capsule background and add a `.dark` branch.
2. **Mobile clips the `needs you` chip with no recovery** — Critical / usability+journey / Nielsen #1 / `.shead` 442px inside a 390px `main{overflow-x:hidden}`; 52px lost at 390, 122px at 320 (chip entirely off-screen), document does not scroll. Fix: wrap or ellipsise `.shead`.
3. **Approve/Deny lose size parity on mobile** — Critical / behavioral+deceptive-patterns / Fitts's law / 170 vs 150 at 390, 135 vs 115 at 320, destructive grant the larger and more salient target. Fix: `flex:1 1 0; min-width:0` in the coarse-pointer branch.

**Verdict: FAIL** — blockers: (1) dark-mode composer text at 1.20:1, (2) mobile content clipped 52–122px with no scroll, (3) destructive-grant size advantage on mobile. All three are in `v4-transcript.html`; all three are missed by the shipped gate suite, whose scope gaps are documented above.
