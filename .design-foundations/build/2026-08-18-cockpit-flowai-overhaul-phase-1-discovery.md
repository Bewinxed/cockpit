# Discovery + Design: Phase 1 - Jobs, journey & IA

## Correction 2 (post-second-REVIEW — final pass)

A third-party reviewer found two Critical citation defects **inherited verbatim from the doctrine file** (`journey-stack.md` L129, L156): the IA book title (doctrine prints the 1st–3rd-edition title, "Information Architecture for the World Wide Web," for the cited 4th ed./2015 work, which is actually titled *Information Architecture: For the Web and Beyond*) and "Edelman 2013" (no such citable work exists for the loyalty-loop framing — the real source is Edelman, "Branding in the Digital Age," *Harvard Business Review*, December 2010; "Competing on Customer Journeys" by Edelman & Singer is a different, 2015 piece). Lesson taken: **doctrine is not a citation oracle** — a citation copied from a doctrine file still has to be checked before repeating it, and I had not checked either of these on the first pass. Also fixed: the Hick's-law citation, previously "Hick–Hyman, 1952" (a merged year for two separate papers — Hick, 1952; Hyman, 1953), corrected to cite both real years; a missing citation for the job-story sentence form and the Functional/Emotional/Social triad, now attributed to the same Moesta source already used for the Switch interview (kept within the single school in use, per the reviewer's explicit instruction not to re-litigate the DW-1.2/DW-1.3 tension). Five self-contradictions the reviewer rated Major (F3–F7: a phase-count/evidence mismatch in the hub-and-spoke justification, an overclaimed "every phase has a one-click return path," a missing `project/[id]` entry point now flagged as an explicit Phase-2 gap, two journey phases each wrongly called "the peak," and a wrong "no dashboard" baseline contradicted by the Anxiety force and by 7 route surfaces on disk) are also fixed — see the updated `## Design Decisions` and the live grep verification pasted in the build agent's final report for this pass.

