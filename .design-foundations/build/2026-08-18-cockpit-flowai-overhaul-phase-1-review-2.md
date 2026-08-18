# Design Review: Phase 1 — Jobs, journey & IA

## Rendered Evidence (Step 0)
- Screenshot: none — spec-only phase, no rendered surface exists. Structure-level critique of the Markdown artifacts, cross-checked against the routes on disk.
- Surface reviewed:
  - `/home/bewinxed/cockpit/JOURNEY.md` (82 lines)
  - `/home/bewinxed/cockpit/CLAUDE.md` (23 lines)
  - `/home/bewinxed/cockpit/apps/dashboard/src/routes/` (route truth for the sitemap check)

## Assessment B — Deterministic Detector
- Command: not run.
- Exit: **3 — N/A (no rendered artifact)**. There is no `.html`/mock in this phase, so `scripts/detect.mjs` has nothing to run against. Per the no-artifact carve-out this is a documented N/A, **not a skipped detector**, and is not a FAIL condition.
- Findings: N/A — no rendered artifact.
- Opened only after Assessment A findings were frozen: YES (nothing to open).

## Triage
- Baseline (always-on): visual + usability — **reduced to structure/IA only**; there are no pixels, no typography, no color, no tap targets to judge. The visual baseline is genuinely inapplicable to a Markdown spec, and I am not manufacturing findings for it.
- Dispatched: **`journey`** — the artifact is a JTBD + journey map + IA document, exactly this doctrine's scope. Read: `references/journey/journey.md`, `references/journey/references/journey-stack.md`, `references/journey/references/journey-caveats.md`.
- Not applicable: `data-viz` (no charts), `content-design` (no product copy on a surface), `behavioral` / `deceptive-patterns` (no persuasion surface; `## Marketing spine` is correctly N/A), `design-dna` / `checklists` (no visual surface).
- Deferred: none.

---

## Cross-Pillar Findings (ONE ranked report)

