# Design Review: Phase 3 — Cockpit / FlowAI overhaul (review 6)

## Rendered Evidence (Step 0)
- Screenshots read: `mocks/v2-fleet.png`, `mocks/v2-dark.png`, `mocks/v3-assistant.png`, `mocks/v4-transcript.png`
- Re-rendered live with `playwright-core` at 1440 / 1024 / 768 / 390 / 320 in both schemes; own captures at `/tmp/v2-390.png`, `/tmp/v4-390.png`
- Surface: `mocks/v2-fleet.html`, `mocks/v3-assistant.html`, `mocks/v4-transcript.html` — high fidelity, token-driven
- Project suite re-run independently: `bash mocks/verify.sh` → **exit 0**, 82 PASS lines, 0 FAIL

## Assessment B — Deterministic Detector
- Command: `node /home/bewinxed/.claude/plugins/cache/rtd/design-for-ai/4.2.0/scripts/detect.mjs mocks/v2-fleet.html mocks/v3-assistant.html mocks/v4-transcript.html > /tmp/detect-p3f.json`
- Exit: **0** (`"status": "ran"`, 16 rules)
- Findings: **18, all `nested-cards`**, 0 hits on the other 15 rules
- Opened only after Assessment A findings were frozen: **YES**

## Triage
- Baseline (always-on): visual (`design-dna`, `ai-tells` CHECKER) + usability
- Dispatched: `color` (full ramp/alias/functional contrast contract), `fonts` (type scale, face justification, leading/weight ladder), `foundations`/`archetypes` (data-dense professional register)
- Not applicable: `data-viz` (no chart encodes a number — the KPI tiles are typographic, not graphical), `behavioral`/`deceptive-patterns` (no conversion surface; the one persuasion-adjacent moment, the permission gate, was audited under usability and is honest — see Note 3)
- Deferred: none

---

## Cross-Pillar Findings (ONE ranked report)

