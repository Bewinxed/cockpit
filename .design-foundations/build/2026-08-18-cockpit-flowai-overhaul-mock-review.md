# Design Review: Cockpit / Outpost overhaul — mock gate

Reviewed 2026-08-18. Dual-blind: Assessment A (cross-pillar critique) frozen before Assessment B (detector) was opened.

## Rendered Evidence (Step 0)

- Screenshots read directly:
  - `/home/bewinxed/cockpit/mocks/session-fleet-board.png`
  - `/home/bewinxed/cockpit/mocks/session-transcript.png`
  - `/home/bewinxed/cockpit/mocks/session-transcript-top.png`
- Sources: `/home/bewinxed/cockpit/mocks/session-fleet-board.html`, `/home/bewinxed/cockpit/mocks/session-transcript.html`
- `DESIGN.md` / `JOURNEY.md` at project root: confirmed absent (`ls` exit 2). Wireframe register.
- **Pixels re-measured, not eyeballed.** Both pages were re-rendered over CDP against the live debug browser at `http://localhost:9222`, viewport set to **1600×1000** (matching the screenshots' 3200×2000 @2×), and probed for computed geometry, computed colour, and contrast. Every number in this report is a measured value, not an estimate.
- Build-agent intent comments are present in both HTML files. They were **not** treated as evidence; every claim below was re-derived from the rendered DOM.

## Assessment B — Deterministic Detector

- Command: `node /home/bewinxed/.claude/plugins/cache/rtd/design-for-ai/4.2.0/scripts/detect.mjs /home/bewinxed/cockpit/mocks/session-fleet-board.html /home/bewinxed/cockpit/mocks/session-transcript.html > /home/bewinxed/cockpit/.design-foundations/build/detect.json`
- Exit: **0 (ran)** · `"status": "ran"` · 16 rules
- Findings: **80** — `nested-cards` ×77 (high), `em-dash-overuse` ×2 (medium), `numbered-section-markers` ×1 (advisory)
- Opened only after Assessment A findings were frozen: **YES**

## Triage

- **Baseline (always-on):** visual (design-dna + checklists + ai-tells CHECKER), usability (Nielsen 10 + severity scale)
- **Dispatched:**
  - `content-design` — real product copy is load-bearing: consent copy, error strings, empty/unreachable states, button labels
  - `deceptive-patterns` — the surface contains a consent/approval card; the requirements explicitly test for preselection, autofocus, countdown, auto-approve
  - `journey` — two pages in a route sequence (`/session` → `/session/[id]`) with a back affordance and persistent chrome
- **Deferred (cap):**
  - `data-viz` — only one encoding surface (the usage bullet meter) and a tabular fleet listing; no chart surface worth a full pass. The meter is covered under the visual baseline.
  - `behavioral` — no conversion, pricing, retention, or upsell mechanics. This is an operator tool, not a funnel. No signal.
- **Not applicable:** design-systems (no token contract exists to audit against — DESIGN.md absent by design).

---

## Cross-Pillar Findings (ONE ranked report)

| Severity | Pillar | Problem (in the rendered pixels) | Principle | Fix |
|----------|--------|----------------------------------|-----------|-----|
| **Major** | usability / visual | **Peek pane has a 306.6px trailing void.** `aside.panel` measures y 73→984 (h 911px) but its content `.peek-b` ends at y 677.4 — **34% of the bordered container is empty white**. The primary CTA "Open session" is stranded mid-panel at y 612.4–677.4 instead of anchored at the pane foot. Cause: `.peek-b` has no `flex:1 1 auto`, so it does not fill its flex-column parent. | Gestalt closure — a drawn border promises its bounds are its content; Nielsen #8 aesthetic and minimalist design | `.peek-b{flex:1 1 auto}` so the footer pins to the panel foot; or let `.peek-x` absorb the slack and put an empty state in it. |
| **Major** | usability / data-density | **Session titles render up to 4× on one 1600×1000 viewport.** Measured occurrences: `wire delegate row outcomes` → rail, needs-you, tree, peek (**4×**); `flaky ws reconnect` → 3×; `tmux keybinds` → 3×; all 6 sessions ≥2×. Worse, all three `.att-row`s in "Needs you" repeat **near-verbatim** in the Fleet tree directly beneath them **in the same column** — identical title, identical command string, identical status pill, identical age; only the third column (location vs harness) and the action button differ. | Tufte — data-ink ratio and redundant encoding; Nielsen #8 | Collapse "Needs you" into a pinned/filtered state of the tree, or reduce it to a count + the action buttons, so the operator scans each session once. |
| **Major** | usability / a11y | **The transcript page has zero headings.** `h1–h6` count = **0** on `session-transcript.html`. The fleet board has four (`H2 Needs you`, `H2 Fleet`, `H2 Peek`, `H3 Last activity`). The longer, denser, scrolling page — the one where heading navigation matters most — has no document outline at all. | WCAG 1.3.1 Info and Relationships; WCAG 2.4.6 Headings and Labels; Nielsen #4 consistency and standards | `h2` on the session header, `h3` on each turn and on each human-in-the-loop card. |
| **Major** | usability / deceptive-patterns | **The permission-widening control sits within slip distance of Approve.** Measured: `.card-actions` bottom y 768.7 → `.card-more` top y 778.7 = **10px**, then a hairline rule + 12px padding; "Always allow `rm -rf` in `~/cockpit`" lands **~23px** below Approve, in the same outlined `.btn` idiom, differing only 34px→30px in height and 12px→11px in type. It is also **after Approve in tab order**. Page A enforces the same rule twenty times harder: Interrupt run (y 392.4) → Open session (y 629.4) = **205px** plus two rules and an intervening content block. The blanket grant is the least reversible control on the surface. | Fitts's law (1954) — near-zero travel cost to a high-cost target; Nielsen #5 error prevention; Nielsen #4 consistency (same rule, two magnitudes) | Move the widening option behind a disclosure, or separate it by ≥1 content block as page A already does. |
| **Major** | usability / a11y | **No live regions anywhere.** `[aria-live]`, `role=status`, `role=alert` count = **0** on both pages. Status pills flip idle → working → needs you and nothing is announced. The entire premise of this product is "an agent is blocked and needs you"; a non-visual operator is never told. | WCAG 4.1.3 Status Messages (AA) | `role=status` on the "! 2 blocked" counter and on each HITL card as it enters. *(Beyond the listed DW, which cites 1.4.1 — a finding, not a blocker.)* |
| Minor | visual / consistency | **Container idiom differs across the two pages.** Page A is panel-on-canvas: `.panel` (1px `#e0e0e0`, radius 6px, header band on `#f5f5f5`) floating on a `#f5f5f5` board with 16px gutters. Page B is full-bleed white with no canvas and no panel; its only container is `.card` (1.5px `#212121`). Verified by CSS diff: **42 classes are shared byte-identically** (rail, chrome, jump, kbd, nav-i, live-i, all four pills, mark, all four btn variants, counter, the entire usage meter, dot, meta, trunc, num, mono, spacer, wordmark, conn — the 9 flagged "diffs" were trailing-semicolon noise, plus `.app` legitimately gaining two grid rows for the session header and composer). The vocabulary holds; the container level does not. | Nielsen #4 consistency and standards | Defensible (listing surface vs reading surface) — decide explicitly in DESIGN.md rather than by omission. |
| Minor | content-design | **Error rows state cause but not recovery.** "error — hub dropped the socket at 14:02, 4 retries failed" and "hetzner-01 · linux · last seen 3h ago [✕ unreachable]" both diagnose precisely and then offer only a generic "Open". | Nielsen #9 — help users recognize, diagnose, and **recover** from errors; Redish, plain language | Add the recovery verb to the row: "Retry", "Reconnect hub". |
| Minor | content-design | **Two voices for one state.** The same blocked session reads "approve — `rm -rf …`" in the Needs-you queue and "waiting on you — approve `rm -rf …`" in the tree. | Nielsen #4 consistency | Pick one state grammar. Folds into the duplication finding above. |
| Minor | a11y / content | **Truncation with no recovery.** Rail item "wire delegate row outcomes" is clipped 13px (scrollWidth 186 vs clientWidth 173) with no `title` and no `aria-label`. Both pages. | WCAG 1.4.13 / progressive disclosure | `title` on `.trunc`. |
| Minor | journey | **Back affordance is a bare glyph.** The transcript header's return control renders as "←" with no visible label (it does carry an accessible name — nameless-button count = 0). | Nielsen #6 recognition rather than recall | Label it "Fleet" or give it a tooltip. |
| Minor | usability | **Composer is `div[role=textbox] tabindex=0`**, not a `textarea`, and carries neither `contenteditable` nor `aria-multiline`. Acceptable in a wireframe; flagging so it does not survive into build. | WCAG 4.1.2 Name, Role, Value | Use a real `textarea` in production. |
| Minor | detector | `em-dash-overuse` — *"9 em-dashes in body copy"* (fleet), *"5 em-dashes in body copy"* (transcript). **Register-justified.** Inspection of the rendered copy shows these are a systematic `<state> — <detail>` delimiter grammar ("approve — `rm -rf …`", "idle — last output 40m ago", "Permission — run a shell command"), not the rhetorical mid-sentence dash the rule targets. Exactly **one** rendered instance is prose ("…transport state — the run result lives on `delegate.result.kind`") and that string is diegetic simulated agent output, not product voice. Downgraded from medium. | ai-tells.md em-dash rule vs. register | Optional: the surface already uses `·` as a peer separator ("linux · 2 folders · 4 sessions"); consider whether the two separator glyphs earn their split. |
| Note | detector | `nested-cards` ×77 — *"`<button class=\"btn\">` is a card inside a card ancestor"*, *"`<span class=\"kbd\">` is a card inside a card ancestor"*, *"`<span class=\"card-warn\">` is a card inside a card ancestor"*. **False-positive cluster; contradicted by measurement.** The rule flags buttons, status pills, avatar marks, keycaps, panel header bands, and — via substring match on the `card-*` naming convention — plain unstyled spans (`card-warn` is 11px grey text with no border and no background). An independent rendered-DOM enumeration restricted to *container* elements carrying ≥3 borders, or a radius plus a non-white fill, found **zero** nesting: `section.panel → inner: []`, `aside.panel → inner: []`, `section.card → inner: []` on both pages. | Detector supplies evidence; the register/severity model supplies judgment | No change. Optionally rename `card-*` internals to avoid tripping name-based matchers. |
| Note | detector | `numbered-section-markers` (advisory) — *"decorative sequence: 01, 02, 06, 11, 12"*. **False positive.** These are data, not section numbering: `hetzner-01` (hostname), `14:02` / `14:06` (timestamps), `$4.12`, `12m`. | — | No change. |

### Distinctiveness (ai-tells.md CHECKER mode) — PASS

Direction is nameable in three words: **hairline operations console** — a greyscale terminal ledger. Choices a generic system would not make, each verified in the rendered output:

1. The usage meter is a **Tufte bullet graph**, not a progress bar, donut, or gauge: `.usage-fill` at 37% with `.usage-target`, a 1.5px ink tick at `left:80%` marking the alert threshold — and it carries `role="img"` with the label *"18.40 dollars of a 50 dollar daily cap; alert threshold at 40 dollars."*
2. Status runs on a **four-step border-weight/fill ladder** rather than hue chips: transparent + hairline outline (idle) → grey fill + hairline (working) → white + 1.5px ink border (error) → solid ink fill (needs you).
3. Selection is an **`inset 3px 0 0` ink bar** (`rgb(66,66,66) 3px 0px 0px 0px inset`) — not a highlighted or elevated card.
4. A **deliberate refusal to box**: `.card-cmd` is a 2px left rail rather than a filled `<pre>`; rows are hairline-separated, never boxed.
5. Restraint census: **zero gradients, zero drop shadows** (the only two `box-shadow` values on the page are the inset selection bars), three radii total (4px / 6px / 999px), tabular numerals, mono ligatures disabled.

The generic output for this brief is rounded shadowed cards in a three-column grid with blue/green/red status chips. This surface is the inverse on every axis. Not competent-but-generic.

---

## Requirement Fulfillment

### DW-MOCK.1
**PREMISE:** "the mock renders a viewable surface for each named page."
**EVIDENCE:** Both pages render. `session-fleet-board.html` → 246 visible elements, 24 interactive, 2094 text chars at 1600×1000, screenshot at `mocks/session-fleet-board.png`. `session-transcript.html` renders with `.app` grid `57px 41px 796px 106px`, screenshots at `mocks/session-transcript.png` (pinned to the live approval card) and `mocks/session-transcript-top.png` (head of thread, via the `?top=1` branch). Both are fully populated with realistic content, not lorem.
**VERDICT:** PASS

### DW-MOCK.2
**PREMISE:** "this is a WIREFRAME — DESIGN.md does not exist at the project root. Verify greyscale structure is sound and that no brand tokens, hues, or typeface choices have been invented. Contrast on rendered pixels must hold."
**EVIDENCE:**
- *No DESIGN.md:* confirmed absent at root (`ls` exit 2), as is JOURNEY.md.
- *No hue invented:* the complete colour census across both files is 9 hex values — `#ffffff #f5f5f5 #ebebeb #e0e0e0 #bdbdbd #9e9e9e #616161 #424242 #212121`. Every one has R=G=B. Zero `rgb()`/`hsl()`/`oklch()`/`lab()`/`color-mix()` declarations; zero gradients (`backgroundImage` census returned empty). The `:root` token block is **identical across both files** apart from `--peek-w`, which exists only on the page that has a peek pane.
- *No typeface invented:* two stacks only — `system-ui, -apple-system, "Segoe UI", sans-serif` and `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`. No `@font-face`, no webfont link. (A `"Times New Roman"` entry surfaced in the computed-style census; traced to `html`/`head`/`meta`/`title`/`style` only — **zero rendered pixels**. Not a defect.)
- *Contrast holds:* every distinct foreground/background/size/weight combination on both pages was computed against its effective (alpha-resolved, ancestor-walked) background. **Zero failures.** Worst case is **5.20:1** (`#616161` on `#ebebeb`, 12px/600 — needs 4.5); best is 10.05:1 (white on `#424242`). Every text element clears WCAG AA 1.4.3.
- *Structure sound:* 0 interactive targets below 24×24px on either page; 0 nameless buttons; landmarks present (`nav[Workspace]`, `main`, `header`, `footer`, `aside`); the usage meter carries `role="img"` with a full text alternative.
**VERDICT:** PASS *(with the transcript's zero-headings gap logged as a Major finding — a structural completeness issue, not an invented-token or contrast violation)*

### Additional-1 — Two pages, two density scales, ONE structural language
**PREMISE:** "Two pages, two density scales, ONE structural language. Verify the density delta is real and measurable, and that the two pages do not diverge structurally beyond density."
**EVIDENCE:** The delta is real and **2.6×** at the row level, measured on rendered rects:

| Measure | Page A content zone | Page B content zone |
|---|---|---|
| Row pitch (measured) | `.tree-session` **62.5px**, `.att-row` **62.5px** | `.tr` **24.0px** |
| Computed font-size / line-height | 14px / 21px | 13px / 18.2px (12px on tool rows) |
| `--row-min` | 2.5rem (40px) | 1.5rem (24px) |
| `--row-py` | .625rem (10px) | .25rem (4px) |
| `--pad` | 1rem (16px) | .625rem (10px) |
| `--lh` | 1.5 | 1.4 |

The ramp is applied via a single `.density-compact` class scoped to `.sess-h`, `main.transcript` and `footer.composer`. Critically, the **rail is identical on both pages** — `.nav-i` pitch **33.0px** and `.live-i` pitch **30.0px** measured on *both* — so the delta is scoped to the content zone rather than being a whole-page divergence. Structural language: a CSS-rule diff of the 42 shared classes found the bodies byte-identical apart from trailing-semicolon noise and `.app`'s grid rows (`auto 1fr` vs `auto auto 1fr auto` — the transcript legitimately adding a session-header row and a composer row). Route-specific classes (`.panel/.tree-*/.peek-*` vs `.card/.turn/.tr/.composer`) are distinct components, not competing versions of one component. One divergence stands: the container idiom (panel-on-canvas vs full-bleed) — logged Minor.
**VERDICT:** PASS

### Additional-2 — Approve/Deny symmetry
**PREMISE:** "The permission/approval card's Approve and Deny controls must be symmetric — equal visual weight, equal size, neither preselected nor autofocused, no countdown or auto-approve."
**EVIDENCE:** Measured on the rendered permission card, both buttons: width **128.0 / 128.0**, height **34.0 / 34.0**, same y **734.7**, background `rgb(255,255,255)` / `rgb(255,255,255)`, border-width `1px` / `1px`, border-colour `rgb(189,189,189)` / `rgb(189,189,189)`, colour `rgb(33,33,33)` / `rgb(33,33,33)`, font-weight `600` / `600`, font-size `12px` / `12px`, class `btn` / `btn`. **Pixel-identical.** `tabindex` null on both; `autofocus` false on both; document-wide `[autofocus]` count = **0**; `document.activeElement` = `BODY`. The single inline `<script>` on the page sets `scrollTop` only (with a `?top=1` escape hatch) — no timer, no focus call, no preselection. No countdown element, no auto-approve. Deceptive-patterns pass: no "Recommended" badge, no dimmed Deny, no confirmshaming, and the widening option is labelled with its own downside ("Widens future permissions for every session in this folder, on every machine. Reviewable under Rules.") rather than sold as "Don't ask again". The persuasion is honest.
**VERDICT:** PASS

### Additional-3 — Composer and Stop as fixed anchors; Stop reachable during approval
**PREMISE:** "The composer input and the Stop control must be fixed anchors, and Stop must remain reachable while an approval card is displayed."
**EVIDENCE:** `.app` computes `grid-template-rows: 57px 41px 796px 106px`; `body` is `overflow:hidden`, `height:1000px`. `main.transcript` is the **sole** scroll container (`overflow-y:auto`, `scrollHeight 1232 > clientHeight 796`) — chrome, session header and composer are grid rows outside it, which is a structurally stronger anchor than `position:fixed`. Stop measured at **y 958.0, bottom 992.0, in-viewport true at `scrollTop = 0`** and at **y 958.0, bottom 992.0, in-viewport true at `scrollTop = max`** — byte-identical, it does not move. Composer at y 903.0, h 52.0, in viewport. The live permission card occupies y 540.9→**850.1**, ending 52.9px above the composer — **no overlap, no occlusion**; both are simultaneously visible in `session-transcript.png`.
**VERDICT:** PASS

### Additional-4 — Destructive actions spatially separated from primary actions
**PREMISE:** "Destructive actions must be spatially separated from primary actions."
**EVIDENCE:** Two instances, honoured at two very different magnitudes.
- *Page A (met, strongly):* "Interrupt run" at y 392.4 (h 32, w 105, white bg, outlined) and the primary "Open session" at y 629.4 (h 32, w 286, filled `rgb(66,66,66)`) — **205.0px** apart, with the LAST ACTIVITY excerpt block and two hairline rules between them, and differentiated by fill and width as well as distance.
- *Page B (met only weakly):* Approve bottom y 768.7 → `.card-more` top y 778.7 = **10px**, then a hairline plus 12px padding; the blanket grant "Always allow `rm -rf` in `~/cockpit`" lands ~23px below Approve and *after it in tab order*, in the same outlined `.btn` idiom (30px vs 34px height, 11px vs 12px type).

Separation is genuinely present on page B through three channels — a divider rule, a size/type step-down, and an adjacent explicit warning — so this is not a clean violation of the stated requirement. But at 23px versus page A's 205px, the same rule is enforced an order of magnitude more weakly on the surface where the payload is `rm -rf` and the grant is the least reversible control present.
**VERDICT:** PARTIAL *(see Major finding #4 — the highest-value fix on this surface)*

### Additional-5 — No nested cards
**PREMISE:** "No nested cards (a card wrapping another card)."
**EVIDENCE:** Every `div/section/article/aside/main/header/footer/ul/ol/li/form/dl/nav/p` on both rendered pages was enumerated and tested for card-ness (≥3 borders, or ≥1 border plus a radius plus a non-white fill), then each qualifying box was tested for qualifying descendants. Result — fleet board: `section.panel → inner: []`, `section.panel → inner: []`, `aside.panel → inner: []`. Transcript: `section.card → inner: []`, `section.card → inner: []`, `div.composer-in → inner: []`. **Zero nesting on either page.** The detector's 77 `nested-cards` hits resolve to buttons, pills, marks, keycaps, panel header bands, and substring matches on the `card-*` naming convention (including `card-warn`, an unstyled grey span) — see the Note row above.
**VERDICT:** PASS

### Additional-6 — Status not by colour alone (WCAG 1.4.1)
**PREMISE:** "Status must not be conveyed by colour alone (WCAG 1.4.1)."
**EVIDENCE:** Satisfied on the strongest possible reading — **hue is unavailable by construction**, since the entire palette is greyscale (all 9 tokens R=G=B), so no status can be hue-coded even accidentally. Beyond that, each of the four states carries three redundant non-hue channels — glyph, text label, and a distinct fill/border/weight signature:

| State | Glyph | Text label | Non-hue signature |
|---|---|---|---|
| idle | `○` | "idle" | transparent bg, 1px `#bdbdbd` border, weight 400 |
| working | `◐` | "working" | `#ebebeb` fill, 1px `#e0e0e0` border, weight 400 |
| error | `✕` | "error" | white fill, **1.5px `#212121`** border, weight **600** |
| needs you | `!` | "needs you" | **solid `#424242` fill**, white text, weight **600** |

Glyphs are `aria-hidden="true"` with the text label carrying the meaning — the correct construction (the glyph is redundant visual reinforcement; the text is the screen-reader truth). The same ladder appears on both pages. Machine reachability follows the same rule (`✕ unreachable` + "last seen 3h ago").
**VERDICT:** PASS

---

**All requirements met:** YES — with Additional-4 rated PARTIAL and five Major findings queued for the build phase.

## Notes (non-blocking)

- **Content design is the quiet strength of this mock and should survive into build verbatim.** The permission card discloses consequence, scope, blast radius and reversibility *before* the decision: "Undo — Regenerated by the next `vite build`. No checkpoint needed"; "Network — No network access requested" (a rare and valuable negative-space disclosure — stating what is *not* happening); "Machine — nixbox — mba-m3 and hetzner-01 are not affected"; "Approving covers this one command. It does not widen what the agent may run later." That is Nielsen #1 (visibility of system status) and #3 (user control and freedom) done better than most shipping products. Button labels are uniformly verb-first and specific — Review, Answer, Open session, Interrupt run, Send answer, Start session, Stop, Mute for 1h — with no Submit/OK/Click here anywhere.
- **Journey continuity verified:** the rail selection (`live-i sel` = "wire delegate row outco…") persists across both pages; the transcript header re-states the exact identity block the peek pane showed (mark, title, `machine : path`, status pill), making peek → open → header a coherent zoom rather than a context switch. The scroll-pinning script is the right call — it puts the blocked-on-you card above the fold on arrival (measured: card bottom 850.1 in a 1000px viewport).
- **`Assessment B` treated as evidence, not verdict.** 77 of its 80 findings are one rule misfiring on a naming convention and on control-vs-container ambiguity. It was still worth running: it is the reason the `card-*` naming and the em-dash delimiter grammar were examined at all, and both examinations produced real (if minor) observations.
- No `## Edge cases` section was supplied in the dispatch prompt, so no edge-case rule applies.
- Measurement caveat: an initial `ui-observer` sweep ran at the debug browser's ambient 1395×819 and surfaced two `horizontal-overflow` hits inside `.att-row` (56px and 25px hidden) that **do not occur at the 1600×1000 screenshot viewport** — at 1600 only the single rail `.trunc` clips. The narrow-viewport clipping is not a finding against these pixels, but it does suggest the attention-row layout wants a responsive check before build.

## Issues (if FAIL)

None blocking. Five Major findings to carry into the build phase, in priority order:

1. **Peek pane 306.6px trailing void** — usability/visual — Gestalt closure, Nielsen #8 — `.peek-b{flex:1 1 auto}`.
2. **Permission-widening control 23px from Approve** — usability/deceptive-patterns — Fitts's law, Nielsen #5 — disclosure or a full content block of separation.
3. **Session titles rendered up to 4× per viewport** — usability/data-density — Tufte data-ink, Nielsen #8 — collapse Needs-you into the tree.
4. **Transcript page has zero headings** — a11y — WCAG 1.3.1 / 2.4.6 — add `h2`/`h3` structure.
5. **No live regions on either page** — a11y — WCAG 4.1.3 — `role=status` on the blocked counter and on each HITL card.

**Verdict: PASS** — no blockers. Contrast holds with zero failures (worst 5.20:1 against a 4.5 floor), the palette is provably greyscale with nothing invented, the density delta is real and measured at 2.6× while 42 structural classes stay byte-identical, Approve/Deny are pixel-identical with no preselection/autofocus/countdown, Stop is immovable at y 958 across the full scroll range and unobstructed by the live approval card, zero nested containers exist on either page, and status is triply encoded without hue. The detector ran cleanly (exit 0) and its high-severity cluster is a demonstrated false positive. The surface has a nameable, non-generic aesthetic direction and passes the distinctiveness criterion.