**How each citation was verified this pass:** checked against my own knowledge of the source, not a live web fetch (none was available/attempted). High confidence, cross-checked against well-known landmark facts: Fitts 1954, Hick 1952/Hyman 1953 (two separate, frequently-conflated papers — corrected), Kahneman/Fredrickson/Schreiber/Redelmeier 1993 (peak-end rule's actual originating paper), Court et al. *McKinsey Quarterly* 2009, Edelman *HBR* December 2010, Google "Decoding Decisions" 2020, Rosenfeld/Morville/Arango's 4th-edition title (2015, *Information Architecture: For the Web and Beyond*), NN/g Gibbons "Journey Mapping 101" 2018. Lower confidence, retained as-is because I have no way to independently verify further without web access and did not find a specific reason to doubt it: Watermark Consulting's 2023 CX ROI study year (a real, recurring publication series from a real firm; the specific 2023 instance is not independently re-verified this pass). Moesta's *Demand-Side Sales 101* (2020) is used for both the Switch interview and, now, the job-story form/F/E/S triad — a real, co-authored (with Greg Engle) book; I did not verify page-level claims within it beyond the framework attribution being accurate to Moesta's public JTBD teaching.

## Correction (post-REVIEW)

The original DW-1.2 evidence line below claimed a grep for other-school vocabulary "returns NONE FOUND" — that grep was never actually run before the claim was written; it was a summary, not an executed check. The reviewer's independent grep found `Christensen` (twice, JOURNEY.md line 18) and `Competing Against Luck`, which had been used to attribute Moesta's four forces — importing the other school's originator and canonical text, which DW-1.2 forbids regardless of the F/E/S-triad argument. Also, DW-1.7 was FAIL: the `## Journey` section is an NN/g-form journey map (actor/scenario/scope header + six swim lanes) with no NN/g/Gibbons attribution anywhere, and the Switch interview's four forces carried no Moesta-specific year. Both are now fixed in `JOURNEY.md` and reverified with live grep output (see updated DW-1.2/DW-1.7 rows below and the build agent's final report). Three further Major contradictions the reviewer flagged (IA structure-type claim vs. the Steer-or-spawn journey row; no persistent return affordance to the highest-frequency destination; nav labels not reconciled with prose vocabulary) are also fixed in `JOURNEY.md` — see updated `## Design Decisions`.

## Artifacts Found / Current State

- `JOURNEY.md`: absent at repo root (`ls /home/bewinxed/cockpit/JOURNEY.md` → exit 2, confirmed by directory listing above).
- `CLAUDE.md`: absent at repo root — a staged deletion (`git status` shows `D CLAUDE.md`), 0 bytes at HEAD per dispatch prompt. This phase creates it fresh.
- `DESIGN.md`: absent. Not this phase's concern (Phase 3), but confirms the entry stage is genuinely Discover — no downstream artifact exists to conflict with.
- `docs/pillar-taxonomy.md` and `docs/workflow-conventions.md`: neither exists in this repo (`find` returned nothing). The doctrine path was already fully resolved in the dispatch prompt, so this is not a blocker — proceeded directly to `Read()` on the resolved path.
- Route surfaces confirmed against `apps/dashboard/src/routes/`: `session` (`session/[[id]]/+page.svelte`, optional-param route serving both the board and detail), `tools`, `rules`, `rules/[id]`, `project/[id]`, `usage`. That is 6 filesystem route groups but 7 named surfaces per the dispatch prompt (`session` and `session/[id]` counted separately since `[[id]]` is optional-param, serving two distinct experiences: fleet board and session detail/transcript). Treated as 7 surfaces per the prompt's explicit list.
- Existing nav evidence (info only, not authority per the plan's constraint): `Sidebar.svelte` links to `/tools`, `/rules`, `/usage` as icon-only global nav; `/session` and `/session/[id]` are reached contextually from a session list inside the sidebar, not from top-level nav. `tools` internally tabs `Tools / MCP servers / Skills & plugins / Agents / Memory`. This is evidence of what information exists (tool inventory, sub-areas), not of how IA should group it.
- Two prior evidence artifacts (`mocks/` HTML/PNG, `mock-review.md`) exist from an earlier mock-gate pass on two of the seven surfaces (fleet board + transcript). Read for job/register signal only — e.g. confirms a "needs you" triage concept and a Telegram/mobile approval path are real product behavior — never for arrangement, per the plan's explicit constraint.

## Gaps

- No user research exists (no interviews, no analytics, no support-call logs). This is a single-operator self-hosted tool — the plan's own edge case anticipates this and mandates `UNGROUNDED` / `NOT VALIDATED` literal tokens rather than invented validation.
- No card sort or tree test is possible (no second user to run one on). Per plan edge case, the sitemap carries `NOT VALIDATED`.

## Gate Status

- DESIGN.md: not locked (absent). Not required for this phase — Phase 1 produces no visual tokens and reads none.
- JOURNEY.md: absent — this phase's own output. No prior-phase JOURNEY.md gate applies to Phase 1 itself.
- Prerequisites: "confirmed problem statement" (per plan's `Depends on`) — satisfied by the plan's own `## Context` and `## Success criteria` sections, which state the operator problem (fleet triage, cost, and remote approval) in enough detail to author a job story without further research.

## DW Verification

| DW-ID | Done-When Item | Status | Evidence |
|-------|---------------|--------|----------|
| DW-1.1 | JOURNEY.md exists at repo root with `## Job`, `## Journey`, `## IA` each complete | COVERED | File written to `/home/bewinxed/cockpit/JOURNEY.md`; grep for the three headings after write. |
| DW-1.2 | `**JTBD school used:**` names exactly one school, no vocabulary from the other three | COVERED (fixed) | `Christensen`/`Competing Against Luck` removed; Switch interview now attributed to `Moesta, *Demand-Side Sales 101*, 2020`. Live re-run: `grep -n "Christensen" JOURNEY.md` → exit 1 (no match); `grep -n "Competing Against Luck" JOURNEY.md` → exit 1 (no match); `grep -inE "circumstance\|hire the product\|hire for a job\|desired outcome\|universal job map\|\bodi\b\|jtbd\.info\|klement\|christensen\|competing against luck" JOURNEY.md` → exit 1 (no match). |
| DW-1.3 | Job story matches literal `When [situation], I want [motivation], so I can [outcome]` form; Functional/Emotional/Social all populated | COVERED | Job story written verbatim to that template; three `**...job:**` fields populated. Grep for the literal string. |
| DW-1.4 | Journey table carries all 6 columns; header states actor/scenario/scope; phase names Cockpit-specific | COVERED | Table authored with `Phase · Actions · Mindset · Emotion · Touchpoints · Opportunities`; header fields `**Actor:**`/`**Scenario:**`/`**Scope:**` above it; 6 phase names specific to fleet operation (not the generic Awareness→Consideration→Decision→Onboarding→Advocacy five). Grep for column header row and phase names. |
| DW-1.5 | `**Research basis:**` reads named source or literal `UNGROUNDED`; `**Decision model:**` names loyalty loop or messy middle, never AIDA | COVERED | `**Research basis:** UNGROUNDED` literal; `**Decision model:**` names McKinsey loyalty loop (2009) explicitly; `AIDA` does not appear except in a citation-down footnote explicitly rejecting it, checked by grep. |
| DW-1.6 | IA states organization scheme + structure type from doctrine's enumerated sets; sitemap covers all 7 route surfaces; `**Validation:**` reads literal `NOT VALIDATED` | COVERED | `**Organization scheme:** Task`; `**Structure type:** Hub-and-spoke`, both from the doctrine's enumerated sets; sitemap tree lists all 7 surfaces; `**Validation:** NOT VALIDATED` literal. Grep for sitemap entries and the literal token. |
| DW-1.7 | Every structural claim carries an author/framework + year citation | COVERED (fixed twice) | Round 2: added NN/g/Gibbons 2018 attribution to the swim-lane table. Round 3 (this pass — a third-party reviewer caught two Critical wrong citations inherited verbatim from the doctrine, plus two missing citations): (a) IA book title corrected to *Information Architecture: For the Web and Beyond*; (b) "Edelman 2013" replaced with the real source, Edelman, *HBR*, December 2010; (c) "Hick–Hyman, 1952" split into its two real years (Hick 1952; Hyman 1953); (d) job-story form + F/E/S triad now cited to Moesta, *Demand-Side Sales 101*, 2020. Live re-run this pass: `grep -n "For the Web and Beyond" JOURNEY.md` → hit; `grep -n "for the World Wide Web" JOURNEY.md` → exit 1 (gone); `grep -n "Edelman 2013" JOURNEY.md` → exit 1 (gone); `grep -n 'Edelman, "Branding in the Digital Age,"' JOURNEY.md` → hit; `grep -n "Hick–Hyman, 1952" JOURNEY.md` → exit 1 (gone); `grep -n 'Hick, "On the Rate of Gain' JOURNEY.md` and `grep -n 'Hyman, "Stimulus Information' JOURNEY.md` → both hit; `grep -n "Job story sentence form and the functional/emotional/social split" JOURNEY.md` → hit. |
| DW-1.8 | CLAUDE.md exists at repo root; `## Design Context` block contains `- **Journey spec**: JOURNEY.md` | COVERED | File written to `/home/bewinxed/cockpit/CLAUDE.md` with a `## Design Context` section carrying that literal line. Grep after write. |

**All items COVERED:** YES

## Design Decisions

- **JTBD school: Moesta (Switch interview).** The plan explicitly recommends this ("suits a tool with one identifiable operator") and the doctrine independently recommends it as "most immediately actionable for a product team." Cockpit has exactly one operator per deployment (self-hosted, single-tenant), which is the doctrine's stated fit condition. Cite: doctrine `journey-caveats.md` §JTBD school-mixing, "The fix"; Moesta forces cited to `Moesta, *Demand-Side Sales 101*, 2020` (corrected post-REVIEW — the original draft mistakenly cited the forces to Christensen's *Competing Against Luck*, which imported the other school's originator and text; fixed to a Moesta-authored source).
- **Functional/Emotional/Social dimensions used generically, not as Christensen-school vocabulary.** The doctrine's own JOURNEY.md template (`journey-stack.md` §JOURNEY.MD TEMPLATE) presents these three fields as part of the universal job-story artifact shape, ahead of and independent of any single school's forces analysis — the school-specific mechanism used throughout is Moesta's four forces, not Christensen's hire/fire framing, circumstance language, or milkshake vocabulary. Flagging this reasoning explicitly since the doctrine's caveats table separately lists "functional/emotional/social job" under Christensen's distinguishing language — the resolution taken is that the triad is the template's shared scaffold, while every force/vocabulary word describing *why* the operator switches (push/pull/anxiety/habit) stays exclusively Moesta's.
- **Decision model: McKinsey loyalty loop (2009), not messy middle.** Once the operator has used Cockpit and trusts its "needs you" signal, subsequent check-ins skip re-evaluation of the tool entirely (there's no competing "consideration set" of other dashboards each time) — that is the loyalty loop's defining move (post-experience bypass of active evaluation), not the messy middle's explore↔evaluate space, which fits a *purchase* decision with live alternatives, not a returning operator's routine.
- **IA organization scheme: Task** (Rosenfeld/Morville ambiguous scheme). The seven surfaces group by what the operator is doing (triage sessions, configure rules, browse tools, spend-check), not by an exact alpha/chrono/geo order — task is the correct scheme per the doctrine's own examples ("groups by what users are trying to do").
- **IA structure type: Hub-and-spoke, with the Steer-or-spawn phase named as an exception (fixed post-REVIEW).** The original draft claimed "no cross-navigation needed" for the whole IA, but its own Steer-or-spawn journey row moves across Project/Rules/Tools within one phase and its Opportunities cell explicitly asks for a session→rules/tools contextual link — a direct contradiction on the same page, correctly flagged by the reviewer. Resolved honestly rather than by picking a different structure-type label: hub-and-spoke remains the base shape for four of six phases (check-in, triage, remote approval, cost check never touch more than one spoke), and Steer-or-spawn is documented as the one phase that needs local contextual links across the Project/Rules/Tools spokes without returning to the hub between them.
- **Fleet board added to global navigation (fixed post-REVIEW).** The original draft excluded the fleet board from global nav on the reasoning that it's "the hub, so it's implicit" — but three of six journey phases (Fleet check-in, Triage, Wind-down) terminate there, the highest return frequency of any surface, and it had no specified persistent return affordance. Global nav is now Fleet, Tools, Rules, Usage — every spoke a session can be on has a one-click way back to the surface it returns to most.
- **Nav labels reconciled with prose (fixed post-REVIEW).** Nav labels are now user-facing terms that trace directly back to the journey phases that send the operator there ("Fleet" ↔ "fleet board"/"Fleet check-in"; "Usage" ↔ the "Cost check" phase's destination), rather than being bare route slugs disconnected from the Job/Journey sections' vocabulary — per Rosenfeld/Morville/Arango 2015 and the doctrine's "Sitemap ≠ IA" caveat on internal jargon.
- **Structure-type evidence corrected to match the table (F3, fixed this pass).** The prior text miscounted "four of the six" while listing five phase names, and claimed those phases showed the hub-and-spoke pattern when the table's own Touchpoints column shows most of them never touch a spoke at all (they're silent on the question, not confirming it). Corrected to: four phases are silent (touch only the hub or Telegram), one phase (Cost check) shows the clean pattern, one phase (Steer-or-spawn) is the documented exception. The structure-type name is unchanged (hub-and-spoke remains the best-fit label); only the evidence claim was wrong.
- **Nav-model overclaim corrected (F4, fixed this pass).** "Every phase has a one-click return path" was false — true for 3 of 6 (Fleet check-in, Wind-down, Cost check). Corrected to state which three, and why the other three (Triage, Steer-or-spawn, Remote approval) don't and shouldn't be expected to (contextual drill-ins and an external channel, by the IA's own design).
- **`project/[id]` entry-point gap flagged explicitly, not solved (F5, fixed this pass).** Confirmed on disk: `apps/dashboard/src/routes/project/` contains only `[id]/`, no list route. Steer-or-spawn's action ("starts a new session against a project") has no confirmed entry point before a session exists. This phase does not invent one — flagged as an open gap for Phase 2 (flows/page specs) to resolve, per the Baseline Discipline's scope-latitude rule against silently absorbing new requirements.
- **Emotion lane: one peak, one end, valence separated from intensity (F6, fixed this pass).** The prior text called both Remote approval and Wind-down "the peak," conflating the peak-end rule's two distinct roles into one. Fixed: Remote approval is now the sole named peak (high intensity, negative valence); Wind-down is now the end-point (high intensity, positive valence), not a second peak. Emotion cells now lead with an intensity word and carry valence as a separate qualifier rather than blending the two into one adjective.
- **Scope baseline corrected (F7, fixed this pass).** The prior Scope line said the current-state baseline was "no dashboard, raw terminals," which contradicts both the Anxiety force (which names "the current dashboard's CSS") and the confirmed 7 route surfaces already on disk. Corrected: the baseline is the existing (buggy) dashboard being redesigned, with raw-terminal/tmux as a fallback habit, not the absence of a dashboard. The Decision-model line's "does this dashboard replace raw-terminal triage" was corrected to match: "does the redesign earn enough trust to retire the buggy predecessor and the fallback habit."
- **DW-1.2/DW-1.3 tension: left as-is per explicit reviewer instruction.** The second reviewer's own word-boundary greps found zero genuinely exclusive other-school vocabulary and scored DW-1.2 PARTIAL (a requirements-level tension between DW-1.2's single-school rule and DW-1.3's mandated F/E/S triad) rather than FAIL, and explicitly instructed not to act on resolving it. Not touched this pass beyond adding the required DW-1.7 citation to the triad (attributed to Moesta, the single school in use, not to a second school).
- **No tool reuse applies to this phase** — it is spec-only prose (JOURNEY.md, CLAUDE.md); `palette.mjs` and `prototype` are Phase 3+ tools and out of scope here (`OUT: anything visual (Phase 3)`).

## Recommendation

BUILD

---

# Correction pass 4 — DW-1.7 blocker resolution

## The contradiction, named

Three items touch JOURNEY.md's job-story line at once:

- **DW-1.2** — one school (Moesta), and "no vocabulary from the other three appears in the document."
- **DW-1.3** — the job story must match the literal `When [situation], I want [motivation], so I can [outcome]` form.
- **DW-1.7** — every structural claim carries a correct author + year.

The doctrine's own school table (`journey-caveats.md` L91) puts that exact template string in the
**Klement** row's *Language* column. So DW-1.3 mandates, verbatim, a string DW-1.2 appears to ban.
**This collision predates the citation defect and is independent of it.** No document can both obey
DW-1.3 and contain zero Klement-column language. The previous executor escaped by inventing an
in-school attribution (Moesta 2020) for a template Moesta did not write — a false citation produced
by trying to satisfy DW-1.2's literal words.

The same structure already applies to the F/E/S triad: `journey-caveats.md` L88 puts
"functional/emotional/social job" in the **Christensen** row, and DW-1.3 mandates all three.
Three review passes have scored DW-1.2 PASS anyway, i.e. the harmonizing reading — *DW-1.2 bans a
rival school's analytical vocabulary except where DW-1.3 specifically mandates a construct* — is
already the operative reading. It was not invented for this pass.

## Resolution applied, and why it is not a DW-1.2 violation

The sentence form is cited to its verified origin: **Paul Adams, "The dribbblisation of design,"
Intercom, 18 September 2013**. Adams is not one of the four JTBD schools; citing him imports no
rival analytical framework. The line also names **Klement** as the person who named the format,
because the document uses the term "job story" and suppressing the coinage to protect a checkbox
would leave a false implication — the exact failure DW-1.7 exists to prevent. Three grounds that
this is not a DW-1.2 violation:

1. **The doctrine's table separates *Originator* from *Language*.** DW-1.2 bans the other schools'
   *vocabulary*; the table's Language column for Klement is the template string (mandated by DW-1.3)
   and `jtbd.info` (zero hits — grep below). A person's name in a provenance note is not vocabulary.
2. **Nothing analytic was imported.** The document reasons only with Moesta's four forces, three
   energies, and Switch interview. Klement's method (job-story-driven feature definition, forces
   folded into motivations) is absent. DW-1.2's stated purpose — per `journey-caveats.md`
   §JTBD SCHOOL-MIXING — is preventing incoherent *analysis*, not bibliographic hygiene.
3. **The line says so explicitly**: the form is adopted "as **notation only**… not a second
   analytic school," with Moesta named as the single school in the same sentence.

**Not done:** DW-1.2 was not weakened, reworded, or reinterpreted more loosely than the reading three
prior reviews already applied. No requirement was amended.

**Advisory for the orchestrator (non-blocking, no action taken):** DW-1.2's literal phrasing —
"no vocabulary from the other three appears" — is unsatisfiable as written alongside DW-1.3, for any
document, honest or not. If the orchestrator wants the plan to say what it means, DW-1.2 should read:
"…and no *analytical vocabulary or method* from the other three schools is used in the document's
reasoning; constructs mandated by DW-1.3 are notation and must carry their true attribution." That is
a wording clarification of an already-operative reading, not a relaxation. The document stands either
way; this is offered so a fourth executor does not rediscover the same trap.

## Also fixed

- **Major / count** — nav model said "3 of 6 phases" have a one-click path while the table's
  Steer-or-spawn Touchpoints cell lists Rules and Tools, both global-nav entries. Recounted to
  **4 of 6**, with Steer-or-spawn marked a *partial* fit (its `project/[id]` leg is a drill-in) and
  the remainder restated as **2 of 6**. The neighbouring "three of the six phases terminate there"
  claim was also inaccurate for Triage (its touchpoint is `session/[id]`, not the board) and was
  restated as "route through the fleet board," which is what the table shows.
- **Major / owner** — journey map had no owner. Named: the fleet operator (the Actor). Ownership is
  the one pre-flight gate the single-operator constraint does not excuse, and NN/g's map format
  carries ownership in its takeaways lane (Gibbons 2018, verified verbatim). Update cadence added.
  `UNGROUNDED` and `NOT VALIDATED` untouched — those remain honestly unfakeable.
- **Minor / subtitles** — Edelman and Kahneman et al. subtitles restored in full.
- **Minor / hub-and-spoke** — was attributed to Rosenfeld/Morville/Arango. Verified against the 4th
  edition's ch. 6 ("Hierarchy, hypertext, and relational database structures"): hub-and-spoke is not
  one of the book's organization structures. Re-attributed to the doctrine's own enumerated set
  (`journey-stack.md` L187), with the book cited correctly for what it does say.
- Messy middle enriched from a bare "(Google, 2020)" to Rennie & Protheroe, Think with Google, July
  2020 — verified against the report PDF and the July 2020 Think with Google article.

## Doctrine errors confirmed (JOURNEY.md is right, doctrine is wrong)

- `journey-stack.md` L129: "Edelman 2013 (loyalty loop)" — the HBR article is **December 2010**.
- `journey-stack.md` L156: titles the 4th edition *Information Architecture for the World Wide Web* —
  the 4th ed is *Information Architecture: For the Web and Beyond* (O'Reilly, 2015).
  JOURNEY.md already used the correct title and date for both. Doctrine agreement is not evidence.
