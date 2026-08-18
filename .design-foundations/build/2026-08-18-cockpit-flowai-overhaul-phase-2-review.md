# Design Review: Phase 2 — Flows & page specs

Reviewed: `/home/bewinxed/cockpit/JOURNEY.md` — `## Flows` (L94–412), `## Page specs` (L414–665), `## Heuristic findings` (L668–689).
`## Job`, `## Journey`, `## IA` treated as out of scope except where the new sections contradict them (they do not).

## Rendered Evidence (Step 0)
- Screenshot: **none** — spec-only phase, no rendered surface exists. This is expected, not a coverage gap.
- Surface: a 696-line Markdown design spec. Judged as text against its requirements, plus verified against the real codebase at `/home/bewinxed/cockpit/apps/dashboard/src/` and against primary sources on the web.

## Assessment B — Deterministic Detector
- Command: not run.
- Exit: **N/A (no rendered artifact)** — there is no `.html` or mock for this phase to feed the detector. `scripts/detect.mjs` is additionally not present in this repository (`ls /home/bewinxed/cockpit/scripts/detect.mjs` → no such file). Per the no-artifact carve-out this is **N/A, not a skipped detector**, and does not affect the verdict.
- Findings: N/A.
- Opened only after Assessment A findings were frozen: N/A (nothing to open).

## Triage
- **Baseline (always-on):** visual + usability. Visual reduces to document structure and table legibility here (no pixels); usability applies in full — the artifact *is* a usability specification.
- **Dispatched:** `journey` (flows, page specs, IA-derived structure — the artifact's whole subject); `usability` (heuristic evaluation, Nielsen's 10, 0–4 severity, Fitts/Hick).
- **Not applicable:** `data-viz` (no charts encoding numbers — the usage surface is specified but not visualized), `content-design` (the doc explicitly defers microcopy wording to Phase 7 and says so at L689), `behavioral` / `deceptive-patterns` (no persuasion or conversion surface; `## Marketing spine` at L693 is honestly declared N/A for a self-hosted single-operator tool), `design-dna` (no tokens, no type, no color — Phase 3).
- **Deferred (capped):** none.
- **Distinctiveness criterion:** applied and passed. The direction is nameable in three words — *false-confidence-averse fleet triage*. The choice a generic system would not make: making "an empty surface must assert that the connection is live before it is allowed to claim zero" (L114) a cross-cutting law binding all seven Error states, rather than writing seven independent "failed to load" states. Also non-generic: the hub connection band as a required content block on every surface; choosing undo-after over confirm-before for rule deletion (L356, L592) and stating why; and the `0`-rated row (L687) that records a *rejected* finding to exercise the bottom of Nielsen's scale rather than implying everything found was a defect. This is not on-pattern default output.

---

## Cross-Pillar Findings (ONE ranked report)