| # | Severity | Pillar | Problem | Principle | Fix |
|---|----------|--------|---------|-----------|-----|
| F1 | **Critical** | journey | **The IA source is a book that does not exist.** L57 and L72 cite "*Information Architecture for the World Wide Web*, 4th ed, Rosenfeld/Morville/Arango, 2015". Verified against O'Reilly (ISBN 9781491911686) and the publisher title page: the 4th edition is titled ***Information Architecture: For the Web and Beyond*** (2015). "…for the World Wide Web" is the 1st–3rd edition title; the 3rd ed. (2006) has no Arango. That title/edition/author/year combination is not a real book. | Rules §"Cite the principle" — no unsourced or mis-sourced structural claims | Change both citations to *Information Architecture: For the Web and Beyond*, 4th ed, Rosenfeld/Morville/Arango, O'Reilly, 2015. **Note:** `journey-stack.md` L156 prints the same wrong pairing — the error is inherited from the doctrine, not invented here. Fix both. |
| F2 | **Critical** | journey | **"Edelman 2013" is an unverifiable year.** L47 cites "Court et al., *McKinsey Quarterly*, 2009; Edelman 2013" for the loyalty loop. Court et al. 2009 verified correct. Edelman's loyalty-loop article is "Branding in the Digital Age," ***Harvard Business Review*, December 2010** (verified on hbr.org and Semantic Scholar); Edelman & Singer "Competing on Customer Journeys" is HBR 2015. No 2013 Edelman loyalty-loop publication surfaced in search. | Rules §"Cite the principle"; journey-caveats §Linear-funnel fallacy sourcing | Change to "Edelman, HBR, 2010". Same inherited-from-doctrine caveat (`journey-stack.md` L129 prints "Edelman 2013"). |
| F3 | **Major** | journey | **The hub-and-spoke justification is contradicted by the document's own journey table.** L59: "Tools, Rules, and Usage are visited and left independently for **four of the six** journey phases (Fleet check-in, Triage, Remote approval, Cost check, Wind-down…)". Two defects: (a) **five** phases are named, not four; (b) per the table's own Touchpoints column, Fleet check-in (`session`, Telegram), Triage (`session/[id]`), Remote approval (Telegram, mobile web) and Wind-down (`session`) touch **no spoke at all**. Only Cost check (`usage`) conforms — plus the explicitly excepted Steer-or-spawn. The evidence offered for the structure type rests on exactly **one** conforming phase. | Rosenfeld/Morville/Arango 2015 structure types; journey-caveats §Sitemap ≠ IA (structure asserted rather than derived) | Rewrite the justification against the actual Touchpoints column. Hub-and-spoke may still be the right shape, but the argument as written is false and an auditor will find it in one pass. |
| F4 | **Major** | journey | **The "one-click return path" claim is false for half the journey.** L74: "Global navigation surfaces all four spokes … so **every phase** in the journey table has a one-click return path to its own destination." Contradicted three lines earlier and by the sitemap: Triage's destination is `session/[id]`, a drill-in (≥2 clicks); Steer-or-spawn's is `project/[id]`, which L74 itself says is "never a direct global-nav target"; Remote approval's are Telegram + mobile web, not nav targets at all. Only 3 of 6 phases (Fleet check-in, Cost check, Wind-down) actually have one-click destinations. | Rosenfeld/Morville navigation systems (2015); Hick–Hyman 1952 is invoked here but the reachability claim is what fails | Restate as "every phase has a one-click return path to its **spoke**"; drop the "own destination" overclaim. |
| F5 | **Major** | journey | **`project/[id]` is unreachable for the phase that needs it.** The sitemap makes Project detail "a contextual drill-in from the hub" (the session/fleet board), and there is no projects-list route on disk (`routes/project/` contains only `[id]/`). But Steer-or-spawn's action is "**Starts a new session against a project**" — the operator needs Project detail *before* a session exists to drill in from. The IA supplies no entry point for that. This is a destination the journey table visits that the stated navigation cannot reach. | Rosenfeld/Morville navigation systems (2015); journey-caveats §Sitemap ≠ IA ("hiding frequently accessed content behind rarely-visited parent categories") | Either add a Projects list surface (global nav or a hub lane) or state the entry point for spawning against a project with no running session. |
| F6 | **Major** | journey | **The Emotion lane conflates intensity with valence, and two phases are each declared the day's peak.** NN/g (Gibbons 2018, verified on nngroup.com) defines Emotions as a single line showing "where the user is delighted versus frustrated" — a valence curve. The table mixes axes: "Medium — mild vigilance" and "Low → rising" are intensity; "High if confirmed clean" is positive valence; "Medium-high … the anxiety peak of the day" is negative valence. Consequently L49 says the curve "spikes to the day's high point during remote/mobile approval" while the table's highest value is Wind-down ("High"), which L45 separately calls "the day's emotional peak-end". The axis is never defined, so the curve cannot be read. | NN/g Gibbons 2018 emotion curve; journey-stack §Emotion curve guidance ("the most design leverage — and the most fabrication risk") | Pick one axis (recommend valence, per NN/g) and re-score all six cells on it; name the single peak and the single end explicitly. |
| F7 | **Major** | journey | **The stated current-state baseline is factually wrong and contradicts the Anxiety force.** L34: "current-state baseline is '**no dashboard, raw terminals**'". L21: "the **current dashboard's** CSS and layout are buggy". A current dashboard demonstrably exists — 7 route surfaces on disk. The doctrine names "future-state mapping without a current-state baseline" as a theater indicator; the document supplies a baseline, but the wrong one. | journey-caveats §Journey-map theater (theater indicator #4) | Restate the baseline as "an existing dashboard the operator does not trust, plus terminal fallback" — which is also what the Habit force actually describes. |
| F8 | **Minor** | journey | **Two structural claims carry no citation** (the DW-1.7 gap): the job-story form "When [situation], I want [motivation], so I can [outcome]" at L10 (Klement, jtbd.info 2013 per journey-caveats' school table) and the Functional/Emotional/Social split at L12/14/16 (Christensen per the same table). Every other structural claim in the document is cited. | journey.md Rules §"Cite the principle"; DW-1.7 "every structural claim" | Add both attributions — or state once that the job-story format and the F/E/S dimensions are the doctrine template's shared scaffolding. |
| F9 | **Minor** | journey | **Wrong doctrine section cited.** L51: "Per the doctrine's pre-flight check (`journey-caveats.md` §Journey-map theater)". The pre-flight check is a separate section titled §"Summary: the honest pre-flight check"; §Journey-map theater holds the indicators. | Accurate citation | Cite both sections by their real titles. |
| F10 | **Minor** | journey | **The "Usage" nav label is route jargon, not operator language** — and the document's own reconciliation claim (L72) papers over it. The phase is called "**Cost check**"; the prose says "spend", "daily budget", "expensive", "blow the budget". The nav label is "Usage", which is the SvelteKit route name. | journey-caveats §Sitemap ≠ IA ("choosing labels that are internal jargon rather than user-language") | Consider "Spend" or "Cost". At minimum, stop claiming the label already matches the prose vocabulary — three of four labels do; this one does not. |
| F11 | **Minor** | journey | **DW-1.2 vs DW-1.3 conflict (defect in the requirement set, not the artifact).** Per journey-caveats' school table, "job story" is Klement's construct and "functional/emotional/social job" is Christensen's language — both appear (L10, L12/14/16) while the declared school is Moesta. But DW-1.3 *mandates* both strings, and journey-caveats L95 explicitly blesses the pairing ("The job story format (Klement) pairs cleanly with Moesta's constructs"). No genuinely exclusive vocabulary from any other school is present (grep-verified below). | journey.md Rules §"Pick one JTBD school"; journey-caveats §JTBD school-mixing | No artifact change. Tighten DW-1.2's wording in future phases to exempt the template-mandated scaffolding. |
| F12 | Note | journey | NN/g's verified header components are "Actor, Scenario **+ Expectations**, Phases, Actions/Mindsets/Emotions, Opportunities". The document has Actor/Scenario/Scope but no Expectations lane. Not a listed requirement (DW-1.4 asks only for actor, scenario, scope). | Gibbons 2018 §Key Components | Optional: add the operator's expectations for the scenario. |
| F13 | Note | journey | The sitemap omits the root `/` route, which exists on disk — but it is a pure `redirect(307, '/session')` with no surface (`+page.svelte` reads "Never rendered"). "7 route surfaces" is a defensible count and matches CLAUDE.md L19–21. | — | No change. |
| F14 | Note | journey | The journey map has **no named owner** ("Owner: not yet named", L51). The doctrine requires one, but also says "Flag this explicitly when authoring" — which the document does, with a stated revisit trigger. Handled correctly for a single-operator project. | journey.md Rules §"Journey maps are research, not decoration" | No change. |

### Citations verified this session

| Citation as written | Status |
|---|---|
| Moesta, *Demand-Side Sales 101*, 2020 (Switch interview / four forces) | **Correct** (co-author Greg Engle uncredited — not a defect) |
| Gibbons, "Journey Mapping 101," Nielsen Norman Group, 2018 | **Correct** — verified on nngroup.com, byline Sarah Gibbons, December 9, 2018 |
| Court et al., *McKinsey Quarterly*, 2009 | **Correct** |
| Edelman 2013 | **WRONG YEAR** → HBR **2010** (F2) |
| *Information Architecture for the World Wide Web*, 4th ed, 2015 | **MISATTRIBUTED TITLE** → *…: For the Web and Beyond* (F1) |
| Kahneman peak-end rule, 1993 | **Correct year** (canonical study is Kahneman, Fredrickson, Schreiber & Redelmeier 1993) |
| Fitts's law 1954 · Hick–Hyman 1952 · Google messy middle 2020 | **Correct** |
| Doctrine quote "discrete task areas; no cross-navigation needed" (L59) | **Verbatim accurate** — `journey-stack.md` L187 |
| Doctrine cross-refs to §Emotion curve guidance and §Sitemap ≠ IA | **Accurate** (section title for the pre-flight check is wrong — F9) |

---

## Requirement Fulfillment

### DW-1.1
**PREMISE:** `JOURNEY.md` exists at repo root with `## Job`, `## Journey`, `## IA` each complete.
**EVIDENCE:** File exists at `/home/bewinxed/cockpit/JOURNEY.md`. `grep -n "^#\+ "` returns: `8:## Job`, `28:## Journey`, `55:## IA`, `80:## Marketing spine`. Each is populated against the doctrine template — Job carries job story + F/E/S + four forces + school; Journey carries actor/scenario/scope + 6-row table + decision model + emotion curve + research basis; IA carries scheme + structure + sitemap + nav labels + nav model + validation.
**VERDICT:** PASS

### DW-1.2
**PREMISE:** `**JTBD school used:**` names exactly one school, and no vocabulary from the other three appears in the document.
**EVIDENCE:** L24 reads `**JTBD school used:** Moesta (Switch interview).` — exactly one. Word-boundary greps I ran:
- Ulwick: `grep -nioE "\b(ODI|outcome-driven innovation|Universal Job Map|desired outcome[s]?|JTBD process step[s]?|Ulwick)\b"` → **NONE**
- Christensen: `grep -nioE "\b(Christensen|milkshake|Competing Against Luck|circumstance[s]?|progress)\b"` → **NONE**
- hire/fire metaphor: `\b(hire[sd]?|hiring|fire[sd]?|firing)\b` → only `16:fired` ("fired off a dozen agents") and `40:fire` ("is anything on fire") — both ordinary English, not the JTBD hire/fire construct
- Klement: `(\bKlement\b|jtbd\.info|\bjob stor(y|ies)\b)` → only `10:Job story`
- Moesta vocabulary present and consistent throughout (L18–24, 34, 43, 49)
Two template-mandated strings do map to other schools in journey-caveats' table: `Job story` (Klement) and `Functional/Emotional/Social job` (Christensen, L12/14/16). Both are required verbatim by DW-1.3 and blessed by journey-caveats L95.
**VERDICT:** PARTIAL — no exclusive vocabulary from any other school; the two overlapping strings are mandated by DW-1.3 (see F11). Not a blocker.

### DW-1.3
**PREMISE:** Job story matches the literal `When [situation], I want [motivation], so I can [outcome]` form; Functional, Emotional, and Social jobs all populated.
**EVIDENCE:** L10 reads "**Job story:** **When** several AI coding agents are running unattended across different machines and one of them stalls…, **I want** to see which session needs me without opening every terminal…, **so I can** approve, redirect, or kill it before it wastes the run's context and cost…" — all three literal markers in order. L12 `**Functional job:**` (triage/approve/spawn/budget), L14 `**Emotional job:**` (feel in control of an unwatched fleet), L16 `**Social job:**` (be seen as running a disciplined fleet) — all three populated and non-generic.
**VERDICT:** PASS

### DW-1.4
**PREMISE:** Journey table carries all six columns (Phase · Actions · Mindset · Emotion · Touchpoints · Opportunities); header states actor, scenario, and scope; phase names are Cockpit-specific rather than the generic five.
**EVIDENCE:** Header row L38 is literally `| Phase | Actions | Mindset | Emotion | Touchpoints | Opportunities |`. An awk column count over every data row returns `cols=6` for all six rows. Header fields present: `**Actor:**` (L30), `**Scenario:**` (L32), `**Scope:**` (L34). Phase names: Fleet check-in · Triage blocked sessions · Steer or spawn work · Remote approval (away from the desk) · Cost check · Wind-down — none of the doctrine's template five (Awareness → Consideration → Decision → Onboarding → Advocacy); every one is specific to fleet-operator work.
**VERDICT:** PASS — though the Emotion column's contents are defective (F6).

### DW-1.5
**PREMISE:** `**Research basis:**` reads a named source or the literal `UNGROUNDED`; `**Decision model:**` names loyalty loop or messy middle and never AIDA.
**EVIDENCE:** L51 begins `**Research basis:** UNGROUNDED.` — literal token present. L47 begins `**Decision model:** McKinsey loyalty loop (Court et al., *McKinsey Quarterly*, 2009; Edelman 2013)` and argues why messy middle does not apply. `grep -nwoiE "AIDA" JOURNEY.md` → **NONE**.
**VERDICT:** PASS — with the Edelman year defect (F2) charged to DW-1.7.

### DW-1.6
**PREMISE:** IA states an organization scheme and structure type from the doctrine's enumerated sets; sitemap covers all 7 route surfaces; `**Validation:**` reads the literal `NOT VALIDATED`.
**EVIDENCE:** L57 `**Organization scheme:** Task` — in the doctrine's ambiguous set (topic/task/audience/metaphor). L59 `**Structure type:** Hub-and-spoke` — in the doctrine's enumerated four (tree/sequential/matrix-faceted/hub-and-spoke). Sitemap (L62–70) lists Session, Session/[id], Project/[id], Tools, Rules, Rules/[id], Usage = 7. Routes on disk under `apps/dashboard/src/routes/`: `session/[[id]]/+page.svelte`, `project/[id]/+page.svelte`, `tools/+page.svelte`, `rules/+page.svelte`, `rules/[id]/+page.svelte`, `usage/+page.svelte` — a 1:1 match (`session/[[id]]` optional param covers both Session and Session/[id]; `api/[...path]` is a server endpoint, not a surface; `/` is a 307 redirect with no surface). L76 begins `**Validation:** NOT VALIDATED.` — literal token present.
**VERDICT:** PASS — the literal requirement is met; findings F3, F4, F5 are quality defects inside it, not requirement misses.

### DW-1.7
**PREMISE:** Every structural claim carries an author/framework + year citation.
**EVIDENCE:** Most claims are cited and verified correct (see the citations table). Three failures:
1. The IA source citation is a book that does not exist — wrong title for the 4th edition (F1), used twice (L57, L72).
2. `Edelman 2013` (L47) is not a real Edelman loyalty-loop publication; the article is HBR 2010 (F2).
3. Two structural claims carry no citation at all: the job-story form (L10) and the Functional/Emotional/Social dimension split (L12/14/16) (F8).
A citation carrying a wrong title/edition or an unverifiable year does not satisfy "carries an author/framework + year citation".
**VERDICT:** FAIL

### DW-1.8
**PREMISE:** CLAUDE.md **exists at repo root** and its `## Design Context` block contains `- **Journey spec**: JOURNEY.md`.
**EVIDENCE:** `/home/bewinxed/cockpit/CLAUDE.md` exists (1171 bytes; untracked in git, but the requirement is existence at repo root, which is satisfied). L12 is `## Design Context`; L14 within that block is exactly `- **Journey spec**: JOURNEY.md`.
**VERDICT:** PASS

**All requirements met:** NO — DW-1.7 fails; DW-1.2 partial (requirement-set conflict, non-blocking).

---

## Edge Cases

| Listed edge case | Handling | Verdict |
|---|---|---|
| No card sort / tree test possible → sitemap must carry literal `NOT VALIDATED` | L76 opens with the literal token and explains *why* it is impossible (single operator, no second person), citing the Rosenfeld/Morville validation requirement. No invented validation anywhere. | HANDLED |
| No user research → `**Research basis:**` must read literal `UNGROUNDED`, map flagged as hypothesis per the pre-flight check | L51 opens with the literal token, states no interviews/diary studies/support-call analysis were conducted, and explicitly flags the emotion curve as "a reasoned hypothesis from the stated forces and scenario, not derived from research". (Section title miscited — F9, cosmetic.) | HANDLED |
| `## Marketing spine` N/A → marked N/A, not filled with 13 invented sections | L80–82: heading present, body opens "N/A.", gives the reason (no acquisition funnel; installed by its own operator), and states the sections are "omitted rather than filled with invented content". Zero invented sections. | HANDLED |
| Journey phases must be scenario-specific; the doctrine's template five are a theater indicator | All six phase names are Cockpit-operator-specific; none of the template five appears. | HANDLED |

All four listed edge cases handled. No edge-case FAIL.

---

## Notes (non-blocking)
- **Pixel evidence gap:** none applicable — this is a spec-only phase with no rendered surface. Contrast, spacing, hierarchy and token adherence are out of scope until DESIGN.md exists.
- **The two citation errors (F1, F2) are inherited from the doctrine itself** (`journey-stack.md` L129 and L156 print the same wrong pairings). That is mitigating context for how they got here, but it does not make them correct in a document that will be cited downstream — and the review brief explicitly rates a misattributed book or invented year as Critical. Worth filing upstream against the doctrine as well.
- **The document argues well against itself in places** — the hub-and-spoke "named exception" paragraph and the global-nav correction note both do real self-auditing rather than asserting. That instinct is right; F3/F4 are cases where the self-audit stated a conclusion it had not actually checked against its own table.
- **Flows and Page specs sections are absent.** Not a defect: DW-1.1 scopes this phase to Job/Journey/IA, and Phase 2 covers flows and page specs.
- The Anxiety force (L21) is written in project-meta voice ("The user reports the current dashboard's CSS…"), which reads as build-process context leaking into a user-journey artifact. It does land on a genuine fear about the new solution by the end of the sentence, so it is not wrong — just off-register.

---

## Issues (blockers)

1. **F1 — Nonexistent IA source citation.** Critical / journey / Rules §"Cite the principle" / Change both L57 and L72 to *Information Architecture: For the Web and Beyond*, 4th ed, Rosenfeld/Morville/Arango, O'Reilly, 2015.
2. **F2 — "Edelman 2013" is not a real loyalty-loop publication.** Critical / journey / Rules §"Cite the principle" / Change L47 to "Edelman, HBR, 2010".
3. **F8 — Two structural claims uncited.** Minor severity, but it is the literal DW-1.7 miss / journey / Attribute the job-story form and the F/E/S split, or state once that both are the doctrine template's shared scaffolding.

Non-blocking but strongly recommended before Phase 2 builds flows on this IA: **F3, F4, F5, F6, F7** — five Major self-contradictions, four of which (F3, F4, F5, F7) are load-bearing for the navigation model that Phase 2's flows and page specs will inherit.

**Verdict: FAIL — blockers: DW-1.7 (two verified-wrong citations F1/F2, two uncited structural claims F8).**
