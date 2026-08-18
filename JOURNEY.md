# JOURNEY.md

<!-- The structural and temporal design spec for Cockpit ("Outpost"). Pairs with DESIGN.md
     (visual tokens, produced in a later phase) — this document carries the structural and
     temporal spec that visual tokens alone can't encode. For visual tokens, see DESIGN.md
     (once it exists). -->

## Job

**Job story:** When several AI coding agents are running unattended across different machines and one of them stalls on a permission gate, breaks, or goes silent, I want to see which session needs me without opening every terminal or SSHing into every box, so I can approve, redirect, or kill it before it wastes the run's context and cost, or blocks work I'm waiting on.

**Functional job:** Triage every running agent session across every machine and project from one board; approve or deny the permission a blocked session is waiting on; spawn, steer, or stop a session; check spend against a daily budget before it surprises them.

**Emotional job:** Feel in control of a fleet they aren't watching continuously — confident that "needs you" really means needs-you, not anxious that something is silently stuck off-screen.

**Social job:** Be seen (by themselves, and by anyone they hand a session to) as someone running a disciplined, supervised fleet — not someone who fired off a dozen agents and walked away from the blast radius.

*(Attribution, split by construct. The **functional/emotional/social split** above is Moesta's three
sources of energy — Moesta & Engle, *Demand-Side Sales 101: Stop Selling and Help Your Customers
Make Progress*, Lioncrest, 2020. The **job-story sentence form** is not Moesta's and is not claimed
as his: it originates at Intercom and was first published by Paul Adams, "The dribbblisation of
design," Intercom, 18 September 2013 — "We frame every design problem in a Job… When _____, I want
to _____, so I can _____." Alan Klement gave the format the name "Job Story" — Intercom's own
record, Adams, "How we accidentally invented Job Stories," Intercom, 28 June 2016: "It didn't have
that name at the time (Alan Klement later named it for us)" — and published under that name in
Klement, "Designing Features Using Job Stories," Intercom, 23 December 2013. The sentence form is
adopted here as **notation only**: a template for writing one sentence. It is not a second analytic
school, and no analytic method attached to it is used. Every construct this document actually
reasons with — the four forces, the three energies, the Switch interview — is Moesta's, and that
remains the single school in use.)*

**Switch interview (Moesta four forces — Moesta & Engle, *Demand-Side Sales 101*, Lioncrest, 2020):**
- **Push:** Watching a fleet of agents by SSHing into each machine and attaching to each tmux/terminal session doesn't scale past two or three sessions; a blocked approval sitting unseen for hours is the concrete failure that created this job.
- **Pull:** One board across every machine, project, and session — plus a Telegram bridge that lets the operator approve a permission from a phone without being at a keyboard at all.
- **Anxiety:** The user reports the current dashboard's CSS and layout are buggy and were produced by a prior agent — the fear is that the replacement looks plausible but still hides or misreports a blocked session, which is worse than no dashboard (false confidence beats no confidence).
- **Habit:** Falling back to a raw terminal/tmux per machine when the dashboard doesn't clearly answer "is anything blocked right now" fast enough.

**JTBD school used:** Moesta (Switch interview).

---

## Journey

**Actor:** The fleet operator — the single person who owns every machine in this self-hosted deployment and every agent session running on it. Cockpit is single-tenant per deployment; there is exactly one operator role, never a team of distinct personas.

**Scenario:** A working day (or a working stretch that spans in-person and mobile time) in which the operator keeps several Claude Code / OpenCode / pi sessions moving across machines — starting some, checking on others, unblocking the ones that stalled, and closing the day confident nothing was left stuck.