| Severity | Pillar | Problem | Principle | Fix |
|---|---|---|---|---|
| **Major** | usability | **Heuristic finding rated `2` for empty states misreads the source, and the fix it proposes already exists on the most important surface.** L683 claims "Only `rules` has a designed one (L124 `Nothing is watching yet`…); the rest render blank or near-blank." False: `FleetBoard.svelte` L503–513 is a designed first-use onboarding — comment `<!-- No machines onboarding -->`, heading `No machines yet` (L505), and a copyable join command `COCKPIT_HUB_URL=ws://<this-host>:3456/ws bun run agent` (L510). That *is* the "names the single next action — join a machine" fix the finding proposes. `usage` also has one (`No limit reading yet.` L199) — which this same document quotes approvingly at L401 and L652, contradicting itself. | Heuristic evaluation must rest on the artifact, not recall (`usability` SKILL.md: evidence-grounded findings; Nielsen 1994 severity = frequency × impact × persistence, all three of which this row misestimates) | Rewrite the row: the real defect is that the seven first-use states are *independent and inconsistent*, not absent. Name which surfaces actually lack one (`tools`, `project/[id]`, `rules/[id]`, `session/[id]`), and reframe the fix as unifying the existing `FleetBoard` onboarding copy across them rather than authoring it from nothing. |
| **Major** | usability | **The severity-`4` reconnect-banner finding overstates its own evidence.** L677 asserts a cold load with the hub down gets "**no banner at all** — just the fleet board's `No machines yet` empty state, which reads as 'your fleet is empty'." The gating claim is verified exactly (`Shell.svelte` L139 `if (wasConnected && (cockpit.status === 'disconnected' \|\| cockpit.status === 'error'))`, L136 `wasConnected = true` only inside the `connected` branch). But on `/session` — the surface the finding names — `FleetBoard.svelte` L305–307 renders `{#if cockpit.status !== 'connected'}<span class="text-caption">hub {cockpit.status}</span>` in the page header. The operator sees the words "hub disconnected", not silence. A `4` = "usability catastrophe" rests on a state the finding says does not render. | Nielsen 1994 severity ratings must be defensible against the artifact; N#1 visibility of system status | Keep the finding — the real defect survives and is worth a `3`: no countdown, no `Reconnect now`, only a `text-caption` rather than a banner, and on the four non-`session` routes only an 8px colored dot (`Shell.svelte` L231–232). Cite `FleetBoard.svelte` L305 as the partial mitigation instead of omitting it. |
| **Major** | usability | **The severity-`3` run-progress finding claims an absence that is not absolute.** L678: "no surface carries a determinate reading of a running turn or a signposted interrupt at the board level." `LiveSessionRow.svelte` (rendered by `FleetBoard.svelte` L437) does carry a determinate reading — L116–118 `<TaskRing done={progress.done} total={progress.total} />` plus `{progress.done}/{progress.total}`. An interrupt also exists, on the session surface (`SessionPane.svelte` L985 `handleInterrupt()`, L1746 `label: 'Stop'`). | Evidence-grounded heuristic evaluation; N#1 visibility of system status | Narrow the claim to what is true and still a defect: the board reading is *plan-task* progress gated on `{#if progress}` (only when a plan with tasks exists), not a reading of the running turn; and the interrupt is not reachable from the board. Both are real Tier-4 gaps; state them as such. |
| **Major** | journey | **Pattern derivation runs backwards in several nodes.** The phase constraint requires constraint → law → pattern, and names "a pattern chosen first and justified afterwards" as a defect. At least four nodes invert it by presenting the on-disk implementation as the pattern and then citing the law that blesses it: L190 ("On disk the transcript already does this… the spec keeps it, because…"), L302 ("Two options, and the on-disk shape already matches: `routes/project/[id]/+page.svelte` offers…"), L352 ("The on-disk empty state already works this way and its own comment says so"), L549 ("Tabs are the right pattern here and are kept"). L565 also states pattern → constraint → law in that sentence order. | Phase constraint: constraint names, law selects, then cite. `usability` SKILL.md §B: "let the **principle select the pattern**" | Not a fabrication — every one of these does name a real constraint, and re-deriving a correct incumbent is legitimate. But rewrite the sentence order so the constraint leads, and say explicitly "the law selects X; the on-disk shape already happens to be X" rather than "the on-disk shape is X and the law agrees." The document's own strongest node (Flow 4 L274–276: no browsable index → N#6 recognition-over-recall → promote the rail) shows it can do this. |
| Minor | usability | **"One token language" across the two density scales is asserted, never specified.** L422 heads the section "Two scales, one token language" and L434 states dependents inherit compact, but nothing says what makes the two scales one language — same spacing ramp at different steps? same type scale, different line-height? A later phase authoring DESIGN.md gets a label, not a constraint. | Design-system coherence; the phase constraint requires both scales to *resolve to* the same token language | Add one sentence naming the shared substrate — e.g. "both scales are the same spacing and type ramp sampled at different steps; neither introduces a token the other lacks." |
| Minor | journey | **Two page specs bind hub-error recovery only by inheritance.** `project/[id]` (L525) and `rules/[id]` (L621) say hub `disconnected`/`error` "disables … and says why" without naming the reconnect countdown or the re-enable-on-reconnect behaviour that the other five specs name explicitly. The global rule at L114 does bind every Error state to the four phases and the countdown, so this is covered — but by inheritance a reader may skip. | Nielsen #1 visibility of system status; the phase edge case requires WebSocket drop **and reconnect** in every Error state | Add "…and re-enables on reconnect with the draft intact" to both, matching what Flow 5's own edge case (L369) already says. |
| Minor | usability | **Two line-number citations are off by one to eleven, and two button labels are quoted wrong.** `PermissionCard.svelte`'s `Allow` label is at L168, cited as L167 (L191, L497). `routes/rules/+page.svelte`'s success toast is at L81, cited as L82 (L364, L588); its template loop is L131–150, cited as L140–152 (L360, L586, L683). And `rules/[id]`'s buttons read `Delete rule` and `Save changes` / `Create rule` on disk, quoted as *Delete* and *Save* (L615, L624, L626). | Citation accuracy — a later phase greps for the quoted string | Correct the four line numbers and quote the real labels. |
| Minor | journey | **The sitemap reconciliation's 7 = 7 is arithmetic coincidence presented as a mapping.** L418 pairs "seven sitemap pages" with "seven `+page.svelte` files on disk." The two sets do not correspond: the file set includes `routes/+page.svelte` (renders nothing but a comment) and one `session/[[id]]/+page.svelte` covering two sitemap entries — and `session/[[id]]/+page.svelte` is *also* comment-only (the board renders from `routes/session/+layout.svelte` L102). The paragraph does say "the mapping is not one-to-one and the difference is accounted for," so it is honest, but the count is load-bearing for DW-2.1 and shouldn't rest on a coincidence. | Sitemap ≠ IA (`journey.md` Rules) | State the count as "seven sitemap surfaces, seven specs" and drop the file-count corroboration, or add that two of the seven files render nothing. |
| Note | usability | **"Anything slower than 10 seconds needs a percent-done indicator as well as a clearly signposted way for the user to interrupt the operation" is attributed to "Nielsen 1993, literal" (L110).** The sentence is verbatim correct on the NN/g page, but it sits in the article's "Update added 2014" section, not the 1993 *Usability Engineering* ch. 5 excerpt. | Citation precision | Attribute as "Nielsen, NN/g, 2014 update to the 1993 article." Every other quote in that table is correctly placed in the 1993 excerpt. |
| Note | usability | **The 0–4 scale at L672 is labelled "(Nielsen 1994, verbatim)" but is truncated.** Nielsen's `1` is "Cosmetic problem only: need not be fixed unless extra time is available on project"; the doc gives "Cosmetic problem only." The prefixes are accurate; the word *verbatim* is not. | Citation precision | Drop "verbatim" or restore the full strings. |
| Note | journey | **Scope-widening is absent, not adapted, on a coarse pointer** (L239, L243, L501). The doc argues this is adaptation-to-the-fine-pointer-surface rather than removal-from-the-product, and grounds it in Fitts + error prevention at the journey's peak moment. That reasoning is sound and the constraint's "adapted is fine; removed is not" governs the *primary* action, which is adapted. Recorded so a later phase does not rediscover it as an oversight. | Fitts's law (1954), applied in the high-cost-target direction | No change. |