| # | Severity | Pillar | Problem (in the rendered pixels) | Principle | Fix |
|---|----------|--------|----------------------------------|-----------|-----|
| 1 | **Critical** | usability | **The navigation drawer has no keyboard opener at any width, and the off-canvas sidebar stays in the tab order.** The only opener is `<label for="navt" class="burger">` — measured `tabIndex = -1` — paired with `<input type="checkbox" id="navt" hidden>` (`display:none`). Programmatic check `keyboard-focusable drawer opener present` returns **false at 1440, 1024, 768, 390 and 320**. At ≤768 the `<aside>` is translated `matrix(1,0,0,1,-284,0)` yet its **19 focusables remain tabbable**: a live tab walk at 390 puts the **first 12 stops at x = −274 … −31, every one `inView: false`**. `v4-transcript.html` at 390 shows **8 off-screen tab stops and no burger at all**. | WCAG 2.2 SC 2.1.1 Keyboard (A) — the control that reveals navigation cannot be operated; SC 2.4.7 Focus Visible (A) and SC 2.4.11 Focus Not Obscured (AA) — the ring paints outside the viewport for 19 consecutive stops; SC 1.4.10 Reflow — the 320px view must stay operable, so a desktop keyboard user at 400% zoom loses all navigation | Make the burger a real `<button type="button" aria-expanded aria-controls>`; apply `inert` (or `visibility:hidden`) to `aside` while the drawer is closed so its 19 stops leave the tab order. Then cross the two axes in `axischeck.mjs`: assert the tab walk at 390 and 320, not only at 1440. |
| 2 | **Critical** | usability / content-design | **DESIGN.md § Interaction states is false where it counts.** It asserts "a 2px `--focus-ring` ring at 2px offset on **every** interactive affordance" and "Measured tab walk: **55 stops on the fleet board, 61 on the assistant, 16 on the transcript, with zero unreachable pointer affordances**." Those figures reproduce exactly — but only at 1440, where `label.burger` is `display:none`. At every width where the burger actually paints, it is a pointer affordance with **zero tab stops and no focus ring**. The document's headline keyboard claim is scoped to the one width at which the failing control does not exist. | Honest-artifact rule: a locked contract that misdescribes the render is worse than the render bug (the document says this of itself at line 108). This is the fourth DESIGN.md claim contradicted by measurement across six reviews (1.45 leading, 650 weight, focus ring, now the tab walk). | Re-measure the tab walk at 390/320 and either fix finding 1 first or state the width scope in the sentence. Do not ship the unqualified "every". |
| 3 | Major | visual / design-dna | **The UA link underline survives on every promoted `<a>`.** Computed `text-decoration-line: underline` on `.nav-i` and `.run-i` in all three mocks, both schemes — Fleet, Tools, Rules, Usage, Projects, nixbox, mba-m3, hetzner-01 and all four running sessions. Plainly visible in `v2-fleet.png`, `v2-dark.png`, `v3-assistant.png`, `v4-transcript.png`. No `text-decoration` declaration exists anywhere in the three files. The active item is then *both* underlined and inset-selected — two redundant selection signals. The FlowAI comps carry no nav underline. | Nielsen #4 Consistency and standards — an underline is the web's reserved signal for an inline hyperlink, not for a persistent nav chip; ch03 typography — a rule under every item at 13–14.5px adds a second horizontal grain to a design whose whole thesis is that hairlines do the structural work. This is UA default leakage, i.e. an unowned choice, which is the `ai-tells` failure mode even when the rest of the identity is deliberate. | Add `:where(a){text-decoration:none}` scoped to the shell (keep underlines on genuine inline links, e.g. the "Rules" reference in the permission disclosure). Add a `typecheck.mjs` assertion for `textDecorationLine` alongside the weight/size/line-height gates it already runs. |
| 4 | Major | content-design / usability | **DESIGN.md's "reset" paragraph is incomplete in the same place.** It states "Promoting to real controls re-introduced the UA defaults — font-size fell to 13.3333px … `line-height` reset to `normal` on 40 elements … Semantics without a reset is a downgrade, so **the reset is explicit and gated**." Three UA defaults were caught and gated; the fourth and most visible one (finding 3) was not, and the gate does not look for it. | Same honest-artifact rule as finding 2. Downgraded from Critical because the sentence enumerates what it fixed rather than claiming exhaustiveness. | Ship finding 3's fix and the gate, then the sentence becomes true as written. |
| 5 | Minor | visual | `v4-transcript.html` drops the nav icons that `v2`/`v3` carry — Fleet / Tools / Rules / Usage render as bare text, and the count pills (`6`, `14`) are gone. Same sidebar, two different treatments across pages. | Nielsen #4 Consistency and standards | Carry one sidebar component across all three surfaces, or state the compact variant in JOURNEY.md's density classes. |
| 6 | Minor | usability | Desktop (fine-pointer) targets sit under 24 px: favourite star **13×16**, row actions Open/Peek/Pause **33×18**, collapse **16×20** — 37 elements total. They pass SC 2.5.8 only through the **spacing exception**, which I verified holds: action centres are **45.5 px apart horizontally** and **44 px vertically**, star pitch **33 px**, all ≥ the 24 px undersized-target circle. Coarse pointer is clean at every width (**0 undersized targets at 390 and 320**; actions measure 44×44). | WCAG 2.2 SC 2.5.8 Target Size (Minimum), spacing exception | Not a defect — but state the exception in DESIGN.md, because it is load-bearing and one spacing tweak silently breaks it. |
| 7 | Minor | detector | 18 `nested-cards` hits, e.g. `"<div class=\"search\"> is a card inside a card ancestor"`, `"<button class=\"sel\"> is a card inside a card ancestor"`, `"<button class=\"a-send\"> is a card inside a card ancestor"`. Verified at container level, as the prompt's edge case requires: every hit is a **bordered control** (search field, three filter selects, two icon buttons, the composer, the send button, the stop button) inside a panel — none is a card carrying the same padding and radius as its parent. The one genuine card-in-card, the stat well, is the permitted inset-well (measured 281×90 r10 card containing a 267×76 r7 well at 7 px inset, different fill) and is **not** flagged. | `ai-tells` `nested-cards` is banned in its uniform-padding form only (DESIGN.md § Never, DW-3.9); register-justified | No action. Recorded as an accepted false-positive class. |
| 8 | Note | color | DESIGN.md line 676 states `--accent-solid` "measures **2.91:1** on the dark ground." I reproduce **2.84:1** on `--surface-raised`, **3.13:1** on `--surface`, **3.32:1** on `--background` — no ground yields 2.91. The conclusion the number supports (below 3:1, therefore the dark focus ring swaps to `--accent-11`) holds on the raised ground. | Precision of a cited measurement | Name the ground alongside the ratio. |

