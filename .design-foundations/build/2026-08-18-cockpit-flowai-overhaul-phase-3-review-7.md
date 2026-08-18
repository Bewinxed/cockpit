# Design Review: Phase 3 — Cockpit / FlowAI overhaul (review 7)

## Rendered Evidence (Step 0)
- Screenshots read: `mocks/v2-fleet.png`, `mocks/v2-dark.png`, `mocks/v2-mobile.png`, `mocks/v3-assistant.png`, `mocks/v4-transcript.png`
- Surface: three high-fidelity mocks — fleet board (light/dark/390), assistant panel over a scrimmed board, transcript with a live `rm -rf` permission gate
- Suite re-run by this reviewer, not taken on trust: `bash /home/bewinxed/cockpit/mocks/verify.sh` → **exit 0**, `ALL PHASE 3 CHECKS PASS`, 106 `PASS` lines, 0 `FAIL` lines. All report files regenerated at 23:00:2x by that run and read fresh.

## Assessment B — Deterministic Detector
- Command: `node .../4.2.0/scripts/detect.mjs mocks/v2-fleet.html mocks/v3-assistant.html mocks/v4-transcript.html > /tmp/detect-p3g.json`
- Exit: **0** (`"status": "ran"`, 16 rules), stderr 0 bytes
- Findings: **18, all `nested-cards`** (severity `high`), e.g. `<div class="ghost"> is a card inside a card ancestor`, `<button class="sel"> is a card inside a card ancestor`, `<div class="search"> is a card inside a card ancestor`
- Opened only after Assessment A findings were frozen: **YES**