---

## Requirement Fulfillment

### DW-2.1
**PREMISE:** "`## Page specs` entry count equals the sitemap page count — all 7 surfaces covered."
**EVIDENCE:** The `## IA` sitemap (L76–84) lists exactly 7: `Session`, `Session/[id]`, `Project/[id]`, `Tools`, `Rules`, `Rules/[id]`, `Usage`. `## Page specs` contains exactly 7 numbered entries in the same order: `### 1. session` (L440), `### 2. session/[id]` (L474), `### 3. project/[id]` (L507), `### 4. tools` (L540), `### 5. rules` (L571), `### 6. rules/[id]` (L602), `### 7. usage` (L636). Grep of `**Purpose:**` in the page-specs region returns `7`. Cross-checked against disk: `routes/` contains `project/[id]`, `rules`, `rules/[id]`, `session/[[id]]`, `tools`, `usage` plus a redirect root and an `api/[...path]/+server.ts` with no `+page.svelte` — the seven specs map onto the real route surfaces.
**VERDICT:** **PASS**

### DW-2.2
**PREMISE:** "Every page spec carries all 6 required fields and all 5 named states (Default, Loading, Empty, Error, Success)."
**EVIDENCE:** Literal counts over the `## Page specs` region (L414–end), each returning `7`:
`**Purpose:**` 7 · `**Entry points:**` 7 · `**Content blocks` 7 · `**States:**` 7 · `**Primary CTA:**` 7 · `**Exit / next:**` 7.
State bullets, each returning `7`: `- Default:` 7 · `- Loading:` 7 · `- Empty:` 7 · `- Error:` 7 · `- Success:` 7.
Three project-required extras also present 7/7: `**Density:**` 7 · `**Narrow width:**` 7 · `**Destructive separation:**` 7. Doctrine template (`journey.md` §F) requires exactly the six fields counted.
**VERDICT:** **PASS**

