# Design Review: Phase 1 — Jobs, journey & IA

## Rendered Evidence (Step 0)
- Screenshot: none — spec-only phase, no rendered surface exists for these artifacts.
- Surface reviewed: `/home/bewinxed/cockpit/JOURNEY.md` (85 lines), `/home/bewinxed/cockpit/CLAUDE.md` (23 lines).
- Cross-checked against disk: `/home/bewinxed/cockpit/apps/dashboard/src/routes/` (route inventory) and the doctrine at `/home/bewinxed/.claude/plugins/cache/rtd/design-for-ai/4.2.0/references/journey/{journey.md,references/journey-stack.md,references/journey-caveats.md}`.

## Assessment B — Deterministic Detector
- Command attempted: `node /home/bewinxed/cockpit/scripts/detect.mjs`
- Exit: **N/A (no rendered artifact)**. Stated explicitly, per the dispatch prompt: this phase produces two Markdown specs, not an `.html` surface, so the detector has nothing to run against. (`scripts/detect.mjs` is also not present in this repo — but that is moot: with no artifact, B is N/A regardless, not a skipped detector.) Unrelated `.html` files exist under `/home/bewinxed/cockpit/mocks/` from other phases; they are not Phase 1 artifacts and were not fed to the detector or reviewed here.
- Findings: N/A — no rendered artifact.
- Opened only after Assessment A findings were frozen: N/A (nothing to open).

## Triage
- Baseline (always-on): visual + usability — applied at the level the artifact supports (document structure, internal consistency, label/vocabulary coherence). No pixels exist to audit for contrast, type, or spacing.
- Dispatched: `journey` (the artifact is a JTBD + journey map + IA spec — the signal is the whole document).
- Not applicable: `data-viz` (no charts), `behavioral`/`deceptive-patterns` (no conversion surface), `design-dna`/`checklists` at pixel level (no rendered surface).
- Deferred: none.

## Citation verification (web-verified, not from memory)

The first research subagent dispatched for this returned with no web access; verification was re-run directly via Exa web search/fetch. Every citation below was checked against a publisher, journal, or DOI record.