---

## Requirement Fulfillment

### DW-3.1
PREMISE: "*(smoke check)* `palette.mjs` exits 0 with no FAIL lines. NOTE: the DW text says `--scheme both`, which exits 1 with `missing --seed`; score against the project's documented invocation and note the wording defect."
EVIDENCE: Bare `node scripts/palette.mjs --scheme both` → **exit 1**, `palette.mjs: missing --seed (hue 0-360 or #hex)` — the wording defect reproduces exactly. The documented project invocation (`mocks/verify.sh:23`) is `--seed 263 --chroma muted --harmony analogous --scheme both` → **exit 0, FAIL lines = 0, stderr 0 bytes**.
VERDICT: **PASS** (scored against the documented invocation; wording defect confirmed and noted)

### DW-3.2
PREMISE: "`--neutral-1`…`--neutral-12` and `--accent-1`…`--accent-12` in both schemes; all 13 semantic aliases resolve; functional colors `--error/success/warning/info-3/9/11` defined."
EVIDENCE: `verify.sh` DW-3.2 — light **58 tokens, 12+12 ramp + 12 functional + 13 aliases → missing none**; dark identical. Independently resolved from the live DOM in both schemes: `--error-3 #ffebe9 / --error-9 #c56c65 / --error-11 #86534f`, `--success-3 #e6f6e6 / -9 #84cc86 / -11 #486e49`, `--warning-3 #f6f0e4 / -9 #ceb47e / -11 #6f6144`, `--info-3 #e7f2fa / -9 #7aabce / -11 #4c677a` (light); dark twins all resolve (`--error-11 #e0a7a1`, `--success-11 #9bc49b`, `--warning-11 #c5b696`, `--info-11 #9fbcd1`).
VERDICT: **PASS**

### DW-3.3
PREMISE: "Pairs `palette.mjs` does not verify, measured independently in both schemes: `--error-11`, `--warning-11`, `--success-11`, `--info-11` on `--surface` AND `--surface-hover` ≥ 4.5:1 · `--text-secondary` on `--surface-hover` and `--surface-active` ≥ 4.5:1 · `--accent-solid` on `--background` ≥ 3:1 non-text. Every status pill measured **from painted pixels**, including under a translucent scrim."
EVIDENCE: My own WCAG computation on browser-resolved values, not the project's script —
*light:* error-11/surface **5.92**, warning **5.74**, success **5.53**, info **5.65**; on surface-hover **5.48 / 5.31 / 5.12 / 5.22**; text-secondary on surface-hover **5.28**, on surface-active **4.90**; accent-solid on background **5.51**.
*dark:* **8.54 / 8.79 / 9.00 / 8.86** on surface; **7.74 / 7.97 / 8.16 / 8.03** on surface-hover; text-secondary **7.93 / 7.15**; accent-solid on background **3.32** (≥3:1 non-text).
Every value clears its floor; the tightest is 4.90 against 4.5. Painted-pixel and scrim coverage is `colorcheck.py` — **69 assertions, all pass**; the assistant scrim resolves to `oklch(0.300 0.006 258 / 0.06)`, i.e. the specified `.06` alpha, hue-tinted rather than pure black.
VERDICT: **PASS**

### DW-3.4
PREMISE: "The dark ramp activates under the project's `.dark` class variant — verified by rendering."
EVIDENCE: Rendered with `document.documentElement.classList.add('dark')` and re-read the computed cascade: `--background` `#fcfdfd → #121313`, `--surface` `#f8f9fa → #19191a`, `--text-secondary` `#60636a → #b4b7be`, `--focus-ring` `#4466ac → #a0b8e6`, `--gradient-action` inverts to a light ramp. `v2-dark.png` confirms visually. The generator's `[data-theme="dark"]` output is bridged (DESIGN.md § The `.dark` bridge).
VERDICT: **PASS**