### DW-2.3
**PREMISE:** "Every flow documents Type, Entry, Goal, Steps, Error states, and Success state, plus the edge cases of back-navigation, session expiry, and network failure."
**EVIDENCE:** Six flows (L118 Fleet check-in/wind-down · L165 Triage · L215 Remote approval · L260 Spawn · L327 Rule · L373 Cost check). Literal counts over L94–413, each returning `6`: `**Type:**` 6 · `**Entry:**` 6 · `**Goal:**` 6 · `**Steps:**` 6 · `**Error states:**` 6 · `**Success state:**` 6 · `**Edge cases:**` 6 · `**Back-navigation:**` 6 · `**Session expiry:**` 6 · `**Network failure:**` 6. (`**Loading state:**` and `**Empty state:**` also 6/6, beyond requirement.) Notation is declared at L96 and matches doctrine (`journey.md` §E: circle = entry/exit, diamond = decision, rectangle = action).
**VERDICT:** **PASS**

### DW-2.4
**PREMISE:** "Every decision node cites Hick's law; every primary CTA cites Fitts's law; no page spec places a destructive action adjacent to its primary CTA."
**EVIDENCE:** Decision nodes: 10 `◆` diamonds across the six flow diagrams, and 10 `- ◆` decision-node bullets below them (Flow 1: 2 · Flow 2: 2 · Flow 3: 2 · Flow 4: 2 · Flow 5: 1 · Flow 6: 1). `Hick–Hyman 1952/1953` appears 11 times in the flows region — 10 node citations plus the shorthand definition at L100. One-to-one.
Primary CTAs: `Fitts 1954` appears 8 times in the flows region (6 CTAs + Flow 2 L195 and Flow 3 L243 destructive separations) and 8 times in the page-specs region (7 CTAs + `session/[id]` L497 destructive separation). All 7 spec CTAs cite it: L462, L495, L528, L559, L590, L624, L656.
Destructive adjacency: all 7 specs carry an explicit `**Destructive separation:**` field asserting non-adjacency — L464 (overflow menus, "none adjacent to the primary"), L497 (`Always allow` removed from the answer row; `Deny` at the opposite edge with the gap unfillable), L530 (`Forget project…` in the header, never in the spawn control), L561 (row overflow menu, different region from the panel add-action), L592 (per-row `Delete` in the row body, header primary is `New rule`), L626 (`Delete` at the leading edge with `Cancel` interposed before `Save`), L658 (none, and none may be added). Verified against disk that the L497 separation is a real change: `PermissionCard.svelte` L107 opens `<div class="flex items-center gap-2 mt-3">` holding `Deny` (L125) → `flex-1` spacer (L128) → `Always allow …` (L140, `⇧Y`) → `Allow` (L168, `Y`) — the irreversible grant is currently adjacent to the primary, and the spec removes it.
**VERDICT:** **PASS**