| # | Citation as written in JOURNEY.md | Verdict | Evidence |
|---|-----------------------------------|---------|----------|
| 1 | Moesta, *Demand-Side Sales 101*, 2020 — cited for the **Switch interview / four forces** (L20) | **VERIFIED** | Bob Moesta & Greg Engle, *Demand-Side Sales 101: Stop Selling and Help Your Customers Make Progress*, Lioncrest Publishing, 2020 (amazon.com/dp/1544509987; books.google.com id=j0XBzQEACAAJ; therewiredgroup.com/learn/demand-side-sales-101/). Four forces (push/pull/anxiety/habit) are documented as Moesta's own framework on The Rewired Group's site. Title is shortened (subtitle dropped) but the attribution is correct. |
| 1a | Moesta, 2020 — cited for the **functional/emotional/social split** (L18) | **VERIFIED** | The Rewired Group's own summary of the book lists its key frameworks as "1. The three sources of energy or motivations (functional, emotional, and social). 2. The four forces of progress… 3. The JTBD timeline" (therewiredgroup.com/learn/demand-side-sales-101-stop-selling-and-help-your-customers-make-progress/). Moesta uses this vocabulary in his own work; attributing it to him is defensible even though the doctrine's own table maps it to Christensen. |
| 1b | Moesta, 2020 — cited for the **job story sentence form** (L18) | **WRONG — misattribution** | The "When ___, I want ___, so I can ___" template was invented at Intercom and first published by Paul Adams in "The Dribbblisation of Design" (2013); Intercom's own account states "we invented Job Stories… Alan Klement later named it for us" (intercom.com/blog/accidentally-invented-job-stories/, 2016). Klement published "Replacing the User Story with the Job Story" in 2013 (intercom.com/blog/using-job-stories-design-features-ui-ux/, 23 Dec 2013; archive.is/GE46X). Moesta's 2020 book postdates it by seven years and none of its documented frameworks is the job-story template. See Critical finding #1. |
| 2 | Gibbons, "Journey Mapping 101," Nielsen Norman Group, 2018 | **VERIFIED** | nngroup.com/articles/journey-mapping-101/, Sarah Gibbons, published 9 Dec 2018. Title and year exact. |
| 3 | Fitts's law, 1954 | **VERIFIED** | P. M. Fitts, "The information capacity of the human motor system in controlling the amplitude of movement," *J Exp Psychol* 47(6):381–391, June 1954 (PMID 13174710). Year correct; document cites the bare year, so there is no title to be wrong. |
| 4 | Court et al., *McKinsey Quarterly*, 2009 | **VERIFIED** | Court, Elzinga, Mulder & Vetvik, "The consumer decision journey," *McKinsey Quarterly*, June 2009 (mckinsey.com/…/the-consumer-decision-journey). The article does introduce and name the loyalty loop ("opportunities to interrupt the loyalty loop"), so the claim attaches correctly. |
| 5 | Edelman, "Branding in the Digital Age," *HBR*, December 2010 | **VERIFIED, title truncated** | David C. Edelman, "Branding in the Digital Age: You're Spending Your Money in All the Wrong Places," *HBR*, December 2010 issue (hbr.org/2010/12/…; reprint R1012C). Author, journal, month/year exact; the subtitle is omitted. |
| 6 | Kahneman, Fredrickson, Schreiber & Redelmeier, "When More Pain Is Preferred to Less," *Psychological Science*, 1993 | **VERIFIED, title truncated** | Full title "When More Pain Is Preferred to Less: **Adding a Better End**," *Psychological Science* 4(6):401–405, Nov 1993, DOI 10.1111/j.1467-9280.1993.tb00589.x. Author list and order exact. |
| 7 | Rosenfeld/Morville/Arango, *Information Architecture: For the Web and Beyond*, 4th ed, 2015 | **VERIFIED** | O'Reilly, 4th edition, September 2015 (oreilly.com/library/view/information-architecture-4th/9781491913529/). Title, three-author list, edition and year all exact — and notably **more correct than the doctrine**, which lists the older subtitle "…for the World Wide Web." |
| 8 | Hick, "On the Rate of Gain of Information," *QJEP*, 1952 | **VERIFIED** | W. E. Hick, *Quarterly Journal of Experimental Psychology* 4(1):11–26, March 1952, DOI 10.1080/17470215208416600. Exact. |
| 9 | Hyman, "Stimulus Information as a Determinant of Reaction Time," *J Exp Psychol*, 1953 | **VERIFIED** | Ray Hyman, *Journal of Experimental Psychology*, 1953, DOI 10.1037/h0056940. Exact. The document's note that these are "two separate papers, commonly paired as Hick's law" is accurate and is a point in its favour. |
| 10 | Google messy middle, 2020 | **VERIFIED** | Think with Google, "Decoding Decisions: Making sense of the messy middle," July 2020; Google's own 2023 follow-up states "Our first report was published in 2020." |
| 11 | Hub-and-spoke (Rosenfeld/Morville/Arango, 2015) — L61 | **PARTIALLY SUPPORTED** | The book's canonical organization *structures* are hierarchy, database model, and hypertext; "hub and spoke" appears in it as an illustrative example (the Disneyland layout) and is more commonly a mobile-navigation pattern in the wider literature. The doctrine supplied the enumerated set including hub-and-spoke without sourcing it, so the document inherited the attribution. See Minor finding #5. |

**Net: 10 of 11 attributions hold. One — the job-story sentence form — is demonstrably wrong, and it is load-bearing.**

## Cross-Pillar Findings (ONE ranked report)