### DW-3.5
PREMISE: "Type scale `--text-xs`…`--text-4xl` with `--font-body` and `--font-display`; `## Type` states ratio, base px, steps, leading, weights — **and those statements must match what renders.**"
EVIDENCE: All nine steps resolve, rem-based: `0.640625 / 0.71875 / 0.8125 / 0.90625 / 1.03125 / 1.15625 / 1.296875 / 1.46875 / 1.640625rem` = 10.25 / 11.5 / 13 / 14.5 / 16.5 / 18.5 / 20.75 / 23.5 / 26.25 px at a measured 16 px root — matching the § Type table row for row, ratio 1.125 off a 13 px base. `--font-body` and `--font-display` both resolve to `'Geist Variable', …`. Rendered leading for 13–16 px text across all three mocks, both schemes: exactly **{1.25, 1.4}** — inside the required 1.2–1.4 and matching the stated 1.4 body / 1.25 UI. Rendered weights: exactly **{400, 450, 500}** — **no 600 anywhere**, matching the "600 and above never appear" claim. Only two text families render (Geist Variable + Geist Mono, mono excluded); the `Times New Roman` computed style I found belongs solely to `<title>` and `<style>`, which paint nothing.
VERDICT: **PASS**

### DW-3.6
PREMISE: "Primary face is none of Inter / Roboto / Open Sans / Arial / Space Grotesk, installs from `@fontsource-variable/*`, with a justification tying letterform to the comps."
EVIDENCE: Rendered `font-family` on every text element is `"Geist Variable"` — none of the banned five. `verify.sh` resolves `@fontsource-variable/geist` → **HTTP 200**. Justification is measured from the shipped file, not asserted: x-height 0.530 em against 0.710 em cap (unitsPerEm 1000), giving a 6.9 px x-height at the 13 px row-name anchor, with the continuous 100–900 `wght` axis being what makes the 400/450/500 ladder possible at all.
VERDICT: **PASS**

### DW-3.7
PREMISE: "Accent contains none of `#6366F1`, `#8B5CF6`, `#A855F7`; palette is neither cyan-on-dark nor purple-to-blue."
EVIDENCE: `--accent-solid` = `--accent-9` = **`#4466ac`**, a muted navy; `--accent-11` `#4e638c` light / `#a0b8e6` dark. None of the three banned literals appears in the token file or any mock (`verify.sh`: "files containing a banned literal: 0"). Rendered, hue appears on **one** solid fill (the assistant orb) plus the four functional status tints — no cyan-on-dark ambience, no purple→blue gradient; every gradient in the build (`--gradient-action`, the 17×17 mark) is achromatic graphite/light and derived from `--neutral-12`.
VERDICT: **PASS**

### DW-3.8
PREMISE: "DESIGN.md carries all 10 template sections, `**Status:** confirmed`, and a `**Pins:**` line."
EVIDENCE: `## `-level sections = 10 (Direction, Signature move, Expressive moments, Type, Color tokens, Interaction states, Space shape depth, Motion, Never, Open questions) plus the header block. Line 2: `**Date:** 2026-08-18 · **Status:** confirmed`. Line 7: `**Pins:** family=… discipline=… hue=263 … chroma=muted … signature=accent-scarcity`.
VERDICT: **PASS**

### DW-3.9
PREMISE: "`## Never` names the **uniform-padding** form of `nested-cards` plus ≥2 further tells scoped to this DNA, and explicitly **permits** the comps' inset-well surface."
EVIDENCE: § Never item 1 is "Nested cards **in the uniform-padding form**", followed by "**Explicitly permitted, and required:** the comps' **inset-well** surface — a raised card containing a *recessed* panel at a different inset (7px), a different fill … and a different radius (7 inside 10)". `verify.sh`: "named tells: 10 · uniform-padding form: yes · inset well permitted: yes". Container-level verification of the detector's 18 hits (finding 7) confirms the ban is scoped correctly in the render, not just in prose.
VERDICT: **PASS**