### DW-2.5
**PREMISE:** "Every surface carries an explicit `comfortable` or `compact` density class with a stated rationale."
**EVIDENCE:** The Density classes table (L424–432) carries 7 rows, one per surface, each with a class and a non-boilerplate rationale — e.g. `session` `comfortable` "row pitch has to survive a glance, and the needs-you reading must not depend on close inspection"; `session/[id]` `compact` "the one surface where more turns visible at once is directly more context for the approval decision"; `rules` `comfortable` "rows carry a destructive control — density here buys nothing and costs target separation." Each of the 7 specs also repeats the class in its own `**Density:**` field (7/7 by count). Constraint honored: exactly one surface is `compact`, and it is the transcript (L422 "The plan reserves compact for the transcript and its dependents; that is one surface out of seven"); L434 puts dependents' inheritance on the components, not as a second class on a surface.
**VERDICT:** **PASS**

### DW-2.6
**PREMISE:** "Heuristic findings are a table with exactly the columns `Severity | Heuristic / law | Problem | Fix`, every row rated 0–4, sorted by severity, with the complement caveat stated."
**EVIDENCE:** Header at L674 is literally `| Severity | Heuristic / law | Problem | Fix |` — exactly the four columns doctrine specifies (`usability` SKILL.md §A step 5). Twelve rows, severities in order `4, 4, 3, 3, 3, 2, 2, 2, 2, 1, 1, 0` — descending, all within 0–4. Complement caveat at L670, stated first and at length: "**it is a complement to user testing, not a substitute for it** … The method finds *likely* problems, not their real-world frequency." Scale wording at L672 matches Nielsen's published scale. The single-evaluator caveat is also stated and is verified verbatim against the source: Nielsen, "Severity Ratings for Usability Problems," NN/g, 1 November 1994 — "My experience indicates that severity ratings from a single evaluator are too unreliable to be trusted … using the **mean of a set of ratings from three evaluators** is satisfactory."
**VERDICT:** **PASS**

### DW-2.7
**PREMISE:** "Every Loading state names its feedback tier; no spec prescribes a bare spinner for a load that can exceed 5s."
**EVIDENCE:** All 7 page-spec Loading bullets name a tier: L457 Tier 3→4 · L490 Tier 3→4, run always Tier 4 · L523 Tier 2, spawn Tier 3→4 · L554 Tier 3→4 · L585 Tier 2 · L619 Tier 2 · L651 Tier 3→4. All 6 flow Loading states likewise (L146, L197, L245, L308, L358, L399). Every one of the 13 either says "No spinner", "Never a spinner", or "never a spinner." The blanket rule is at L112: "**A bare spinner is never prescribed anywhere in this document.** It is the named mistake for any load that can exceed 5s." A search for `spinner` across the whole file returns 13 hits: 11 prohibitions, one tier-table note disclaiming the skeleton choice as *not* Nielsen's wording (L109), and one describing the existing on-disk defect being replaced (L490 / heuristic row L684). No prescription anywhere.
Tier boundaries verified against the primary source (Nielsen, "Response Times: The 3 Important Limits," NN/g, 1 January 1993, excerpt from ch. 5 of *Usability Engineering*): all four boundary quotes at L107–110 are verbatim correct, and the article's own reference list confirms Miller 1968 *Proc. AFIPS FJCC* Vol. 33, 267–277 and Myers 1985 *Proc. ACM CHI'85*, 11–17 exactly as cited. (One placement nit — see Notes.)
**VERDICT:** **PASS**

**All requirements met:** **YES**

---

## Edge cases — verification