| Severity | Pillar | Problem | Principle | Fix |
|----------|--------|---------|-----------|-----|
| **Critical** | journey / citation | L18 attributes the job-story sentence form to "Moesta, *Demand-Side Sales 101*, 2020." The form was invented at Intercom (Paul Adams, 2013) and named by Alan Klement (2013) — verified against Intercom's own account. The misattribution is not cosmetic: it is the sole device by which the document claims single-school purity, since the doctrine's own school table maps that exact template string to **Klement**. As written, the document borrows Klement's construct and relabels it as Moesta's. | "Cite the principle. Every recommendation names its source… No unsourced structural claims" (journey doctrine, Rules); "Pick one JTBD school per project… Mixing produces neither" (journey-caveats §JTBD school mixing) | Split the citation. Keep Moesta 2020 for the four forces *and* for the functional/emotional/social energies (both verified as his). Cite the sentence form to its real origin — Adams/Intercom 2013, named by Klement 2013 — and state in one clause that the template is adopted as **notation only**, not as a school commitment, with Moesta remaining the single analytic school. That satisfies DW-1.3 and DW-1.2 honestly instead of by relabelling. |
| **Major** | journey / IA | L76 asserts "**3 of 6 phases**" have a one-click global-nav path, and says the other three reach their destinations "from within the Fleet hub or the Rules/Tools spokes, never global-nav targets themselves." But the journey table's own Touchpoints cell for **Steer or spawn work** lists `Rules (rules, rules/[id])` and `Tools (tools)` — two of the four global-nav entries the same paragraph declares one-click. The count and the table disagree. | Nielsen #4 (consistency and standards); "Sitemap ≠ IA" — a structure claim must be read against the actual movement, which this section elsewhere does well | Either recount to 4 of 6 (Steer-or-spawn reaches Rules and Tools in one click; only its `project/[id]` leg is a drill-in), or restate the claim as "one-click path to the phase's *primary* destination" and say so. The rest of the paragraph's honesty makes this inconsistency conspicuous. |
| **Major** | journey | L53 records "**Owner:** not yet named." The doctrine's pre-flight check treats a journey map without a named owner as theater by definition — and unlike research basis and card sorting, an owner is the one gate the single-operator constraint does *not* block: exactly one person exists and could be named. | "A journey map without a named owner, a cadence for updates, and a clear research basis is theater (Watermark 2023)" (journey doctrine, Rules) | Name the operator as owner. Research basis (`UNGROUNDED`) and validation (`NOT VALIDATED`) are correctly unfakeable; ownership is not, and leaving it blank imports avoidable theater risk into an otherwise disciplined document. |
| **Minor** | citation | Two verified citations are quoted with subtitles dropped: Edelman ("…: You're Spending Your Money in All the Wrong Places") and Kahneman et al. ("…: Adding a Better End"). Both works, authors, journals and years are exact. | Cite the principle — exactness of the record | Restore both subtitles. No substantive change. |
| **Minor** | journey / IA | L61 cites hub-and-spoke to Rosenfeld/Morville/Arango 2015. The book's canonical organization structures are hierarchy / database / hypertext; hub-and-spoke appears there as an example rather than as a named structure type in its taxonomy. The doctrine supplied the enumerated set unsourced, so this is inherited, not invented. | Sitemap ≠ IA; cite the principle | Cite the enumerated set to the doctrine (`journey-stack.md` §IA) rather than to the book, or add "as commonly enumerated in IA practice." |
| **Minor** | journey | The Emotion lane distinguishes intensity from valence in only 2 of 6 cells ("High, negative valence" / "High, positive valence"). The other four give bare intensity ("Medium", "Low → rising", "Medium", "Low"), so the lane's vocabulary is not uniform across the row. | NN/g swim-lane emotion curve (Gibbons 2018) — the curve is a comparable series, not per-cell prose | Give every cell both dimensions (e.g. "Medium, neutral-to-mild-negative"). Cheap, and it makes the curve actually plottable in Phase 2. |
| **Note** | journey | `## Flows` and `## Page specs` are absent. This is correct scoping — the plan defers both to Phase 2 and DW-1.1 requires only Job/Journey/IA — recorded so the gap is not mistaken for an omission later. | Altitude model (journey doctrine §A) | None. Phase 2 work. |
| **Note** | content design | Nav label **Fleet** vs the route and touchpoint vocabulary `session` / "Session (hub — fleet board)". The document anticipates this at L74 and reconciles it deliberately, which is the right call, but Phase 2's page specs will need to pick one word for the surface's own title. | Rosenfeld/Morville labeling system | Decide in Phase 2 whether the page is titled "Fleet" or "Sessions"; do not leave both live in the UI. |

