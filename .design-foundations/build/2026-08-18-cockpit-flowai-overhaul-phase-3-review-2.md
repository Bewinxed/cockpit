# Design Review: Phase 3 — Cockpit / FlowAI Overhaul (review 2)

**Verdict: FAIL** — 2 blockers, both proven by measurement. Everything else passes with independent evidence.

## Rendered Evidence (Step 0)

- Screenshots read: `mocks/v2-fleet.png`, `v2-dark.png`, `v2-mobile.png`, `v3-assistant.png`, `v3-dark.png`, `v4-transcript.png`
- Live render + DOM measurement: all three mocks via playwright-core (`node_modules/.bun/playwright-core@1.62.1`), DPR 2–3, at **320 / 390 / 768 / 1024 / 1440** in **both** schemes (`.dark` applied at runtime) — 30 render passes.
- Painted-pixel sampling: element-clipped PNG crops decoded with PIL, WCAG 2.x relative luminance computed from the actual pixels.
- Scripts run independently: `palette.mjs`, `mocks/fidelity.py`.
- `mocks/verify.sh` was **not** used as evidence (it is the thing under review).

## Assessment B — Deterministic Detector

- Command: `node /home/bewinxed/.claude/plugins/cache/rtd/design-for-ai/4.2.0/scripts/detect.mjs mocks/v2-fleet.html mocks/v3-assistant.html mocks/v4-transcript.html > /tmp/detect-p3b.json`
- Exit: **0** (`"status":"ran"`, 16 rules, stderr empty)
- Findings: **18, all `nested-cards` (high)**. The other 15 rules — including the purple-triplet, cyan-on-dark, gradient, and shadcn-default rules — returned **0**.
- Opened only after Assessment A findings were frozen: **YES**

**Container-level adjudication of all 18 hits (measured, not counted).** Per the prompt's edge case, a raw `nested-cards` count is not a signal. Measured in the live DOM:

| hit | element | pad | radius | card ancestor | anc pad | anc radius | same pad? | same radius? |
|---|---|---|---|---|---|---|---|---|
| `.ghost`, `.ghost exp` | 32px button | `0 13px` | 8px | **none** | – | – | – | – |
| `.icobtn` | 32px button | `0` | 8px | **none** | – | – | – | – |
| `.search` | 32px input | `0 11px` | 8px | `div.panel` | 11px | 14px | **false** | **false** |
| `.sel` ×3 | 32px control | `0 11px` | 8px | `div.panel` | 11px | 14px | **false** | **false** |

Every hit is a **32px-high form control**, not a card. Two have no card ancestor at all. None is the banned uniform-padding form (same padding *and* same radius with no change in meaning). Notably the detector did **not** flag the actual nested surface — `.stat` (pad 7px, r10) → `.well` (pad `13px 15px`, r7, different fill) — which is the inset-well form DW-3.9 explicitly permits. **All 18 resolve to Note. Zero contribute to the verdict.**

## Triage