**EC-1 · Hub-unreachable in every page spec's Error state, covering WebSocket drop and reconnect — HANDLED.** L114 makes this a cross-cutting law and binds it to real code: `client.svelte.ts` L70 `export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';` (verified verbatim on disk), the retry countdown (L303, verified), and `reconnectNow()` (L1115, verified). All 7 specs name hub `disconnected`/`error` in their Error state: L459, L492, L525, L556, L587, L621, L653. The load-bearing rule — "an empty surface must assert that the connection is live before it is allowed to claim zero. A quiet fleet and a dead hub must never render the same" — is the strongest single idea in the document and is enforced per-surface (needs-you count suppressed rather than zeroed, L448/L459; stale-marking rather than blanking on `tools` and `usage`). Two specs bind recovery by inheritance only — Minor above.

**EC-2 · Agent runs exceed 10s+ → determinate progress plus out-of-band notification — HANDLED.** L490: "The *agent's run* after an approval is **Tier 4 (10s+)** always: determinate step-and-count, a Telegram notification when it next needs a human, and a signposted interrupt throughout. Agent runs are open-ended and routinely cross the 10s boundary, so Tier 4 is the normal case here, not the exception." Repeated in Flow 2 (L197), Flow 4 (L308), and as heuristic row `3` (L678). The Telegram bridge is named as the Tier-4 out-of-band channel at L112 and L678. The interrupt requirement traces to a real quote (verified: "Anything slower than 10 seconds needs a percent-done indicator as well as a clearly signposted way for the user to interrupt the operation").

**EC-3 · First-use is the highest-stakes empty type; a fresh install has zero machines and every surface empty at once — HANDLED.** Explicitly named as such at L683 and treated per-surface: `session` distinguishes first-use from user-cleared and gives first-use exactly one action (L458); `project/[id]` states the prerequisite rather than offering a spawn that would fail (L524); `tools` requires the prerequisite **above the tab strip** because only one panel is visible (L555) — a genuinely non-obvious catch; `usage` requires "no machine has reported" to read differently from "reported zero spend" (L652). The unifying rule at L683 — "Seven blank panels read as seven failures; one prerequisite reads as one step" — is the right frame. The finding's *evidence* about which surfaces currently lack one is wrong (Major #1), but the edge case itself is handled.

**EC-4 · Destructive and irreversible actions spatially separated from the primary per Fitts (1954) — HANDLED.** Covered under DW-2.4. All three named examples are addressed by name: interrupt a run (L497 — moves to the run-progress block, not the answer row; L464 — row overflow on the board), delete a rule (L592 — row body vs. header primary, plus undo-after rather than confirm-before), revoke a machine (L464 — per-machine revoke in the row overflow menu). The reasoning is bidirectional Fitts, not just "make the button big": "a high-cost target with near-zero travel cost is itself the hazard" (L195).

---

## Constraints — verification

| Constraint | Status | Evidence |
|---|---|---|
| Compact reserved for the transcript and dependents; both scales resolve to one token language | **Honored** (with a Minor) | L422, L424–432 (one `compact` row of seven), L434 (dependents inherit via components, not a second class). "One token language" is asserted but not specified — Minor above. |
| Every page spec states narrow-width behaviour: what reflows, what collapses, what the primary becomes on a coarse pointer; adapted is fine, removed is not | **Honored** | 7/7 `**Narrow width:**` fields, each naming all three. L468 (rail/roster collapse to a disclosure, primary → thumb-arc full-width, "Nothing is dropped"), L501 (header collapses to one line, transcript relaxes out of compact, primary → full-width `Allow`), L534 (spawn → bottom sheet from the thumb bar), L565 (tab strip → scrollable with the next tab peeking, primary moves into the active panel), L596 (rows reflow one line → two rather than truncating scope), L630 (sections → accordion, action row → sticky with safe-area padding), L662 (table → stacked rows rather than horizontal scroll). Every one states the coarse-pointer primary. |
| Pattern choice runs constraint → law → pattern | **Partially honored** | Major #4 above. The direction is correct in the document's most consequential derivation (Flow 4, L274–276) and inverted in at least four nodes. |
| Loading states obey the feedback tiers | **Honored** | DW-2.7. Tier table L105–110; every tier boundary quote verified verbatim against NN/g. |
| Heuristic evaluation stated as a complement to user testing, not a substitute | **Honored** | L670, stated first and reinforced with the single-evaluator reliability caveat and its structural cause. |

---

## Citation verification (web-verified, not from memory)

Every name/year/title pair in the added sections was checked against a live primary source. **No fabricated, misdated, or misattributed citation was found.**

| Citation | Verdict | Source checked |
|---|---|---|
| Fitts, "The information capacity of the human motor system in controlling the amplitude of movement," *JEP* 47(6):381–391, 1954 | **VERIFIED exactly**, incl. volume, issue, and page range | Ovid/APA PsycNet record: "Journal of Experimental Psychology 47(6):p 381–391, June 1954"; DOI 10.1037/h0055392 |
| Hick, "On the Rate of Gain of Information," *QJEP*, 1952 | **VERIFIED** (vol. 4(1), 11–26, March 1952 — doc gives journal + year only, which is correct as far as it goes) | Sage Journals, DOI 10.1080/17470215208416600 |
| Hyman, "Stimulus Information as a Determinant of Reaction Time," *JEP*, 1953 | **VERIFIED** (45(3):188–196, March 1953) | Europe PMC / PubMed 13052851, DOI 10.1037/h0056940 |
| Two separate papers, commonly paired as "Hick's law" | **VERIFIED** — correctly refuses to collapse them into one author-year | — |
| Nielsen, "Response Times: The 3 Important Limits," NN/g, 1 Jan 1993, excerpt from ch. 5 of *Usability Engineering* | **VERIFIED** — byline reads "January 1, 1993"; article opens "*Excerpt from Chapter 5 in my book Usability Engineering, from 1993*" | nngroup.com/articles/response-times-3-important-limits/ |
| Miller, R. B. 1968, *Proc. AFIPS FJCC* Vol. 33, 267–277 | **VERIFIED** — matches the NN/g article's own reference list character for character | ibid. |
| Myers, B. A. 1985, *Proc. ACM CHI'85*, 11–17 | **VERIFIED** — ibid., "(San Francisco, CA, 14-18 April), 11-17" | ibid. |
| All four tier-boundary quotes (L107–110) | **VERIFIED verbatim** | ibid. |
| Nielsen, "10 Usability Heuristics," NN/g, 24 April 1994 | **VERIFIED** — byline "April 24, 1994" | nngroup.com/articles/ten-usability-heuristics/ |
| Heuristic numbers used: #1 visibility, #3 user control and freedom, #4 consistency and standards, #5 error prevention, #6 recognition rather than recall, #7 flexibility and efficiency, #8 aesthetic and minimalist, #9 recognize/diagnose/recover | **ALL 8 VERIFIED** against the canonical numbered list | ibid. |
| Nielsen, "Severity Ratings for Usability Problems," NN/g, 1 Nov 1994 | **VERIFIED** — byline "November 1, 1994" | nngroup.com/articles/how-to-rate-the-severity-of-usability-problems/ |
| 0–4 scale wording, and "severity ratings from a single evaluator are too unreliable to be trusted" + mean of three | **VERIFIED** (scale prefixes accurate but truncated — Note above) | ibid. |
| Severity = frequency, impact, persistence (L672) | **VERIFIED** — the source lists exactly those three | ibid. |
| WCAG 2.2 SC 2.5.8 Target Size (Minimum), Level AA, 24×24 CSS pixels, W3C Recommendation 12 December 2024 | **VERIFIED on all four points** — the Rec date was the highest-risk item and is correct | w3.org/TR/WCAG22/ ("W3C Recommendation 12 December 2024"; TOC lists "2.5.8 Target Size (Minimum) (AA)"); Understanding SC 2.5.8 ("at least 24 by 24 CSS pixels") |
| Kahneman, Fredrickson, Schreiber & Redelmeier, "When More Pain Is Preferred to Less: Adding a Better End," *Psychological Science*, 1993 | **VERIFIED** — all four authors, that order, Vol. 4(6):401–405, November 1993 | psychologicalscience.org / Sage, DOI 10.1111/j.1467-9280.1993.tb00589.x |

Citations in `## Journey` and `## IA` (Gibbons 2018, Rosenfeld/Morville/Arango 2015, Moesta, McKinsey) were **not** re-verified — those sections are out of scope for this phase and were gate-passed in Phase 1.