## Requirement Fulfillment

### DW-1.1
PREMISE:  "`JOURNEY.md` exists at repo root with `## Job`, `## Journey`, `## IA` each complete."
EVIDENCE: `/home/bewinxed/cockpit/JOURNEY.md` exists (14,932 bytes). `grep -n "^## "` returns exactly four headings: `8:## Job`, `30:## Journey`, `57:## IA`, `82:## Marketing spine`. `## Job` carries a job story, three job dimensions, four forces, and the school declaration (L10–26). `## Journey` carries actor/scenario/scope, a six-row six-column table, decision model, emotion curve, research basis (L32–53). `## IA` carries organization scheme, structure type, sitemap, nav labels, nav model, validation (L59–78). All three are populated, none is a stub.
VERDICT:  **PASS**

### DW-1.2
PREMISE:  "`**JTBD school used:**` names exactly one school, and no vocabulary from the other three appears in the document."
EVIDENCE: L26 reads `**JTBD school used:** Moesta (Switch interview).` — exactly one school. I derived the four schools' exclusive vocabulary from the doctrine's own table (`journey-caveats.md` L86–91) and grepped with word boundaries (`grep -iwE`, avoiding the substring false positives the prompt warns about, e.g. `ODI` inside "coding"): `Christensen` 0, `Ulwick` 0, `Klement` 0, `milkshake` 0, `hire`/`hired`/`hires` 0, `circumstance` 0, `progress` 0, `ODI` 0, `outcome-driven` 0, `desired outcome` 0, `Universal Job Map` 0, `opportunity score` 0. The single `fire` hit is `"Is anything on fire right now?"` at L42 — the operator's literal thought, not the hire/fire metaphor. The one residual flag is the job-story template string itself, which the doctrine maps to Klement — but **DW-1.3 mandates that exact template**, so it cannot simultaneously be a DW-1.2 violation. The *attribution* of that template is a separate defect, scored under DW-1.7.
VERDICT:  **PASS**

### DW-1.3
PREMISE:  "Job story matches the literal `When [situation], I want [motivation], so I can [outcome]` form; Functional, Emotional, and Social jobs all populated."
EVIDENCE: L10: "**When** several AI coding agents are running unattended across different machines and one of them stalls on a permission gate, breaks, or goes silent, **I want** to see which session needs me without opening every terminal or SSHing into every box, **so I can** approve, redirect, or kill it before it wastes the run's context and cost…" — all three clauses present in order. L12 `**Functional job:**` (triage, approve/deny, spawn/steer/stop, budget check), L14 `**Emotional job:**` (feel in control of an unwatched fleet), L16 `**Social job:**` (be seen as running a disciplined, supervised fleet). All three populated with product-specific content, none generic.
VERDICT:  **PASS**

### DW-1.4
PREMISE:  "Journey table carries all six columns (Phase · Actions · Mindset · Emotion · Touchpoints · Opportunities); header states actor, scenario, and scope; phase names are Cockpit-specific rather than the generic five."
EVIDENCE: L40 header row is `| Phase | Actions | Mindset | Emotion | Touchpoints | Opportunities |` — six columns, exactly the doctrine's set. L32 `**Actor:**` (the fleet operator, single-tenant), L34 `**Scenario:**` (a working day across machines), L36 `**Scope:**` (future-state, touchpoints included and excluded, current-state baseline named). Six data rows counted (`grep -c "^| \*\*"` → 6): Fleet check-in · Triage blocked sessions · Steer or spawn work · Remote approval (away from the desk) · Cost check · Wind-down. None matches the doctrine's template five (Awareness → Consideration → Decision → Onboarding → Ongoing); every name is specific to running an agent fleet.
VERDICT:  **PASS**