- **Baseline (always-on):** visual (`design-dna`, `checklists`, `ai-tells` CHECKER) + usability
- **Dispatched:** `color` (a generated ramp + functional tints under review), `fonts` (a type scale and primary-face justification under review), `content-design` (real product copy — permission gates, empty states, error labels)
- **Not applicable:** `data-viz` (no charts; the stat cards are single scalars, not encodings), `behavioral` / `deceptive-patterns` (no conversion or persuasion surface), `journey` (page specs are Phase 2's artifact, not this surface)
- **Deferred:** none

## Cross-Pillar Findings (ONE ranked report)

| # | Severity | Pillar | Problem (in the rendered pixels) | Principle | Fix |
|---|---|---|---|---|---|
| 1 | **Critical** | fonts / design-dna | `v3-assistant.html:242` ships `.a-t b{font-weight:650}` and `:258` `.a-body h3{font-weight:550}`. Computed weights measure **650** and **550**; the excess is visible in `v3-assistant.png` — "**Outpost**" is plainly heavier than "Assistant". DESIGN.md `## Type` states "400 body · 450 medium · 500 strong. **600 and above never appear**" and `## Never` #5 bans "Any 600 or 700 in a text style". The locked identity document misdescribes its own render, and the mock violates a self-declared Never. | Locked-DNA drift (design-dna.md: "deviations require editing DESIGN.md first"); ch03 typography — weight is the design's *only* emphasis lever here, so an off-ladder weight is not cosmetic | Replace both literals with `var(--weight-strong)` (500). If 500 reads too light against `--text-md`, step tracking or ink, never weight — DESIGN.md's own stated correction. |
| 2 | **Critical** | usability / design-dna | `v4-transcript.html` permission gate: **Approve and Deny are byte-identical** — both 132×32px, `background-color: rgb(252,253,253)`, `background-image: none` (**flat**), `border-color: rgb(230,232,236)`, `color: rgb(44,46,49)`, `font-weight: 500`. The two opposite outcomes of approving `rm -rf apps/dashboard/.svelte-kit` carry zero visual differentiation. DESIGN.md's signature move declares "**Nothing that can be pressed is flat** … applied without exception" — neither button carries `--gradient-action` or `--shadow-action`. The only gradient button on this surface is the 34×34 "■" stop control. | Nielsen #5 error prevention; Fitts's law (1954) — equal size and equal travel for asymmetric outcomes is exactly wrong; DESIGN.md `## Never` #3 reserves `--error-*` for "destructive confirmation", and the tokens go unused | Give Approve `--gradient-action` + `--shadow-action` as the primary; demote Deny to `.ghost`. On a destructive gate consider the `--error-*` tier the doc already reserves. Mobile is first-class — a thumb approval needs the two to be unmistakable. |
| 3 | **Major** | fonts | `v4-transcript.html:22` defines `--c-fs:12.5px` and applies it to `.msg` and `.hitl .lede` — **real body copy**. 12.5px is not one of DESIGN.md's nine enumerated steps (10.25 / 11.5 / 13 / 14.5 / 16.5 / 18.5 / 20.75 / 23.5 / 26.25). Measured across 30 render passes: `sizes { 13:2106, 14.5:376, 11.5:954, 23.5:44, 20.75:48, 16.5:22, 18.5:8, **12.5:70**, 10.25:10 }`. DW-3.5 requires the enumerated steps to match what renders. | ch03 — a scale with an undocumented rung is not a scale; `## Open questions` flags the transcript's *density* question but does not disclose that an off-ladder size already ships | Either add a documented compact rung to `## Type` (with its ratio derivation) or set `.msg`/`.lede` to `--text-sm` (11.5) / `--text-base` (13). |
| 4 | **Major** | visual | `v4-transcript.html:45–46` — `.mark` omits the `background-color: var(--brand-solid)` that `v2-fleet.html:121` sets, and hand-types `rgba(255,255,255,.22)` in place of `--mark-overlay`. The signature 17×17 item mark therefore renders as an **empty pale box**: measured **1.07:1** against its surroundings in both the v4 sidebar (×4) and the session header (×1). Visible in `v4-transcript.png`. | ai-tells.md — an element that reads as unloaded/broken; Nielsen #4 consistency (same class, two different renders across surfaces) | Restore `background-color: var(--brand-solid); background-image: var(--mark-overlay)` — copy `v2-fleet.html:121` verbatim. |
| 5 | **Major** | visual / usability | `v3-assistant.html:264` — `.s-i` sets only `background-image: var(--mark-overlay)` with **no `background-color`**, while `.s-i svg{stroke: var(--on-brand)}` paints near-white ink. `--on-brand` is the ink *for* the graphite ground; with the ground missing it lands white-on-white. Measured **1.12 / 1.11 / 1.09:1** on the three suggestion-chip icons. They read as empty grey placeholders in `v3-assistant.png`. | WCAG 2.2 SC 1.4.11 (3:1 non-text) where the glyph is non-redundant; token misuse — an ink token used without its ground | Same fix as #4: add `background-color: var(--brand-solid)`. |
| 6 | **Major** | visual / data-viz | The **identical** atom glyph fills all four stat icon tiles (Sessions / Needs you / Machines / Spend today) and every table row mark and sidebar item — ~14 identical marks per screen. The tile sits in the slot a differentiating icon would occupy and differentiates nothing; four unlike metrics get one mark. | Tufte, data-ink ratio — ink that encodes no variable; Nielsen #4 (the form promises a distinction it does not deliver) | Give the four stat tiles four distinct glyphs, or drop the tile and let the label carry it. The row mark can legitimately stay uniform (it is a bullet), but the stat tiles cannot. |
| 7 | **Major** | design-dna | DESIGN.md `## Expressive moments` claims "the orb is the single place `--accent-solid` appears as a **solid fill**". Rendered: `.a-orb{background: var(--surface-raised)}` with `.a-orb svg{stroke: var(--accent-solid)}` — a **1.7px stroke on a 27px glyph**, not a fill. `--accent-*` appears **nowhere** in `v2-fleet.html`. The 12-step accent ramp is, in practice, one icon outline. | Locked-DNA drift — a false claim in the governance artifact, which later phases build against | Either fill the orb with `--accent-solid` as stated, or rewrite the sentence to describe the stroke. The doc is the contract; the render is the truth. |
| 8 | **Major** | usability | `.filters` is `overflow-x: auto`. Measured: at **390px** "Last active" is cut by **75px** (`scrollWidth 409 / clientWidth 312`); at **320px** by **145px** and "All states" by a further 17px (`409 / 242`). There is no edge fade, no partial-peek cue, no scroll affordance — `v2-mobile.png` shows "Last" clipped mid-word, which reads as a bug. At 320px the third filter is effectively unreachable. | Nielsen #1 visibility of system status; responsive.md — a hidden control with no discovery cue. The brief makes mobile first-class | Add a right-edge mask/fade on `.filters`, or collapse the three selects into a single "Filters" sheet below 480px. |
| 9 | Minor | usability | Row actions "Open" / "Peek" are `<span>` at 13px / weight 400 / no underline, visually indistinguishable from the adjacent non-interactive data cells (`nixbox`, `Claude Code`, also 13px/400). The only signal is `cursor: pointer` — absent on touch — and they are not keyboard-reachable. The third action is a bare glyph (`▮▮` / `▶` / `—`); the `—` on the error row conveys "unavailable" with no explanation. | Nielsen #6 recognition over recall; WCAG 2.1.1 keyboard | Promote to `<button>`/`<a>`, and give them a weight or ink step above the data ink. Replace the bare `—` with a reason on hover/press. |
| 10 | Minor | visual | `--gradient-action` **inverts its lighting direction** between schemes. Light: `l 0.375 → 0.288` (top lighter — lit from above, as stated). Dark: `l 0.9106 → 0.9506` (top **darker** — lit from below), and `--brand-edge` flips from `l−0.045` to `l+0.05`. DESIGN.md states the rule as "lit from above" without disclosing the inversion. | Surfaces/foundations — a light source that moves between themes breaks the depth model | Keep the highlight at the top in both schemes, or document the inversion in `## Signature move`. |
| 11 | Minor | visual | Radius drift from the stated six-value set. `.asst` renders **`border-radius: 16px`** — a seventh value outside DESIGN.md's `4.6 / 5.5 / 7 / 8 / 10 / 14 / 999`. And `.mark` renders **4.6px in the table but 6px in the sidebar** — one class, two radii. | Nielsen #4 consistency; the six-radius claim is part of the DW-3.10 shadcn diff argument | Set `.asst` to `var(--radius-panel)` (14) and unify `.mark` on `--radius-mark`. |
| 12 | Minor | fonts | `v4-transcript.html` sets `font-family: ui-monospace, monospace` on `.path`, `code`, `.arg`, `.cmd` — **not** `--font-mono` (Geist Mono Variable), which DESIGN.md declares the code face. Separately, `button.stop` computes to **Arial** — a family on DW-3.6's banned list. It is not the primary face (Geist covers 3 498 measured text elements vs Arial's 10), so DW-3.6 stands, but a banned family is literally present in the render. | ch03 / appendix-fonts — the reference constraint is ≤2 text families excluding mono; the token exists and is bypassed | Point all four rules at `var(--font-mono)`; give `.stop` `var(--font-body)`. |
| 13 | Minor | visual | DESIGN.md claims the KPI "sits **inside the well** by 14px at 1440 and 10px at 390 and 320". Measured element box: 14 / 10 / 10 ✓. Measured **painted ink box** (Range rect): 10.5 at 1440, 7.8 at 390, and **−1.3px at 320** — the `$18.40` glyph crosses the well's bottom edge. Overflow is `visible`, so it paints over the card rather than clipping; it stays legible. | The claim holds for the box, not the ink — the distinction this review was asked to check | Add ~2px bottom padding to the well below 360px, or restate the claim as a box measurement. |
| 14 | Note | detector | 18× `nested-cards` (high). Evidence, verbatim: `<div class="ghost"> is a card inside a card ancestor`, `<div class="search"> is a card inside a card ancestor`, `<div class="sel"> is a card inside a card ancestor` (+15 more). | ai-tells.md `nested-cards` | **False positives, all 18.** Container-level measurement (table above) shows every hit is a 32px form control; two have no card ancestor; none shares padding *and* radius with its ancestor. The permitted inset well was not flagged. No action. |