**Scope:** Future-state (Cockpit's dashboard, redesigned from the existing implementation — the plan mandates discarding and re-deriving the current UI in full). Current-state baseline is the existing dashboard (7 route surfaces already on disk, reported buggy CSS/layout — see plan `## Context`), plus a raw-terminal/tmux fallback habit the operator reaches for when that dashboard doesn't answer fast enough; the baseline is not the absence of any dashboard. Touchpoints included: the browser dashboard (desktop and mobile web) and the Telegram bridge. Excludes the `cockpit` daemon's own internals and harness-level CLI usage, which are not surfaces this design phase touches.

**Journey map (NN/g swim lanes — Gibbons, "Journey Mapping 101," Nielsen Norman Group, 2018):**

| Phase | Actions | Mindset | Emotion | Touchpoints | Opportunities |
|-------|---------|---------|---------|-------------|----------------|
| **Fleet check-in** | Opens the dashboard (or its phone-sized view) and scans for anything blocked, errored, or unreachable across every machine at once. | "Is anything on fire right now?" — a fast binary scan, not a deep read. | Medium — mild vigilance, not yet alarmed. | Dashboard fleet board (`session`), Telegram digest/notification. | A single unmistakable "needs you" count that never requires opening a session to trust. |
| **Triage blocked sessions** | Opens each flagged session's transcript, reads the last agent turn and the pending permission request, decides approve / widen scope / deny / redirect. | "What is it actually asking, and is that safe to grant?" — reading for risk, not just status. | Low → rising if the request is ambiguous or the transcript is hard to scan. | Session detail/transcript (`session/[id]`). | Keep the permission-widening control spatially and visually separated from the primary approve action, so a rushed triage pass can't misclick into a blanket grant (Fitts's law, 1954 — near-zero travel cost to a high-cost target is itself a hazard). |
| **Steer or spawn work** | Starts a new session against a project, assigns rules/tool access, or redirects a running session with a follow-up instruction. | "What does this session need to be trusted to run unattended?" | Medium — this is deliberate, unhurried setup work, not reactive. | Project detail (`project/[id]`), Rules (`rules`, `rules/[id]`), Tools (`tools`). | Surface which rules and tools apply to a session at spawn time, not only after something goes wrong. |
| **Remote approval (away from the desk)** | Gets a Telegram message that a session is blocked, reads the request on a phone, approves or denies without opening a laptop. | "Is this safe enough to approve from a notification, or do I need the full context first?" | High, negative valence, if the request is unclear on a small screen — this is the day's single peak (not its end; see Wind-down). | Telegram bridge, mobile web dashboard. | The mobile/compact surface must carry enough of the transcript's context to approve responsibly, not just a bare command string — this is a first-class requirement, not a fallback view. |
| **Cost check** | Glances at spend against the daily budget, drills into `usage` only if a session is unexpectedly expensive. | "Am I about to blow the budget on a run I forgot was going?" | Low — routine unless a number surprises them. | Usage (`usage`). | Surface the alert threshold, not just the running total, so this stays a glance rather than a calculation. |
| **Wind-down** | Confirms nothing is left in a blocked or errored state before stepping away; leaves the fleet running unattended overnight or over a break. | "Can I actually leave this alone?" | High, positive valence, if confirmed clean — this is the day's end-point, not its peak (see Remote approval); the second half of the peak-end rule (Kahneman, Fredrickson, Schreiber & Redelmeier, 1993). | Dashboard fleet board (`session`). | The zero-blocked state should feel like a distinct, reassuring end state, not silence that could mean "nothing to report" or "not checked recently." |

**Decision model:** McKinsey loyalty loop (Court et al., *McKinsey Quarterly*, 2009; Edelman, "Branding in the Digital Age: You're Spending Your Money in All the Wrong Places," *Harvard Business Review*, December 2010). The operator's *first* extended use of the redesigned dashboard is the initial-loop decision (does the redesign earn enough trust to retire the buggy predecessor and the raw-terminal fallback habit?); every subsequent day is the loyalty loop — once "needs you" is trusted, the operator returns straight to check-in and skips re-evaluating whether the tool is worth using, exactly as the loyalty loop bypasses active re-evaluation after a positive post-purchase experience. This is not a messy-middle (Rennie & Protheroe, "Decoding Decisions: Making Sense of the Messy Middle," Think with Google, July 2020) situation: there is no live "consideration set" of competing dashboards each time the operator opens the board.

**Emotion curve:** Intensity starts medium during check-in, dips low during routine triage, then rises to the day's single peak during remote/mobile approval of an ambiguous request — high intensity, negative valence, the anxiety force from the Switch interview above made concrete — eases through cost check, and closes at Wind-down: a separate high-intensity, positive-valence end-point, not a second peak. The peak-end rule (Kahneman, Fredrickson, Schreiber & Redelmeier, "When More Pain Is Preferred to Less: Adding a Better End," *Psychological Science*, 1993; cited in the doctrine's `journey-stack.md` §Emotion curve guidance) treats the peak and the end as two distinct moments that dominate how an experience is remembered — this map keeps them distinct rather than collapsing both into one "peak-end" phase.

**Research basis:** UNGROUNDED. No interviews, diary studies, or support-call analysis have been conducted — this project has exactly one available informant (the user, consulted directly for the plan's `## Context` and constraints) and no separate user population to interview. Per the doctrine's pre-flight check (`journey-caveats.md` §Journey-map theater): this map's emotion curve is a reasoned hypothesis from the stated forces and scenario, not derived from research, and should be treated as such until revisited against real usage. **Owner:** the fleet operator — the same single person named as **Actor** above, who is this project's one informant and the only person able to act on the map. Naming an owner is the one pre-flight gate the single-operator constraint does *not* excuse: research basis and card-sort validation are blocked by having no second person, but ownership is not, and NN/g's own map format carries ownership in its takeaways lane (Gibbons, "Journey Mapping 101," Nielsen Norman Group, 2018). **Update cadence:** the owner revisits this map after the first real multi-day usage period, and again if a second operator or deployment ever exists to compare against; between those triggers the map is a standing hypothesis, not a current finding.

---

## IA

**Organization scheme:** Task (Rosenfeld/Morville ambiguous scheme — *Information Architecture: For the Web and Beyond*, 4th ed, Rosenfeld/Morville/Arango, 2015). The seven surfaces group by what the operator is doing (triage sessions, manage rules, browse tools, check spend), not by an exact alphabetical/chronological/geographical order.

**Structure type:** Hub-and-spoke — taken from the enumerated structure set in this project's journey doctrine (`journey-stack.md` §IA structure table, design-for-ai 4.2.0), *not* from the polar-bear book. Rosenfeld/Morville/Arango's own organization structures are hierarchy, hypertext, and the relational-database model (*Information Architecture: For the Web and Beyond*, 4th ed, 2015, ch. 6 "Organization Systems"); hub-and-spoke is not one of them, and an earlier draft's attribution of it to them was inherited from the doctrine and is corrected here. Read honestly against the journey table rather than asserted from the sitemap shape alone. Of the six journey phases, **four** (Fleet check-in, Triage, Remote approval, Wind-down) never touch a Tools/Rules/Usage spoke at all — their touchpoints are the hub (`session`, `session/[id]`) or the external Telegram channel, so they neither confirm nor contradict hub-and-spoke; they're silent on it. **Exactly one** phase, Cost check, shows the clean pattern the structure type predicts: it visits a single spoke (Usage) and nothing else. **Steer-or-spawn work is the one phase that deviates**: its Opportunities cell asks for a session→rules/tools contextual link, i.e. it crosses spokes directly (Project → Rules → Tools) without returning to the hub between them. So the structure claim rests on one phase's clean fit and one phase's documented exception — not on "most phases fit the pattern," which the table does not show. Session detail and Project detail are contextual drill-ins reached from the hub; Rules carries one further level of local tree structure (list → detail) beneath its spoke.

**Sitemap:**
```
Session (hub — fleet board)
├── Session/[id] (session detail / transcript — contextual drill-in from the hub)
├── Project/[id] (project detail — contextual drill-in from the hub)
├── Tools (spoke)
├── Rules (spoke)
│   └── Rules/[id] (rule detail — one-level local tree)
└── Usage (spoke)
```

**Global navigation labels:** Fleet, Tools, Rules, Usage. Corrected from an earlier draft that omitted the fleet board from global nav — three of the six journey phases route through the fleet board — Fleet check-in and Wind-down list it directly as their touchpoint, and Triage reaches its `session/[id]` transcript only by drilling in from it — the highest return frequency of any surface, so it gets a persistent global-nav entry like its three sibling spokes rather than being reachable only by an implicit "it's the arrival page" assumption. This also reconciles labeling with prose: **Fleet** in nav matches "fleet board" in the Job/Journey sections, and **Usage** in nav is the destination named by the "Cost check" phase — a reader landing on either label can trace it back to the phase that sends them there (Rosenfeld/Morville/Arango, 2015, on avoiding internal jargon that the sitemap alone doesn't reveal — see doctrine `journey-caveats.md` §"Sitemap ≠ IA").

**Navigation model:** Global navigation surfaces all four spokes (Fleet, Tools, Rules, Usage) persistently, giving a one-click path to at least one listed touchpoint for **4 of 6 phases**, counted against the journey table above: Fleet check-in and Wind-down (→ Fleet), Cost check (→ Usage), and Steer-or-spawn, whose Touchpoints cell lists Rules (`rules`, `rules/[id]`) and Tools (`tools`) — both global-nav entries. Steer-or-spawn is a **partial** fit and is counted as such: its remaining leg, Project detail (`project/[id]`), is a contextual drill-in with no global-nav entry, so the phase reaches two of its three destinations in one click and the third not at all. The other **2 of 6** have no one-click global-nav path to any of their destinations, by design, not by oversight: Triage's destination (`session/[id]`) is a contextual drill-in from within the Fleet hub, never a global-nav target itself; Remote approval's destinations are the Telegram bridge — an external channel with no in-app nav entry at all — and the mobile web dashboard, which is the same four-entry global nav on a smaller surface rather than a separate destination. **Known gap for Phase 2:** `project/[id]` currently has no list or creation entry point on disk (`apps/dashboard/src/routes/project/` contains only `[id]/`), yet Steer-or-spawn's action is to start a *new* session against a project — there is no specified way to reach or choose a project before a session exists. This IA does not invent that entry point; it is flagged here as an open structural gap for Phase 2's flows and page specs to resolve. Global-nav grouping is staged to reduce decision time for an operator scanning it mid-triage (Hick, "On the Rate of Gain of Information," *Quarterly Journal of Experimental Psychology*, 1952; Hyman, "Stimulus Information as a Determinant of Reaction Time," *Journal of Experimental Psychology*, 1953 — two separate papers, commonly paired as "Hick's law," applied per the doctrine's IA navigation guidance: grouping and staging reduces decision time for unfamiliar or time-pressured scanning, not a mandate to minimize the raw item count).

**Validation:** NOT VALIDATED. No card sort or tree test is possible — this is a single-operator, self-hosted tool with no second person to run either method against (Rosenfeld/Morville validation requirement, 2015). This structure is a reasoned default from the task-organization scheme above, not a validated IA, and should be revisited if a second operator or deployment ever exists to test it against.

---

## Marketing spine

N/A. Cockpit has no acquisition funnel — it is installed and used by its own operator, not marketed to a cold visitor. The persuasion spine, awareness-stage matching, and StoryBrand framing in the doctrine's `journey-stack.md` §Marketing persuasion spine do not apply to a self-hosted, single-operator control plane, and are omitted rather than filled with invented content.