### DW-1.5
PREMISE:  "`**Research basis:**` reads a named source or the literal `UNGROUNDED`; `**Decision model:**` names loyalty loop or messy middle and never AIDA."
EVIDENCE: L53 begins `**Research basis:** UNGROUNDED.` — the literal token, followed by why (one informant, no user population). L49 begins `**Decision model:** McKinsey loyalty loop (Court et al., *McKinsey Quarterly*, 2009…)` and argues the loyalty loop against the messy middle explicitly rather than naming one decoratively. `grep -inwE "AIDA"` returns zero hits. The word "funnel" appears once, at L84, only to say Cockpit has none.
VERDICT:  **PASS**

### DW-1.6
PREMISE:  "IA states an organization scheme and structure type from the doctrine's enumerated sets; sitemap covers all 7 route surfaces; `**Validation:**` reads the literal `NOT VALIDATED`."
EVIDENCE: L59 `**Organization scheme:** Task` — from the doctrine's ambiguous set (topic/task/audience/metaphor). L61 `**Structure type:** Hub-and-spoke` — from the doctrine's set (tree/sequential/matrix-faceted/hub-and-spoke). Sitemap (L64–72) lists 7 surfaces: Session, Session/[id], Project/[id], Tools, Rules, Rules/[id], Usage. Verified against disk (`find apps/dashboard/src/routes`): `session/[[id]]` (optional param — covers both `session` and `session/[id]`), `project/[id]`, `tools`, `rules`, `rules/[id]`, `usage`. The only disk route not in the sitemap is the root `+page`, and `+page.server.ts` is a bare `redirect(307, '/session')` with the comment "Never rendered" — correctly excluded as not a surface. L78 reads `**Validation:** NOT VALIDATED.` — the literal token.
VERDICT:  **PASS**

### DW-1.7
PREMISE:  "Every structural claim carries an author/framework + year citation."
EVIDENCE: Citation *coverage* is complete — every structural claim carries an author/framework + year (see the verification table above: 11 attribution points, all cited, none bare). Citation *correctness* fails at one point. L18 attributes the job-story sentence form to Moesta, *Demand-Side Sales 101*, 2020. Verified against Intercom's own record: the template was invented at Intercom and published by Paul Adams in 2013, and "Alan Klement later named it for us" (intercom.com/blog/accidentally-invented-job-stories/); Klement's "Replacing the User Story with the Job Story" is dated 2013. Moesta's book is 2020 and its documented frameworks — per The Rewired Group — are the three energies, the four forces, and the JTBD timeline; the job-story template is not among them. This is a plausible-looking but wrong attribution, which the review brief classes as Critical, and it is load-bearing rather than incidental: it is the mechanism by which the document claims single-school purity. Every other citation checked clean, including two the doctrine itself gets wrong.
VERDICT:  **FAIL**

### DW-1.8
PREMISE:  "CLAUDE.md **exists at repo root** and its `## Design Context` block contains `- **Journey spec**: JOURNEY.md`."
EVIDENCE: `/home/bewinxed/cockpit/CLAUDE.md` exists on disk (1,171 bytes). L12 is `## Design Context`; L14 within that block is exactly `- **Journey spec**: JOURNEY.md`. The block also correctly enumerates the same 7 route surfaces the sitemap covers.
VERDICT:  **PASS**

**All requirements met:** NO — DW-1.7 fails on one verified misattribution. 7 of 8 pass.

## Edge cases