### Distinctiveness (ai-tells.md CHECKER mode) — **PASS**

Nameable in two-to-three specific words: **"recessed-well ledger"** / *graphite sunken ledger*. Choices a generic system would not make, each verified on the render:

- **The brand accent is graphite, not a hue.** `--brand-solid` = `--neutral-12`. Measured saturation census over the shipped PNGs: **0.63% / 0.65% / 0.47% / 0.24% / 0.71%** of pixels carry saturation ≥60 channel-spread; ≤2.0% carry any hue at all. Every default system ships a coloured brand accent; this one refuses.
- **The recessed well** — a raised card containing a hole: 7px inset, r7 inside r10, `--surface-field` inside `--surface-raised`. Measured 281×90 card / 267×76 well.
- **Non-4px spacing ladder** 4 / 7 / 11 / 14 / 18 / 21 / 25 / 32 with deliberate **25 left / 21 right** asymmetric content padding — measured on the render (sidebar 228 → card x253 = 25; card right 1419 → 1440 = 21).
- **Sub-pixel comp-derived radii** 4.6 and 5.5.
- **Idle ships no pill at all** — `--status-idle-bg: transparent`. Absence is the state.
- **A hatched `repeating-linear-gradient` ledger tick band** under the table.

This is not competent-but-generic. The distinctiveness criterion does not contribute to the FAIL.