## Codebase verification

All 29 on-disk claims the document makes were checked against `/home/bewinxed/cockpit/apps/dashboard/src/`. **Every claimed string exists**, and the substantive claims hold. Highlights:

- `client.svelte.ts` L70, L303, L1081, L1115, L1676 — all five verbatim at the cited lines.
- `PermissionCard.svelte` — the three answer buttons genuinely share one flex container (L107), with `⇧Y` on `Always allow` and `Y` on `Allow`. The severity-`4` finding is a real defect.
- `routes/rules/+page.svelte` `remove()` L60–70 — `removeRule(...)` then `rules.filter(...)`, no confirm, no toast. A repo-wide grep for `undo|Undo` returns two hits, neither a user-facing undo (`usage/+page.svelte:147` is a substring of "undocumented"; `fleet.ts:527` is config versioning). The severity-`3` no-undo finding is exactly right.
- `usage/+page.svelte` L156 `<h1 class="text-title">Usage</h1>` against `text-display` on `rules` L96, `tools` L88, `project/[id]` L221 — the severity-`1` consistency finding is real.
- `tools/+page.svelte` L104 `error={data.toolsError}` vs L109/113/117/121 `error={data.fleetError}` — the severity-`1` error-prop finding is real.
- `SessionPane.svelte` L1891 `<IconSpinner class="… animate-spin" />` + L1892 `Reading transcript…`, with `virtua` and `bufferSize={400}` at L1838 — the bare-spinner finding is real and correctly characterized.
- `SpawnPanel.svelte` L583/588/622, `Sidebar.svelte` L1168, `JumpPalette.svelte` L27–38, `SessionTabs.svelte` L490, `FolderMenu.svelte` L86 — all verified. Flow 4's narrowing of the `## IA` gap from "no capability" to "no visible index" is honest and correct.
- `AttentionQueue.svelte` L128–130 renders `Allow` / `Deny` / `Open` and contains no `Always` anywhere — the spec's claim at L449 that scope-widening is not offered there matches reality.

The three overstatements are in Major #1–#3 above.

## Notes (non-blocking)

- No pixel evidence exists or is expected for a spec-only phase; this is not a coverage gap.
- The document's self-corrections are a strength worth preserving: the `0`-rated heuristic row (L687) recording a rejected finding, the "Recorded and largely rejected" framing on the tools row (L685), and Flow 4 narrowing rather than inheriting the Phase-1 IA gap. Keep this discipline in Phase 3.
- `## Marketing spine` (L693) declaring N/A with a stated reason, rather than being filled with invented funnel content, is correct.

## Issues (if FAIL)

None. No blocker.

---

**Verdict: PASS** — all 7 done-when items met with evidence; all 4 listed edge cases handled; all 5 listed constraints honored (pattern-derivation direction partially, recorded as Major #4). Assessment B is documented **N/A** (no rendered artifact), not skipped. Every citation in the added sections web-verified against a primary source with zero fabrications. The four Major findings are quality defects that should be fixed before Phase 3 consumes this document — three of them are heuristic rows that overstate their evidence and would send a later phase to build something that partly exists — but none of them is a failed requirement.