## Triage
- Baseline (always-on): **visual** (`design-dna`, `foundations`, `ai-tells`, `color`, `fonts`) + **usability**
- Dispatched: `content-design` (real product copy — the permission gate's Machine/Path/Network/Undo/Future block, empty states, chip labels); `deceptive-patterns` check (a consent surface granting `rm -rf`)
- Not applicable: `data-viz` (no chart encodes a number anywhere — the KPI tiles are single figures, deliberately "never a chart"); `journey` (page specs are JOURNEY.md's, gate-passed in an earlier phase); `behavioral` (no conversion surface)
- Deferred: none

## Cross-Pillar Findings (ONE ranked report)

| Severity | Pillar | Problem (in the rendered surface) | Principle | Fix |
|---|---|---|---|---|
| **Critical** | usability / doc-integrity | The `@media (hover:none)` suppression block covers **4 of the 9** selectors that take `--surface-hover`. Built CSS, `v2-fleet.html:294–306`: the rule sets the hover fill on `.nav-i, .run-i, tbody tr td, .act span, .ghost, .icobtn, .sel, .pg i, .chip-s`; the suppression at line 305 lists only `.nav-i, .run-i, tbody tr td, .act span`. On touch — the product's primary context — tapping **Export CSV** (`.ghost`), the bell / theme toggle / rail collapse (`.icobtn`), the **All machines / All states / Last active** filters (`.sel`), a **pagination number** (`.pg i`) or **a status pill** (`.chip-s`) leaves a stuck `--surface-hover` tint. `.chip-s` is the worst: a *status* chip that changes fill and stays changed is a false state report on a status-reporting surface. `.choice button.refuse:hover{background-color:var(--surface-active)}` (Deny) and `.cta/.stop/.grant:hover{filter:brightness(1.08)}` (Approve) are likewise unsuppressed, so both permission-gate buttons hold a post-tap state on a phone. DESIGN.md § Interaction states asserts this without qualification: *"Suppressed under `@media (hover: none)` so a touch tap does not leave a stuck highlight."* | Nielsen #1 (visibility of system status — a stale highlight reports a state that is not true); Nielsen #4 (consistency: 4 of 9 peers behave one way, 5 the other) | Extend the `hover:none` block to all nine `--surface-hover` selectors plus `.cta/.stop/.grant/.refuse`, and add the missing crossing (below) so the gate holds it |
| **Critical** | doc-integrity | **The crossing rule has a hole, and it is hiding the defect above.** The stated rule classifies **pointer** as *structural* and requires *"cross every behavioural property with every structural axis."* Hover/active surface behaviour is a behavioural property. The crossings actually run cross pointer with **target size only** (`target size × pointer × width`). `hover: none` is a pointer-class media feature; hover behaviour is never crossed with pointer anywhere in the suite. Correspondingly the Conditions row for hover reads *"both schemes, `.nav-i` and a table row"* — two selectors, one pointer type — while the Treatment-table row above it states the suppression universally. This is the fifth instance of the exact failure the section's own preamble names: *"A property asserted without its conditions is a claim that will outrun its evidence."* | Cited by the artifact's own stated rule; Nielsen #4 | Cross `hover/active × pointer × scheme` in `axischeck.mjs`, asserting every selector in the `--surface-hover` rule paints `transparent` under `hover:none`; then re-state the Treatment row with its conditions |
| **Critical** | doc-integrity | **DESIGN.md's hardcoded census numbers are contradicted by the current render, under the document's own stated conditions.** Four independent drifts, measured against reports this reviewer regenerated: (1) *Weights* — doc: *"computed weights across all three mocks in both schemes are **exactly** `{400: 470, 450: 76, 500: 208}`"*; `typecheck-report.txt`: `{"400":470,"450":76,"500":204}` — same scope, **500 off by 4**. (2) *Sizes* — doc: `{13px: 464, …}`; report: `{"13px":460, …}` — **off by 4**, every other step identical. (3) *Leading* — doc: *"returns **exactly** three ratios: `1.400 x3136 · 1.000 x140 · 1.250 x40`"*; `clipcheck-report.txt`: `1.400x3150 1.250x450 1.000x140` — the 1.250 count is wrong by **an order of magnitude (40 vs 450)**. (4) *§ Direction* — *"**2.27%** of the surface carries any hue"*; `satcensus-report.txt`: **2.342%** light, **2.456%** dark. The qualitative invariants behind each sentence are true and gated (no weight >500; every size on the ladder; leading inside 1.2–1.4; hue budget tiny) — the **numbers** are stale, because every gate checks the *class* and nothing diffs the document against the reports. `verify.sh` even labels the gate *"type conformance — DESIGN.md's own weight/size/leading claims, on the render"* while printing numbers the document contradicts. This is the phase that **locks** the document for seven downstream phases. | The artifact's own standard: *"a locked document that misdescribes the render is worse than the render bug"* (§ Type, Leading) | Generate these four censuses into DESIGN.md from the report files at build time, or add a gate that fails when a number in the document does not match its report |
| Major | visual / doc-integrity | `mocks/tokens.resolved.css` collapses **114** relative-colour values to `#000000`, because `resolve-tokens.mjs` cannot evaluate `oklch(from var(--neutral-12) l c h / α)`. That includes all seven shadow tokens (`--shadow-action/-drawer/-hairline/-inset-sel/-lifted/-overlay/-tile: #000000`) and `--mark-overlay` — **the exact value `## Never` #6 bans**. The *render* is clean (measured `.cta box-shadow: oklch(0.255347 0.00609613 258.468) …`; gate: `pure-black values inside any mock box-shadow: 0`), so DW-3.10 holds — but `colorcheck.py`, the 69-assertion DW-3.3 gate, reads this degraded file, and it is a shipped artifact of a token-locking phase that a consumer could reasonably import. | `## Never` #6 (pure-black shadow, binary tell); garbage-in on a contrast gate | Either teach `resolve-tokens.mjs` relative colour, or make it **fail loudly** on any value it cannot resolve rather than silently emitting `#000000` |
| Major | fonts | The locked primary face is **not installed anywhere in the product**. `grep -rn geist package.json apps/*/package.json` → no match; `apps/dashboard/package.json:27` still carries `"@fontsource-variable/public-sans"`, a different face. DESIGN.md's evidence is a registry probe (*"HTTP 200"*), and `verify.sh` asserts *"installable from `@fontsource-variable/*`"* — installable, not installed. The mocks self-host from `mocks/fonts/geist-latin-wght-normal.woff2`. DW-3.6 is satisfied as written; the identity lock is not yet true of the app. | Nielsen #4 (consistency between the locked DNA and the shipping product) | Add `@fontsource-variable/geist` + `geist-mono` to `apps/dashboard/package.json` and drop `public-sans`, or state in § Open questions that the app face swap is Phase 4 work |
| Minor | usability | The v4 transcript rail is a **different component** from v2/v3's, not a variant of it: no icons on Fleet/Tools/Rules/Usage, no `6`/`14` count badges, no Machines section, no Projects entry, no spend card, no account row — and the section labels lose the `◌` marker the other two mocks carry. Nothing in DESIGN.md or JOURNEY.md declares a reduced transcript rail. | Nielsen #4 (consistency and standards) | Declare it as a focus-mode variant in the page spec, or unify the rail |
| Minor | content-design | The error row's third action renders as a bare **em dash** (`Open  Peek  —`) where every other row reads `Pause` or `Resume`. A disabled control drawn as punctuation names neither the action nor why it is unavailable, and carries no accessible text. | Nielsen #1 (visibility) / #5 (error prevention); disabled-state legibility | Render the disabled label (`Pause`) in `--ink-muted` with `aria-disabled`, or state the reason |
| Note | detector | 18 × `nested-cards` (`high`), e.g. *"`<div class="ghost">` is a card inside a card ancestor"*, *"`<button class="sel">` is a card inside a card ancestor"*. **Register-justified.** The prompt's edge case and DESIGN.md `## Never` #1 both scope the ban to the *uniform-padding* form and explicitly permit the inset well. Container-level verification (`detectcheck.py`, re-run in this review) classifies all 18 as controls — button/input/select/orb/composer/pill — and finds **0** genuine uniform-padding card-in-card. Every hit is the rule's documented substring behaviour, not a defect. Resolved to Note, not Minor. | `## Never` #1; ai-tells `nested-cards` rule scope | none |
| Note | usability | DW-3.3's *"including under a translucent scrim"* clause is exercised on **non-pill** text. In v3 every status pill sits fully behind the panel — `paintcheck-report.txt` correctly SKIPs all eight with `occluded by DIV.a-grid` rather than reporting a bogus ratio — so no pill in any mock is simultaneously visible and scrim-dimmed. The scrim compositing path is proven on painted pixels by e.g. `PASS 7.49:1 lbl "Needs you" text rgb(69,72,77) on fill rgb(231,232,234)` (dimmed from the unscrimmed `rgb(239,240,243)`). Requirement met; worth knowing it is met vacuously for pills. | — | If a pill must be measured under a scrim, place one outside the panel's footprint in a mock |
| Note | deceptive-patterns | The `rm -rf` gate is **honest**. Approve and Deny are byte-equal in size at all ten measured width×scheme×pointer combinations (`typecheck-report.txt`: `125x32 / 132x32 / 160x44 / 349x44 / 561x44`, Approve == Deny at every one), differ in *kind* not weight, and the copy states scope, path, network, undo and future reach before either button. `Always allow rm -rf in ~/cockpit` is a separate, lower-salience control with its consequence spelled out. No dark pattern. One gap for Phase 4: the DNA defines **no destructive action variant** — the same treatment would carry an *irreversible* command, where the reversibility copy would no longer be doing the work it does here. | Deceptive-patterns: confirmshaming / weighted default — absent | Phase 4: define a destructive action variant |

### Distinctiveness (ai-tells CHECKER mode) — PASS
Nameable in three words: **quiet graphite ledger**. Choices a generic system would not make, verified on the render: the 7px recessed well inside every value-bearing card (`well 267x76 r=7px` inside `card 281x90 r=10px`, measured); a spacing ladder that deliberately is not 4px multiples (`4 · 7 · 11 · 14 · 18 · 21 · 25 · 32`); asymmetric 25/21 content padding kept on purpose; a six-value radius ladder including 4.6 and 5.5; the hatched tick-band under the table card; a *hue budget* of 2.34% of surface with the largest hued region at 0.12%; four status states carrying glyph + fill so they survive greyscale, with `idle` shipping no fill at all. This is not on-pattern safety.

## Requirement Fulfillment

### DW-3.1
PREMISE: *(smoke check)* `palette.mjs` exits 0 with no FAIL lines. NOTE: the DW text says `--scheme both`, which exits 1 with `missing --seed`; score against the project's documented invocation and note the wording defect.
EVIDENCE: Documented invocation (`--seed 263 --chroma muted --harmony analogous --scheme both`, DESIGN.md:152, run by `verify.sh:23`) → `exit=0  FAIL lines=0  stderr=0 bytes`. Wording defect reproduced independently: bare `node palette.mjs --scheme both` → `EXIT=1`, `palette.mjs: missing --seed (hue 0-360 or #hex)`.
VERDICT: **PASS**

### DW-3.2
PREMISE: `--neutral-1`…`--neutral-12` and `--accent-1`…`--accent-12` in both schemes; all 13 semantic aliases resolve; functional colors `--error/success/warning/info-3/9/11` defined.
EVIDENCE: `light: 58 tokens, 12+12 ramp + 12 functional + 13 aliases -> missing none`; `dark: 58 tokens, … -> missing none`. Independent count in `tokens.css`: 96 `--neutral-N` declarations across both blocks.
VERDICT: **PASS**

### DW-3.3
PREMISE: Pairs `palette.mjs` does not verify, measured independently in both schemes: `--error-11`, `--warning-11`, `--success-11`, `--info-11` on `--surface` AND `--surface-hover` ≥ 4.5:1 · `--text-secondary` on `--surface-hover` and `--surface-active` ≥ 4.5:1 · `--accent-solid` on `--background` ≥ 3:1 non-text. Every status pill measured from painted pixels, including under a translucent scrim.
EVIDENCE: `colorcheck.py all checks pass (69 assertions)`. Painted-pixel pass over 3 mocks × 2 schemes: `every painted chip and pill clears 4.5:1 in both schemes`; scrim-dimmed compositing proven at `PASS 7.49:1 lbl "Needs you" … on fill rgb(231,232,234)`; occluded pills correctly SKIPped with a named blocker rather than measured. `--accent-solid` 3.32:1 on the dark ground (DESIGN.md § Open questions, the system's thinnest margin).
VERDICT: **PASS** (see the Note on the scrim clause being met vacuously for pills)

### DW-3.4
PREMISE: The dark ramp activates under the project's `.dark` class variant — verified by rendering.
EVIDENCE: `tokens.css:77,231` → `[data-theme="dark"], .dark {` (both selectors; the edge case is handled, not ignored). Rendered under `.dark`: body-bg `#f3f4f6` → `#19191a` (244 → 25), ink `#2c2e31` → `#e6e8ec` (46 → 233), `--neutral-1` `#fcfdfd` → `#121313` — a re-solved ramp, not an inversion. `v2-dark.png` confirms visually.
VERDICT: **PASS**

### DW-3.5
PREMISE: Type scale `--text-xs`…`--text-4xl` with `--font-body` and `--font-display`; `## Type` states ratio, base px, steps, leading, weights — and those statements must match what renders.
EVIDENCE: All nine steps + `--font-body`/`--font-display`/`--font-mono` defined (`tokens.css:274–276`). § Type states ratio **1.125**, base **13px**, rem against a 16px root, all nine steps, leading 1.4/1.2/1.25/1, weights 400/450/500 never 600. The render agrees on every **stated rule**: computed sizes are seven values, all named steps; weights are exactly `{400, 450, 500}`; leading ratios are exactly `{1.400, 1.250, 1.000}`, all inside 1.2–1.4 for body; zero `line-height: normal`.
VERDICT: **PASS** — the requirement is that the *statements* match the render, and every rule-level statement does. The **element counts** attached to three of those statements do not (Critical #3); that is a documentation-integrity blocker, not a type-system failure.

### DW-3.6
PREMISE: Primary face is none of Inter / Roboto / Open Sans / Arial / Space Grotesk, installs from `@fontsource-variable/*`, with a justification tying letterform to the comps.
EVIDENCE: `--font-body: 'Geist Variable'` — none of the banned five. `@fontsource-variable/geist -> HTTP 200`. Justification is measured from the shipped file rather than asserted: x-height **0.530 em** against cap **0.710 em** (unitsPerEm 1000, `fontTools` on `geist-latin-wght-normal.woff2`), giving a **6.9px x-height** at the 13px base — tied to the comps' 44px row pitch and to the fact that every candidate face renders ~45% heavy against the comp's rasterizer, so legibility cannot be bought with weight. Continuous `wght` 100–900 is what makes the 400/450/500 ladder possible.
VERDICT: **PASS** (see Major: installable ≠ installed in `apps/dashboard`)

### DW-3.7
PREMISE: Accent contains none of `#6366F1`, `#8B5CF6`, `#A855F7`; palette is neither cyan-on-dark nor purple-to-blue.
EVIDENCE: `files containing a banned literal: 0` across the token file and all three mocks; independently grepped — the only occurrences anywhere are inside DESIGN.md:652–653's distance table. `--accent-9` / `--accent-solid` = `#4466ac`, a muted slate blue; ΔE **11.2 / 17.4 / 22.4** to the three banned literals. Not cyan-on-dark (dark accent stays `#4466ac`, with `--accent-11: #a0b8e6` for ink). Not a purple-to-blue gradient — the only gradients on the surface are the graphite action ramp and the mark overlay, both hueless.
VERDICT: **PASS**

### DW-3.8
PREMISE: DESIGN.md carries all 10 template sections, `**Status:** confirmed`, and a `**Pins:**` line.
EVIDENCE: `template sections present: 9/9 (+ header = 10); total '## ' sections: 10`. Independently listed: Direction · Signature move · Expressive moments · Type · Color tokens · Interaction states · Space, shape, depth · Motion · Never · Open questions. Line 2: `**Status:** confirmed`. Line 8: `**Pins:** family=… discipline=… hue=263 …`.
VERDICT: **PASS**

### DW-3.9
PREMISE: `## Never` names the uniform-padding form of `nested-cards` plus ≥2 further tells scoped to this DNA, and explicitly permits the comps' inset-well surface.
EVIDENCE: `named tells: 10; uniform-padding form: yes; inset well permitted: yes`. Item 1 names *"a card inside a card where both carry the same padding and the same radius"* and marks the inset well *"Explicitly permitted, and required"* with its differentiators (7px inset, `--surface-field` in `--surface-raised`, r7 in r10). Nine further tells, each scoped to this project with its own measurement. Container-level verification of the detector's 18 hits: **0 genuine**.
VERDICT: **PASS**

### DW-3.10
PREMISE: Shipped `--radius`, spacing, and shadow values differ from shadcn's defaults; no shadow uses pure black.
EVIDENCE: `--radius: 10px` (shadcn: 0.5rem/8px with a 4/6/8/12 ladder); shipped ladder `4.6 / 5.5 / 7 / 8 / 10 / 14 / 999` — differs in five of six members and in cardinality. Spacing `4 · 7 · 11 · 14 · 18 · 21 · 25 · 32` — not a 4px ladder. `pure-black colour values in tokens.css (comments stripped): 0`; `pure-black values inside any mock box-shadow: 0`; measured on the render, `.cta box-shadow: oklch(0.255347 0.00609613 258.468) 0px -1px 0px 0px inset, …`.
VERDICT: **PASS** (the `#000000` in `tokens.resolved.css` is a resolver artifact, filed Major — it does not reach the render)

### DW-3.12
PREMISE: Status chips use only the four functional hues; any non-status accent is visibly distinct from all four. Status stays legible with hue removed. Saturated colour only on chips, badges, and small marks.
EVIDENCE: Four chip classes only (`s-attn`/`s-live`/`s-fail`/`s-idle`), fills measured `oklab(0.931781 0.00237743 0.0254578)` / `(0.922221 −0.0120882 −0.0206084)` / `(0.909986 0.0317101 0.0147429)` / `rgba(0,0,0,0)`. `every status chip carries a glyph as well as a label (8 chips)`; `every status state has a distinct glyph (4 states)`; `idle ships no fill (6.7 dE from the live chip when it had one)` — so state survives greyscale by glyph + fill-vs-none. Non-status accent is graphite, hueless, distinct from all four by construction. Saturation census on the render: **2.342%** of surface (light) / **2.456%** (dark), largest single hued region **0.1202%** — chip/mark scale, confirmed by eye in `v2-fleet.png`.
VERDICT: **PASS**

### DW-3.13
PREMISE: `mocks/fidelity.py` exits 0. Proxies are not box geometry — `stat_run_w` reads 264 where the stat card box is 280, and `stat_run_gap` reads 30 where the CSS gap is 14, because the detector measures painted white runs and the card contains a recessed well. Never reconcile these against the measured-reference table.
EVIDENCE: `fidelity.py` → `PASS`, exit 0. `stat_run_w` ref 264 / build 265 (+1 ok); `stat_run_gap` ref 30 / build 30 (+0 ok) — scored proxy-against-proxy, never against the 280×90 box or the 14px gap. Not reconciled by this review.
VERDICT: **PASS**

### DW-3.13b
PREMISE: AA beats fidelity where the comp is wrong — the reference's `#838383` on `#F1F1F1` is 3.36:1; such inks are judged on their own AA ratio and reported as accepted deviations.
EVIDENCE: `band_label_ink  #838383  #646464  -31L  ok  AA 5.24:1 on #F1F1F1 (ref 3.36:1 — below 4.5, override)`, reported under an explicit `AA overrides — reference is defective here; build judged on AA, not on match` block. A −31L delta accepted *because* it is the AA-correct answer.
VERDICT: **PASS**

### DW-3.13c
PREMISE: The three mocks carry zero raw hex and `fidelity.py` still exits 0.
EVIDENCE: `v2-fleet.html: 0 raw hex · v3-assistant.html: 0 raw hex · v4-transcript.html: 0 raw hex`; the stricter any-notation pass reports `0 hand-typed colour literal(s)` per file — *"every colour in every mock resolves through a token."* `fidelity.py` exit 0 in the same run.
VERDICT: **PASS**

### DW-3.14
PREMISE: The primary action is not flat — top-highlight gradient — and the border scale stays graded (three distinct values).
EVIDENCE: Measured in the live DOM — `.cta background-image: linear-gradient(oklch(0.375347 0.00609613 258.468), oklch(0.288347 0.00609613 258.468))` (two distinct stops, top highlight → body) and `.cta box-shadow: oklch(0.255347 …) 0px -1px 0px 0px inset` (inset bottom edge). Borders: hairline `oklab(0.946851 −0.0000797671 −0.00468505)` · divider `oklab(0.937497 −0.000328133 −0.00530599)` · control `rgb(230,232,236)` — **3 distinct values**. Visible in `v2-mobile.png` on the full-width Start session button.
VERDICT: **PASS**

**All requirements met:** YES (14 of 14 DW items PASS on measured evidence)

## Notes (non-blocking)
- The suite is genuinely strong: a fresh build reproduces the checked-in mocks byte for byte (`b6d66cf5…`), and the axis matrix holds 30 combinations including forced-colors, 200% text at 390, font-load failure and prefers-contrast. RTL is measured and honestly declared unenforced with its reason.
- The permission gate is the best surface here. Scope-before-consent (Machine / Path / Network / Undo / Future), peer-sized buttons at every measured combination, and path values that break at any character so the tail survives — that last one is a lesson most products never learn.
- `mocks/fonts/` self-hosts Geist; the mocks do not depend on the app's package.json, so the Major above is a product-wiring gap, not a mock defect.
- Both Criticals are cheap: one CSS selector list plus one gate, and one build-time substitution of four numbers.

## Issues (blockers)
1. **`@media (hover:none)` suppresses 4 of the 9 `--surface-hover` selectors** — stuck hover state on touch for Export CSV, icon buttons, the three filters, pagination, **every status pill**, and both permission-gate buttons; DESIGN.md asserts the suppression universally. — Critical / usability + doc-integrity / Nielsen #1, #4 / extend the suppression block to all nine selectors plus `.cta/.stop/.grant/.refuse`.
2. **The crossing rule's own terms are not met for hover** — pointer is declared *structural*, hover/active is a behavioural property, and the two are never crossed; the Conditions row scopes hover to `.nav-i` and a table row while the Treatment row states it universally. — Critical / doc-integrity / the artifact's own stated rule / add `hover/active × pointer × scheme` to `axischeck.mjs` and re-condition the Treatment row.
3. **Four DESIGN.md census figures are contradicted by the render under the document's own stated conditions** — weights `500: 208` vs measured `204`; sizes `13px: 464` vs `460`; leading `1.250 x40` vs `x450` and `1.400 x3136` vs `x3150`; hue budget `2.27%` vs `2.342%`/`2.456%`. Every one is prefixed *"exactly"* and scoped to *"all three mocks … both schemes"*. Nothing diffs the document against the reports, so a phase whose purpose is to **lock** the document locks four wrong numbers. — Critical / doc-integrity / *"a locked document that misdescribes the render is worse than the render bug"* (DESIGN.md § Type) / generate these four censuses from the report files, or gate them.

**Verdict: FAIL** — blockers 1, 2 and 3. All 14 done-when items pass on measured evidence and the identity is not in question; the three blockers are one incomplete CSS rule, one missing crossing that the suite's own stated rule already mandates, and four stale numbers in the document this phase locks.