### DW-3.10
PREMISE: "Shipped `--radius`, spacing, and shadow values differ from shadcn's defaults; no shadow uses pure black."
EVIDENCE: Radius measured on rendered elements: mark **4.6px**, tile **5.5px**, well **7px**, control **8px**, card **10px**, panel **14px**, pill 999 — against shadcn's 4/6/8/12 off `--radius: 0.5rem`; five of six members and the cardinality differ. Spacing 4/7/11/14/18/21/25/32 — not a 4px ladder. Every rendered shadow tints from `--neutral-12`, e.g. the stat card paints `oklch(0.300347 0.00609613 258.468 / 0.055) 0 1px 2px` and the tile `oklch(… / 0.1) 0 1px 2.5px, oklch(… / 0.055) 0 0 0 0.5px`; **zero pure-black values** in tokens.css or in any mock `box-shadow`. Five distinct depths, so alpha is not one repeated value.
VERDICT: **PASS**

### DW-3.12
PREMISE: "Status chips use only the four functional hues; any non-status accent is visibly distinct from all four. Status stays legible **with hue removed**. Saturated colour only on chips, badges, and small marks."
EVIDENCE: Rendered chips carry a glyph *and* a word, not colour alone — `↑ needs you`, `• working`, `× error`, `‖ idle`, `‖ paused` — so the state survives desaturation; `statuschips.py` and `colorcheck.py` (69 assertions) gate this. The non-status accent is graphite `--neutral-12` (`#2c2e31` light / `#e6e8ec` dark) for the primary action and marks — achromatic, therefore distinct from all four hues by construction; the one chromatic accent, `#4466ac`, appears as a solid fill on exactly one surface (the assistant orb). Confirmed in the pixels: on the fleet board the only saturated regions are the five status pills and the `6` count pill — everything else, including the 189×36 primary CTA, is achromatic.
VERDICT: **PASS**

### DW-3.13
PREMISE: "`mocks/fidelity.py` exits 0. **Proxies are not box geometry** — `stat_run_w` reads 264 where the stat card box is 280, and `stat_run_gap` reads 30 where the CSS gap is 14 … Never reconcile these against the measured-reference table."
EVIDENCE: `verify.sh` DW-3.13 → **PASS**, `fidelity.py` exit 0. I did not reconcile the painted-run proxies against the reference table. Independently, the box geometry itself matches the reference: stat card **281×90 r10** (280 spec, 1 px grid rounding at 1440), well **267×76 r7 at 7 px inset**, icon tile **24×24 r5.5** with a two-part tile shadow, row mark **17×17 r4.6** carrying `linear-gradient(oklch(… / 0.22), oklch(… / 0.06))` with a pale glyph, table panel r14, sidebar **228**, content pad **25 left / 21 right**, header band 32, row pitch 44.
VERDICT: **PASS**

### DW-3.13b
PREMISE: "**AA beats fidelity where the comp is wrong** — the reference's `#838383` on `#F1F1F1` is 3.36:1; such inks are judged on their own AA ratio and reported as accepted deviations."
EVIDENCE: `verify.sh` prints the deviation rather than hiding it: `band_label_ink #838383 → #646464 −31L ok **AA 5.24:1 on #F1F1F1 (ref 3.36:1 — below 4.5, override)**`. The shipped ink clears AA; the comp's does not; the divergence is reported, not silently matched.
VERDICT: **PASS**

### DW-3.13c
PREMISE: "The three mocks carry **zero raw hex** and `fidelity.py` still exits 0."
EVIDENCE: `verify.sh`: `v2-fleet.html: 0 raw hex · v3-assistant.html: 0 raw hex · v4-transcript.html: 0 raw hex`. Independently confirmed by scanning `document.documentElement.innerHTML` on each rendered page — **0 hex literals** on all three. `fidelity.py` exit 0.
VERDICT: **PASS**