| Listed case | Handling | Verdict |
|---|---|---|
| No card sort or tree test possible → sitemap must carry the literal `NOT VALIDATED`, never invented validation | L78 reads `**Validation:** NOT VALIDATED.` and explains the single-operator reason. No invented method, no claimed participants. | **HANDLED** |
| No user research → `**Research basis:**` must read literal `UNGROUNDED`, and the map flagged as hypothesis per the pre-flight check | L53 reads `**Research basis:** UNGROUNDED.` and states "this map's emotion curve is a reasoned hypothesis from the stated forces and scenario, not derived from research," citing `journey-caveats.md` §Journey-map theater by name. The owner field is left blank rather than faked (scored as Major finding #3 — disclosed, not invented). | **HANDLED** |
| `## Marketing spine` N/A → marked N/A explicitly, not filled with 13 invented sections | L82–84: the heading exists and reads "N/A. Cockpit has no acquisition funnel…", naming the three doctrine constructs it is declining to apply. Section is 3 lines, not 13 sections. | **HANDLED** |
| Journey phases must be scenario-specific; the template five are a theater indicator | Six phases, all Cockpit-specific (Fleet check-in, Triage blocked sessions, Steer or spawn work, Remote approval, Cost check, Wind-down). Zero overlap with Awareness/Consideration/Decision/Onboarding/Ongoing. | **HANDLED** |

## Self-consistency checks

- **Does the stated structure type match the movement the table describes?** Yes, and unusually honestly. L61 does not assert the fit — it counts it: four phases silent on the question, exactly one clean fit (Cost check), one documented deviation (Steer-or-spawn crossing spokes). Verified against the table row by row; all three counts are correct.
- **Are the counts the document asserts about its own table correct?** "six journey phases" ✓ (6 rows counted). "four … never touch a Tools/Rules/Usage spoke" ✓ (Fleet check-in, Triage, Remote approval, Wind-down — none lists a spoke touchpoint). "Exactly one … visits a single spoke" ✓ (Cost check → Usage). "**3 of 6**" ✗ — see Major finding #2.
- **Is every destination the table visits reachable from the stated global navigation?** All six are reachable; two (`session/[id]`, `project/[id]`) only as drill-ins, which the document states, and one (Telegram) is external, which it also states. The `project/[id]` orphan — no list or creation route on disk — is flagged by the document itself as a known Phase 2 gap; verified true (`apps/dashboard/src/routes/project/` contains only `[id]/`).
- **Do nav labels match the prose vocabulary?** Fleet / Tools / Rules / Usage all trace to a phase that sends the reader there. "Fleet" vs the `session` route is a deliberate, disclosed reconciliation (Note above).
- **Is the stated current-state baseline consistent with disk?** Yes. L36 claims 7 existing route surfaces and a redesign rather than an introduction; disk confirms 7 surfaces plus a root redirect. The document does not claim the baseline is "no dashboard."
- **Emotion lane — intensity vs valence, no two phases at the same extreme?** Both High phases are separated by valence (Remote approval: high/negative; Wind-down: high/positive) and each cell cross-references the other so they cannot be read as one repeated peak. The peak-end reasoning at L51 is correct psychology, correctly cited. The lane's vocabulary is uneven across the other four cells (Minor finding #6).

## Notes (non-blocking)
- **No pixel evidence, by design.** This phase has no rendered surface; contrast, spacing, hierarchy and typography are unverified and unverifiable here. Not a gap in the work.
- The document is materially better-cited than the doctrine it was written against: it corrects the Rosenfeld/Morville 4th-edition subtitle, and it splits Hick–Hyman into two correctly dated papers instead of the conflated "Hick–Hyman 1952."
- Several passages read as if written to survive review ("Corrected from an earlier draft that omitted…", "read honestly against the journey table rather than asserted from the sitemap shape alone"). This is defensible in a spec whose job is to record reasoning — but the self-defence is doing work in exactly the place where the one real defect sits (L18's parenthetical arguing why the citation was kept to one source). Assertiveness of framing is not evidence; it earned no credit here.

## Issues (FAIL)
1. **Job-story sentence form misattributed to Moesta 2020** — Critical / journey+citation / "Cite the principle; no unsourced structural claims" + JTBD school-mixing caveat / Split the citation: Moesta 2020 keeps the four forces and the functional/emotional/social energies; the sentence form is cited to Adams–Intercom 2013 (named by Klement 2013) and declared as notation, not a second analytic school.

**Verdict: FAIL — one blocker: DW-1.7, the verified misattribution at JOURNEY.md L18.**

Everything else clears. All 8 done-when items except DW-1.7 pass on quoted evidence, all four listed edge cases are handled with literal tokens rather than invented content, all internal counts but one reconcile against the table, the sitemap reconciles against disk, and 10 of 11 citations verified exact against publisher or journal records. The blocker is a two-line citation fix, not a rewrite.