## Requirement Fulfillment

### DW-3.1
PREMISE: *(smoke check only)* `palette.mjs` exits 0 with no FAIL lines. Certifies almost nothing — the script solves its own reported pairs by construction. NOTE: the DW text says `--scheme both`, which exits 1 with `missing --seed`; score this against the project's documented invocation and note the wording defect.
EVIDENCE: Documented invocation (`verify.sh:10`, `DESIGN.md:115`) — `node …/palette.mjs --seed 263 --chroma muted --harmony analogous --scheme both` → **exit 0**, `grep -c FAIL` = **0**. The DW-text form `--scheme both` alone → **exit 1**, stdout `palette.mjs: missing --seed (hue 0-360 or #hex)`, confirming the wording defect exactly as flagged.
VERDICT: **PASS** (wording defect in the DW text confirmed and noted; not the build's)

### DW-3.2
PREMISE: `--neutral-1`…`--neutral-12` and `--accent-1`…`--accent-12` present in both schemes; all 13 semantic aliases resolve; functional colors `--error/success/warning/info-3/9/11` defined.
EVIDENCE: Queried `getComputedStyle(document.documentElement)` on the live render in **both** schemes for 72 tokens — **zero MISSING**. All 24 ramp steps, all 13 aliases (`background, surface, surface-hover, surface-active, border-subtle, border, border-strong, text, text-secondary, accent-bg-subtle, accent-solid, accent-solid-hover, accent-text`) resolve to concrete rgb via probe element; all 12 functional steps (`error/success/warning/info` × 3/9/11) defined. Spot check: `--neutral-1` → `rgb(252,253,253)` light / `rgb(18,19,19)` dark; `--accent-solid` → `rgb(68,102,172)` both.
VERDICT: **PASS**

### DW-3.3
PREMISE: **Pairs `palette.mjs` does not verify**, measured independently, in both light and dark: `--error-11`, `--warning-11`, `--success-11`, `--info-11` each on `--surface` **and** `--surface-hover` ≥ 4.5:1 · `--text-secondary` on `--surface-hover` and `--surface-active` ≥ 4.5:1 · `--accent-solid` on `--background` ≥ 3:1 non-text. Every status pill's text-on-tint pair measured **from painted pixels**, on the surface it actually lands on, including where a translucent scrim composites over it.
EVIDENCE: **22 token pairs computed independently** from resolved rgb (not from the doc's table). Light: error-11 5.92 / 5.48 · warning-11 5.74 / 5.31 · success-11 5.53 / 5.12 · info-11 5.65 / 5.22 · text-secondary 5.28 / **4.90** · accent-solid on background **5.51** (≥3). Dark: 8.54 / 7.74 · 8.79 / 7.97 · 9.00 / 8.16 · 8.86 / 8.03 · 7.93 / 7.15 · accent-solid **3.32** (≥3). **All 22 pass; worst 4.90 light, 3.32 dark.**
**Painted pixels:** 32 visible chips crop-sampled at DPR 3 in both schemes, glyph-core vs modal-background, occlusion-filtered by hit-test. Worst **5.28:1** on the unobstructed board (0 of 28 below 4.5). Under the v3 assistant scrim, 4 chips remain unoccluded: worst **4.84:1**. My independent numbers reproduce DESIGN.md exactly — the same pill paints `(240,232,214)` in v2 and `(228,221,204)` in v3, and the system's worst painted pair is 4.84:1.
VERDICT: **PASS**

### DW-3.4
PREMISE: The dark ramp activates under the project's `.dark` class variant — verified by rendering.
EVIDENCE: Applied `document.documentElement.classList.add('dark')` at runtime and re-read computed styles. `body` background moves `oklab(0.968…)` ≈ 247 → **`rgb(25,25,26)`**; `body` color moves `rgb(44,46,49)` → **`rgb(230,232,236)`**; `--neutral-1` moves `rgb(252,253,253)` → `rgb(18,19,19)`. The `.dark` bridge (`[data-theme="dark"], .dark`) is live, not merely present in the file. Confirmed independently in all 15 dark render passes.
VERDICT: **PASS**

### DW-3.5
PREMISE: Type scale `--text-xs`…`--text-4xl` present with `--font-body` and `--font-display`; `## Type` states ratio, base px, enumerated steps, leading, and weights — and those statements must match what actually renders.
EVIDENCE: Tokens present ✓ (all nine steps resolve; `--font-body` = `'Geist Variable', ui-sans-serif, …`, `--font-display` = `var(--font-body)`). `## Type` states ratio 1.125, base 13px, nine steps, leading, weights ✓. **Leading matches:** measured across 30 passes, exactly three ratios render — `1.400 ×3228 · 1.000 ×160 · 1.250 ×40` — body at 1.4, inside the 1.2–1.4 constraint, with 1.0 confined to display figures as documented.
**Two statements do NOT match the render:**
1. `## Type` — "400 body · 450 medium · 500 strong. **600 and above never appear.**" Measured weights: `{400:1948, 450:380, 500:1290, **550:10, 650:10**}`. `v3-assistant.html:242` `.a-t b{font-weight:650}`, `:258` `.a-body h3{font-weight:550}`. Visible in `v3-assistant.png`.
2. `## Type` enumerated steps — measured `12.5px ×70` on `.msg` and `.hitl .lede` (real body copy), from `v4-transcript.html:22 --c-fs:12.5px`. Not an enumerated step.
VERDICT: **FAIL**

### DW-3.6
PREMISE: Primary face is none of Inter / Roboto / Open Sans / Arial / Space Grotesk, installs from `@fontsource-variable/*`, with a justification tying letterform to the comps.
EVIDENCE: Primary face computes to **Geist Variable** on **3 498** measured text elements across all three mocks in both schemes — none of the banned five. Installs from `@fontsource-variable/geist@5.3.0` (`mocks/fonts/geist-latin-wght-normal.woff2` present; `@fontsource-variable/geist-mono` for code). Justification is measured from the shipped font file, not asserted: x-height 0.530em against cap 0.710em, unitsPerEm 1000, continuous `wght` 100–900 — tied to the comps via the 13px base yielding a 6.9px x-height that holds a 44px-pitch row (measured row pitch: **44px** ✓) without reaching for weight.
VERDICT: **PASS** (see finding #12 — `button.stop` computes to Arial and v4's code face bypasses `--font-mono`; neither is the primary face, so neither defeats this item)

### DW-3.7
PREMISE: Accent contains none of `#6366F1`, `#8B5CF6`, `#A855F7`; palette is neither cyan-on-dark nor a purple-to-blue gradient.
EVIDENCE: Grep across all three mocks + `tokens.css` — the three literals appear **only** inside DESIGN.md's own prose stating their absence. `--accent-9` = `#4466ac`. **Purple census on the shipped PNGs**: pixels with channel-spread ≥40 in the 265–335° band = **1 of 5 892 480** (v2-fleet), **0** (v2-dark), **1** (v3-assistant) — i.e. 0.0000%. Not cyan-on-dark: the dark ground is `rgb(18,19,19)` near-neutral graphite, and the accent is a mid-dark blue used on light. Not a purple-to-blue gradient: the system contains exactly one action gradient and **both stops are graphite** — `linear-gradient(oklch(0.375 0.0061 258), oklch(0.288 0.0061 258))`. Independently corroborated: Assessment B's purple-triplet, cyan-on-dark and gradient rules all returned **0**.
VERDICT: **PASS**

### DW-3.8
PREMISE: DESIGN.md carries all 10 template sections, `**Status:** confirmed`, and a `**Pins:**` line.
EVIDENCE: Against the template at `references/visual/design-dna.md:229–283`: header block ✓ plus all nine `##` sections in template order — `Direction` (11), `Signature move` (28), `Expressive moments` (46), `Type` (57), `Color tokens` (110), `Space, shape, depth` (599), `Motion` (620), `Never (this project's tells at risk)` (644), `Open questions` (683). Line 2 carries `**Status:** confirmed`; line 7 carries `**Pins:** family=data-dense-professional · discipline=ledger-grid · hue=263 · chroma=muted · signature=accent-scarcity`.
VERDICT: **PASS**

### DW-3.9
PREMISE: `## Never` names the **uniform-padding** form of `nested-cards` plus ≥2 further tells scoped to this DNA, and explicitly **permits** the comps' inset-well surface.
EVIDENCE: `## Never` #1 names it precisely — "Nested cards in the uniform-padding form. A card inside a card where both carry the same padding and the same radius, producing containment noise with no change in meaning." Seven further tells, each scoped to this DNA: #2 a decorative hue, #3 red as ambient colour, #4 unmodified shadcn defaults, #5 weight above 500, #6 a pure-black shadow, #7 uniform spacing, #8 matching a comp defect. The permission is explicit and bolded: "**Explicitly permitted, and required:** the comps' **inset-well** surface — a raised card containing a *recessed* panel at a different inset (7px), a different fill … and a different radius (7 inside 10)". Verified on the render: `.stat` pad 7px / r10 vs `.well` pad `13px 15px` / r7 / different fill — the permitted form, and the detector did not flag it.
VERDICT: **PASS** (noting the irony that `## Never` #5 is itself violated by the shipped mocks — that is scored under DW-3.5)

### DW-3.10
PREMISE: Shipped `--radius`, spacing, and shadow values differ from shadcn's defaults; no shadow uses pure black.
EVIDENCE: `--radius` computes to **10px** (shadcn: `0.5rem` = 8px). Radius census on the live render: `{4.6px, 5.5px, 6px, 7px, 8px, 10px, 14px, 999px}` — differs from shadcn's 4/6/8/12 ladder in cardinality and in six of eight members. Spacing 4/7/11/14/18/21/25/32 — not a 4px-multiple ladder. **Shadows: zero `rgba(0,0,0,·)` values in either scheme** — enumerated every computed `boxShadow` in the DOM, light and dark, and the pure-black match set is empty in both. All elevation tints from `oklch(from --neutral-12 …)` (light) / `oklch(from --neutral-1 …)` (dark). Assessment B's shadcn-default rule returned 0.
VERDICT: **PASS**

### DW-3.12
PREMISE: Status chips use only the four functional hues; any non-status accent is visibly distinct from all four. Status stays legible **with hue removed** — glyph and label carry it. Saturated colour appears only on chips, badges, and small marks; no large surface is saturated.
EVIDENCE: Four hues only — `.s-live` info, `.s-attn` warning, `.s-done` success, `.s-fail` error; `.s-idle` is `--status-idle-bg: transparent` (no fill). Saturated hue bins on the render cluster at **190–220°** (info/live) and **10–40°** (error/warning) — no fifth hue. Non-status accent is `--brand-solid` = `--neutral-12` = `rgb(44,46,49)`, channel spread **5** — effectively hueless, trivially distinct from all four tints. **Hue removed:** re-measured all 28 chip crops converted to greyscale — worst **5.27:1**, **0 of 28** below 4.5; each state also carries a distinct glyph (↑ chevron / • dot / × cross / ‖ pause bars) *and* a word. **Saturation census:** ≥60 channel-spread covers **0.633% / 0.652% / 0.466% / 0.240% / 0.000% / 0.706%** of pixels across the six shipped PNGs; no large surface is saturated.
VERDICT: **PASS**

### DW-3.13
PREMISE: `mocks/fidelity.py` exits 0. Covers only what the script detects. **Proxies are not box geometry** — `stat_run_w` reads 264 where the stat card box is 280, and `stat_run_gap` reads 30 where the CSS gap is 14, because the detector measures painted white runs and the card contains a recessed well. Never reconcile these against the measured-reference table.
EVIDENCE: `python3 mocks/fidelity.py /tmp/flowai/crop-table-1x.png mocks/v2-fleet.png` → **exit 0**, final line `PASS`. Proxy rows read as the premise describes and are **not** reconciled against box geometry: `stat_run_w 264 → 265 (+1)`, `stat_run_gap 30 → 30 (+0)`, `stat_run_x 262 → 261 (−1)`, `stat_run_h 7 → 7`. Direct rows: `content_pad_r 21 → 21 (+0)`, `row_pitch 44 → 44 (+0)`, `sidebar_w 228 → 227 (−1)`, `page_bg #F5F5F5 → #F3F4F6 (−1L)`, `row_name_ink #393939 → #353535 (−4L)`. `stat_num_ink` and `well_inset` report `(not detected)`.
VERDICT: **PASS**

### DW-3.13b
PREMISE: **AA beats fidelity where the comp is wrong** — the reference's `#838383` on `#F1F1F1` is 3.36:1, below the 4.5 floor; such inks are judged on their own AA ratio and reported as accepted deviations.
EVIDENCE: `fidelity.py` prints a dedicated block — "AA overrides — reference is defective here; build judged on AA, not on match: `band_label_ink  build 5.24:1 on #F1F1F1   ref 3.36:1   min 4.5   PASS`". The mechanism is codified in the script (`AA_OVERRIDE`) and in DESIGN.md `## Never` #8, not applied ad hoc. Verified independently on the render: the table header band computes `background rgb(239,240,243)` with `color oklab(0.4477…)`, i.e. the build's ink, not the comp's `#838383`.
VERDICT: **PASS**

### DW-3.13c
PREMISE: The three mocks carry **zero raw hex** and `fidelity.py` still exits 0.
EVIDENCE: `grep -oiE '#[0-9a-f]{6}\b|#[0-9a-f]{3}\b'` over each mock → **0 matches in all three** (`v2-fleet.html`, `v3-assistant.html`, `v4-transcript.html`). `fidelity.py` exits **0** on the same build (see DW-3.13).
VERDICT: **PASS** (note: `v4-transcript.html:46` hand-types `rgba(255,255,255,.22)` — a raw colour literal outside the token system, but not hex, so this item stands; scored under finding #4)

### DW-3.14
PREMISE: The primary action is not flat — it carries a top-highlight gradient — and the border scale stays **graded** (three distinct values).
EVIDENCE: **Border scale — PASS, both schemes.** Enumerated every non-transparent computed border colour in the live DOM: light returns exactly three — `oklab(0.946851 …)` (`--border-hairline`), `oklab(0.937497 …)` (`--border-divider`), `rgb(230,232,236)` (`--border-control`); dark returns exactly three — `oklab(0.297788 …)`, `oklab(0.308823 …)`, `rgb(57,60,65)`. Graded, not flattened.
**Gradient — partial.** The v2/v3 primary action `button.cta` "Start session" carries `background-image: linear-gradient(oklch(0.375 0.0061 258), oklch(0.288 0.0061 258))` — top lighter, a genuine top-highlight — plus `box-shadow: … 0 -1px 0 inset` (`--shadow-action`). Not flat ✓. **But** the v4 permission gate's primary action, `Approve`, computes `background-image: none` — flat — and is identical to `Deny` (finding #2). And in dark the gradient inverts to a bottom-highlight (finding #10).
VERDICT: **PARTIAL** — the border clause passes outright; the gradient clause holds for the v2/v3 primary action and fails for v4's. The substance is escalated as Critical finding #2 rather than double-counted here.

**All requirements met: NO** — DW-3.5 FAIL, DW-3.14 PARTIAL. The other twelve pass with measured evidence.

## Notes (non-blocking)

- **Coverage is complete on pixels.** Every measurement above comes from a live render, not from source reading. No "Layout: Not verified" gaps.
- **Assessment B's 18 hits are all false positives** and are recorded as finding #14 with container-level disproof. They do not contribute to the verdict, exactly as the prompt's edge case anticipated.
- **DESIGN.md is unusually honest where it is honest.** Its painted-pixel contrast claims reproduce under independent measurement to the digit — the same pill at `(240,232,214)` in v2 and `(228,221,204)` in v3, worst painted pair 4.84:1, three leading ratios and no fourth. The `--ink-depth: 52%` and `--tint-depth: 86%` derivations are real corrections, not decoration. That makes findings #1 and #7 more serious, not less: the document earns trust everywhere else, so the two places it misdescribes the render will not be caught by a later reader.
- **Genuinely strong work worth preserving:** the permission-gate disclosure block (Machine / Path / Network / Undo / Future — "Approving covers this one command. It does not widen what the agent may run later") is exemplary content design; the hue budget (≤0.71% saturated pixels) is a real constraint held under pressure; idle-ships-no-pill is a sharp, measured decision; the previous KPI-clipping defect is genuinely fixed (7.8px ink clearance at 390px, values fully legible in `v2-mobile.png`).
- The stat row gives "Needs you" — the metric the Direction names as the entire point — visually identical treatment to "Spend today". Consistent with accent scarcity, but worth a deliberate decision rather than a default.
- The v3 assistant panel leaves its top ~55% empty above the greeting. Defensible as a chat empty state (messages grow upward from the bottom); noted, not filed as a finding.

## Issues (blockers)

1. **DESIGN.md `## Type` misdescribes the rendered weights** — `v3-assistant.html:242` `font-weight:650` and `:258` `font-weight:550`, measured as computed 650/550 and visible in the shipped PNG, against a document that states "600 and above never appear" and a `## Never` #5 that bans exactly this. — Critical / fonts + design-dna / locked-DNA drift, ch03 / Replace both with `var(--weight-strong)`.
2. **Approve and Deny are byte-identical on a destructive permission gate** — both flat 132×32 with the same fill, border, ink and weight, on a mobile-first `rm -rf` approval, against a signature rule the document declares is applied "without exception". — Critical / usability + design-dna / Nielsen #5, Fitts's law / Give Approve `--gradient-action` + `--shadow-action`, demote Deny to `.ghost`.

Both are small, surgical CSS edits. Neither requires rethinking the identity — which is otherwise sound, distinctive, and well evidenced.

**Verdict: FAIL — blockers: (1) DW-3.5, DESIGN.md's stated weights and enumerated type steps do not match what renders; (2) Critical, the destructive permission gate's primary and negative actions are visually identical and both flat.**