### DW-3.14
PREMISE: "The primary action is not flat — top-highlight gradient — and the border scale stays **graded** (three distinct values)."
EVIDENCE: The 189×36 CTA renders `background-image: linear-gradient(oklch(0.375347 …), oklch(0.288347 …))` — a lighter top stop over a darker bottom — plus `box-shadow: oklch(0.255347 …) 0 -1px 0 inset, oklch(… / 0.1) 0 1px 2px`. `background-color` is `rgba(0,0,0,0)`: there is no flat fill underneath. It inverts correctly in dark (`0.910605 → 0.950605`). Borders resolve to **three distinct painted values** — `--border-hairline` **#ecedf1**, `--border-divider` **#e9eaee**, `--border-control` **#e6e8ec** (dark: **#2c2d31 / #2e3034 / #393c41**), matching DESIGN.md § Space, shape, depth exactly, and counted in the live DOM as three distinct computed colours (32 / 56 / 32 uses).
VERDICT: **PASS**

**All requirements met:** YES — all 14 done-when items pass on measured evidence.

---

## Notes (non-blocking)

1. **The exemption list is honest, with one gap.** `axischeck.mjs` names screen-reader announcement quality, pointer gestures, window-blur, RTL, print, browser zoom, OS scrollbar width and stateful interaction sequences as uncovered. I checked each against the artifact: no pointer gestures are designed (nothing depends on swipe/pinch), RTL is now run report-only, and the screen-reader carve-out ("asserts names and roles, not the announced experience") is the correct line to draw. The **"stateful interaction sequences cannot be exercised on static mocks"** exemption does **not** cover finding 1, and should not be read as covering it: `label.burger` having `tabIndex = -1` and `#navt` being `display:none` are static properties of the markup, measurable with zero interaction. The real gap is not an exempt axis — it is the **crossing** of two enforced axes (keyboard × width), which the suite tests only independently.
2. **The "browser zoom reduces to the width axis" argument is sound, and it is what makes finding 1 bite.** If 400% zoom really does reduce to 320–390 CSS px, then a desktop keyboard operator at that zoom gets the layout in which navigation has no keyboard opener. The argument is correct; it just points the other way this time.
3. **The permission gate is honest.** Approve and Deny render as measured peers (132×32 desktop, 160×44 / 160×44 at 390) and are opposite in kind rather than in size — the grant is the raised graphite action, the refusal its recessed inverse, still distinct in greyscale. The disclosure states machine, path, network, undo and future scope before the buttons, and the permission-widening control ("Always allow `rm -rf` in ~/cockpit") is deliberately the quietest control on the surface with its consequence spelled out beneath it. No deceptive pattern; nothing nudges the operator toward granting.
4. **Distinctiveness (ai-tells CHECKER) passes.** The direction names in three words: *recessed-well ledger*. The choice a generic system would not make is present and load-bearing — a card that contains a hole (7 px inset, page colour showing through, 7 inside 10 radius), a 2.27% hue budget with the loudest colour in the product being an amber status chip, an asymmetric 25/21 content padding, a non-4px spacing ladder, a 13 px base anchored to the densest real text rather than to body copy, and a motion vocabulary in which only the live channel moves. This is not on-pattern safety.
5. Finding 3's underline is the one thing in the render that reads as unowned rather than chosen, which is why it is Major rather than Minor despite being a single CSS declaration.

---

## Issues (FAIL)

1. **Navigation drawer is keyboard-inoperable and the off-canvas sidebar stays tabbable** — Critical / usability / WCAG 2.2 SC 2.1.1, 2.4.7, 2.4.11, 1.4.10 / Promote `label.burger` to `<button aria-expanded aria-controls>`; mark `aside` `inert` while closed; assert the tab walk at 390 and 320 in `axischeck.mjs`.
2. **DESIGN.md § Interaction states overstates keyboard coverage** — Critical / content-design / honest-artifact / The "focus ring on **every** interactive affordance" and "zero unreachable pointer affordances" claims were measured at the one width where the failing control is `display:none`. Fix issue 1, then re-measure and restate.

**Verdict: FAIL — blockers: (1) navigation unreachable by keyboard at ≤768 px with 19 off-screen tab stops; (2) the DESIGN.md keyboard claim that contradicts it.**

Everything the phase set out to prove — 14/14 done-when items, the token system, the colour contract in both schemes, the type ladder, the fidelity gate, the identity — holds on measured evidence. The blocker is one control and one sentence.
