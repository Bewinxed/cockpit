# Discovery + Design: Phase 2 — Flows & page specs

## Artifacts Found / Current State

**`JOURNEY.md`** exists and is gate-passed (commit `79a896e`). It carries `## Job`, `## Journey`,
`## IA`, `## Marketing spine`. It carries **no** `## Flows` and **no** `## Page specs` — those are
this phase's output. The three committed sections are read-only for this phase.

**Routes on disk** — literal output of `find apps/dashboard/src/routes -type f | sort`:

```
apps/dashboard/src/routes/+layout.svelte
apps/dashboard/src/routes/+page.server.ts
apps/dashboard/src/routes/+page.svelte
apps/dashboard/src/routes/api/[...path]/+server.ts
apps/dashboard/src/routes/project/[id]/+page.svelte
apps/dashboard/src/routes/project/[id]/+page.ts
apps/dashboard/src/routes/rules/+page.svelte
apps/dashboard/src/routes/rules/+page.ts
apps/dashboard/src/routes/rules/[id]/+page.svelte
apps/dashboard/src/routes/rules/[id]/+page.ts
apps/dashboard/src/routes/session/+layout.svelte
apps/dashboard/src/routes/session/[[id]]/+page.svelte
apps/dashboard/src/routes/tools/+page.svelte
apps/dashboard/src/routes/tools/+page.ts
apps/dashboard/src/routes/usage/+page.svelte
apps/dashboard/src/routes/usage/+page.ts
```

`find apps/dashboard/src/routes -name "+page.svelte" | wc -l` → `7`. The root `+page.svelte`
carries the comment `<!-- Never rendered: +page.server.ts redirects to the session index. -->` and
`+page.server.ts` is `redirect(307, '/session')`. So the 7 files resolve to the 7 *surfaces* in the
IA sitemap once the root redirect is discounted and `session/[[id]]` is counted as the two surfaces
it serves (`session` = fleet board, `session/[id]` = transcript) — which is exactly what
`session/+layout.svelte` says it does: *"The route under this is `[[id]]`, one route for both URLs,
so moving between the board and a conversation is a parameter change the router swaps no components
for."*

**Connection model** (first-hand, `lib/cockpit/client.svelte.ts`):
- L70: `export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';`
- L302–303: `status: 'disconnected' as ConnectionStatus,` / `/** When the next reconnect attempt fires, so the banner can count it down. */`
- L1081: `throw new Error('Not connected to the hub. Check that it is running, then try again.');`
- L1115: `export function reconnectNow(): void` — "Reconnects now instead of waiting out the backoff."
- L1676: `` reject(new Error(`${label} got no answer in time. The machine may be offline.`)); ``

So a hub-unreachable state already has four named phases plus a countdown and a manual retry. The
page specs bind their Error states to these four, not to a generic "request failed".

**Permission UI** (`lib/cockpit/PermissionCard.svelte`) — three answers, not two:
`let resolved = $state<'allow' | 'deny' | null>(null);` (L25), buttons `Deny` (L125, `aria-label="Deny"`),
`Always allow {rule.short} ({rule.scope})` (L140), `Allow` (L167, `aria-label="Allow"`), with
keyboard accelerators `N` / `⇧Y` / `Y`. The current DOM order is
`Deny → [flex-1 spacer] → Always allow → Allow` — i.e. the **scope-widening** action sits
*immediately adjacent* to the primary. This is the exact hazard `JOURNEY.md` §Journey flagged in the
Triage row's Opportunities cell, and it is unresolved on disk.

**Usage is declared read-only on disk** — `routes/usage/+page.svelte` L145:
`dollars. No primary action; this surface is read, not operated.`

## Gaps

1. **The Phase-1 `project/[id]` gap.** Confirmed first-hand: `ls -R apps/dashboard/src/routes/project`
   → `[id]` only; there is no `/project` list route. But the entry points *do* exist outside the
   route table:
   - `lib/cockpit/JumpPalette.svelte` L30–38 builds a `'Projects'` group with `href: \`/project/${project.id}\``.
   - `lib/cockpit/Sidebar.svelte` L1168 renders `<NewProjectPopover />` inside a `Sidebar.GroupLabel`.
   - `lib/cockpit/NewProjectPopover.svelte` L3–6: *"Names a directory so the rail has a folder for it
     before anything has run there. Every other folder in the rail is grown from live work, which
     leaves no way at all to add the checkout you have not started yet — this is it."*
   - `SessionTabs.svelte:490` and `FolderMenu.svelte:86` both `goto(\`/project/${project.id}\`)`.

   **Resolution (design decision, not a new route):** the fleet hub's own **Projects rail** is the
   project index, and ⌘K is its recognition-over-recall twin. Adding an eighth `/project` list
   surface would contradict the hub-and-spoke IA (a spoke nobody's journey phase visits) *and* break
   DW-2.1's count of 7. The gap is closed by **specifying the rail as a named content block of the
   `session` page spec**, with "New project" as its creation entry point, and by naming the rail and
   ⌘K as the entry points in the `project/[id]` spec. This is documented in the artifact, not left
   implicit.

2. **`usage` has no primary action on disk**, but the page-spec template requires a Primary CTA field
   (DW-2.2). Resolved honestly: the Cost-check journey phase's own action is *"drill into `usage` only
   if a session is unexpectedly expensive"* — so the primary CTA is the drill-in to the top-spend
   session, which is a real action the surface can carry, not an invented one. The spec records that
   the current implementation has none.

3. **Doctrine's feedback-tier table is a composite, not one source.** `ui-patterns.md` L31 states
   `<0.1s no indicator · 0.1–1s none-to-subtle · 1–10s spinner/skeleton · 10s+ percent + notify` with
   no citation. The **boundaries** are Nielsen's; the **skeleton-over-spinner choice inside the
   1–10s band** is the doctrine's own pattern bridge. The artifact attributes each half separately
   rather than passing the whole table off as Nielsen.

4. **Doctrine ships a wrong severity formulation.** `usability-principles.md` says
   `Severity ≈ frequency × impact × persistence`. The primary source says severity is *"a combination
   of three factors"* plus market impact — it is not stated as a product. The artifact states it as a
   combination.

## Gate Status

- **DESIGN.md:** does not exist yet (produced in Phase 3). Nothing to honor; nothing to violate. This
  phase emits no tokens, colors, sizes, or visual treatment — per the plan's `OUT` scope.
- **JOURNEY.md:** present, gate-passed. This phase **appends** `## Flows` and `## Page specs` and does
  not touch `## Job`, `## Journey`, `## IA`, or `## Marketing spine`.
- **Prerequisites:** met. Phase 1 is complete and committed.

## DW Verification

8 DW-IDs in the dispatch prompt; 8 rows below.

| DW-ID | Done-When Item | Status | Evidence that will prove it |
|-------|---------------|--------|-----------------------------|
| DW-2.1 | `## Page specs` entry count = sitemap page count (7) | COVERED | `grep -c '^### ' JOURNEY.md` scoped to the Page specs section → 7, matched against the 7 sitemap lines and the 7 `+page.svelte` files on disk |
| DW-2.2 | Every page spec carries 6 required fields + 5 named states | COVERED | `grep -c` per field label (`**Purpose:**`, `**Entry points:**`, `**Content blocks`, `**States:**`, `**Primary CTA`, `**Exit`) → 7 each; `grep -c '^- Default:'` … `'^- Success:'` → 7 each |
| DW-2.3 | Every flow documents Type, Entry, Goal, Steps, Error states, Success state + back-nav / session expiry / network failure | COVERED | `grep -c` per label across the Flows section → equal to the flow count; `grep -c 'Back-navigation'`, `'Session expiry'`, `'Network failure'` → equal to the flow count |
| DW-2.4 | Every decision node cites Hick; every primary CTA cites Fitts; no destructive action adjacent to a primary CTA | COVERED | Every `◆` decision line carries `(Hick–Hyman …)`; every `**Primary CTA` line carries `(Fitts 1954)`; each spec carries an explicit `**Destructive separation:**` line naming what is separated and how |
| DW-2.5 | Every surface carries `comfortable` or `compact` + rationale | COVERED | A `## Density classes` table with 7 rows, plus a `**Density:**` line in each of the 7 page specs; `grep -c '\*\*Density:\*\*'` → 7 |
| DW-2.6 | Findings table with exactly `Severity \| Heuristic / law \| Problem \| Fix`, every row 0–4, sorted by severity, complement caveat stated | COVERED | The header row is emitted verbatim; each row's first cell is a bare integer 0–4 in non-increasing order; the caveat sentence cites the primary source |
| DW-2.7 | Every Loading state names its feedback tier; no bare spinner for a >5s load | COVERED | Each `- Loading:` line names one of the four tiers by its boundary; `grep -in 'spinner' JOURNEY.md` returns only the *prohibition* text, never a prescription |
| Inherited | Resolve the `project/[id]` entry-point gap | COVERED | The `session` page spec names the Projects rail as a content block with a creation control; the `project/[id]` spec names the rail, ⌘K, and the two context menus as entry points, each traced to a file:line |

**All items COVERED:** YES

## Design Decisions

### Citation policy for this phase

Phase 1 failed three times on citations, and the doctrine files ship at least four wrong or
uncited claims (two found in Phase 1, two more found here — see Gaps 3 and 4). So this phase
**cites few things, each verified against a primary source fetched in this session**, and declines
to cite anything it could not verify. The web-research delegate dispatched for this returned
"UNVERIFIABLE — no retrieval capability in this session" for all ten items, so the verification was
redone directly. Sources fetched and quoted in this session:

| Claim | Verified source | Fetched |
|-------|-----------------|---------|
| Nielsen's 10 heuristics | Nielsen, "10 Usability Heuristics for User Interface Design," Nielsen Norman Group, **April 24, 1994** (last reviewed 30 Jan 2024). Origin per the article's own note: Nielsen & Molich (1990), "Heuristic evaluation of user interfaces," *Proc. ACM CHI'90*, 249–256; refined in Nielsen (1994a), "Enhancing the explanatory power of usability heuristics," *Proc. ACM CHI'94*, 152–158 | `nngroup.com/articles/ten-usability-heuristics/` |
| 0–4 severity scale | Nielsen, "Severity Ratings for Usability Problems," Nielsen Norman Group, **November 1, 1994**. Literal: *"0 = I don't agree that this is a usability problem at all … 4 = Usability catastrophe: imperative to fix this before product can be released"*; severity is *"a combination of three factors"* — frequency, impact, persistence (**not** a product) | `nngroup.com/articles/how-to-rate-the-severity-of-usability-problems/` |
| 0.1 / 1 / 10s response limits | Nielsen, "Response Times: The 3 Important Limits," NN/g, **January 1, 1993**, excerpt from ch. 5 of *Usability Engineering* (1993), citing **Miller, R. B. (1968), "Response time in man-computer conversational transactions," *Proc. AFIPS Fall Joint Computer Conference* Vol. 33, 267–277**. Literal: *"percent-done progress indicators should be used for operations taking more than about 10 seconds"* and *"Anything slower than 10 seconds needs a percent-done indicator as well as a clearly signposted way for the user to interrupt the operation."* | `nngroup.com/articles/response-times-3-important-limits/` |
| Percent-done indicators | Myers, B. A. (1985), "The importance of percent-done progress indicators for computer-human interfaces," *Proc. ACM CHI'85*, 11–17 — as cited in the Nielsen article above | same |
| Touch target minimum | **WCAG 2.2, W3C Recommendation 12 December 2024**, SC 2.5.8 Target Size (Minimum), **Level AA**: *"The size of the target for pointer inputs is at least 24 by 24 CSS pixels"*, with five exceptions (Spacing, Equivalent, Inline, User Agent Control, Essential) | `w3.org/TR/WCAG22/` + `w3.org/WAI/WCAG22/Understanding/target-size-minimum.html` |
| Hick's law, Fitts's law | Carried forward verbatim from Phase 1's verified forms; not re-derived | — |

**Declined:** Doherty threshold, Jakob's law, Kurosu & Kashimura, Cowan 2001, Norman 1988/2013. Each
appears in the doctrine and each is a real risk of a wrong year/venue. None is load-bearing for any
DW item, so none is cited. Fewer claims cited correctly beats many cited loosely.

### Pattern selection runs constraint → law → pattern

The plan forbids picking a pattern and justifying it afterwards. Every pattern in the artifact is
introduced by its constraint first. The four that drive the design:

| Constraint (from the journey / the code) | Selecting law | Pattern it picks (over the alternative) |
|---|---|---|
| The blocked-session answer has three outcomes, one of which (Always-allow) is irreversible and currently sits next to the primary | Fitts (1954) | Allow as the large trailing primary; Always-allow demoted out of the action row into a disclosed "widen scope" control **over** three equal-weight adjacent buttons |
| An agent run has no known duration and routinely exceeds 10s | Nielsen 1993 / Myers 1985 | determinate step-and-count progress **plus** an out-of-band Telegram notification and a signposted interrupt **over** an indeterminate spinner |
| A fresh install has zero machines and every surface is empty at once | Peak-end (empty states) | a single first-use state that names the one next action (join a machine) **over** seven independent blank panels |
| Coarse pointer on the transcript, where compact density would put rows under 24 CSS px | WCAG 2.2 SC 2.5.8 AA | compact relaxes to ≥24 CSS px (targeting 44 for the approve/deny pair) **over** shrinking with the ramp |
| The hub can be off, unreachable, or mid-restart — four named connection states already exist in code | Nielsen #1 visibility of system status (1994) | one persistent connection band shared by every surface, carrying the state and the retry countdown **over** per-request error toasts |

### Density

One `compact` (the transcript) and six `comfortable`, per the plan's *"Compact is reserved for the
transcript and its dependents."* The transcript's *dependents* — the permission stack and the peek
pane — inherit compact wherever they render, including when they surface on the fleet board; that
inheritance is stated as a note under the density table rather than as a second class on a surface,
so each of the 7 surfaces still carries exactly one class.

### Narrow width

Every spec states reflow, collapse, and the coarse-pointer primary action. The rule the plan sets —
*"Adapted is fine; removed is not"* — is enforced by making each narrow-width paragraph say where the
adapted control went, never that it is gone.

## Corrections made during production

A parallel inventory of every route and component landed after the first draft of the artifact and
**falsified four claims in it**. All four were corrected against the source, verified first-hand
before the correction. Recording them because a reviewer given only the artifact cannot see that
they were caught:

| Claim in the first draft | What the source actually says | Correction |
|---|---|---|
| "A dead hub and a quiet fleet render identically" | A reconnect banner **does** exist — `Shell.svelte` L259: `Hub connection lost — retrying in {countdown}s` + `Reconnect now` | Narrowed to the true and sharper defect: L139 gates it on `wasConnected`, set only after a successful open (L136), so a browser that loads **while the hub is already down gets no banner at all** — only the board's `No machines yet` empty state. That is the common case for a self-hosted hub (opening the dashboard before starting the daemon) |
| "`tools` stacks four independent inventories under one `<h1>`" | It is **tabbed**, not stacked — `Tabs.Root` over five tabs (`Tools` · `MCP servers` · `Skills & plugins` · `Agents` · `Memory`) held in `?tab=` | Finding downgraded and largely rejected: tabs are the correct pattern and are kept. The residual defect is only that each panel takes its own error prop, so a fleet-wide failure is discoverable only by opening the tab it broke. The page spec's content blocks and narrow-width paragraph were rewritten around tabs, and its primary CTA became per-panel |
| "`usage` renders upstream strings with no recovery action" | Two known errors **are** mapped to plain language (L192–196) — only the fallback branch is raw | Rewritten: the two plain-language messages are correct and kept; the real defects are the raw fallback and that **none of the three carries an action**, only a diagnosis |
| "There is no way to choose a project before a session exists" (inherited from `## IA`) | `SpawnPanel.svelte` L583–588 contains a project picker — `<label for="spawn-project">Project (optional)</label>`, `placeholder="Search projects…"`, filtering `cockpit.projects`, empty case at L622 | The inherited gap is **narrower than `## IA` stated** and the artifact says so explicitly. The capability exists; what is missing is a *visible index*. The resolution (promote the Projects rail to a named content block of `session`) is unchanged and now better grounded |

Two further facts from the inventory were folded in rather than corrected: `SessionPane.svelte` L1892
renders `Reading transcript…` beside a **spinner** on a cross-machine load that needs virtualisation
(a real on-disk instance of the mistake DW-2.7 names, now a severity-2 finding), and
`AttentionQueue.svelte` answers permissions **inline on the fleet board** with `Allow` / `Deny` /
`Open`, which the `session` page spec now covers as a named content block with two constraints on it.

## Post-review corrections (review gate, round 2)

Phase 2 passed its gate on all 7 DW items and all 13 citations, with the severity-4 `PermissionCard`
finding independently confirmed. Four Major findings were returned and all four are fixed. Three were
factual misreads on my part — I had claimed absences that the code does not have:

| # | My claim | Source line that falsifies it | Fix |
|---|---|---|---|
| 1 | "Only `rules` has a designed empty state; the rest render blank" | `FleetBoard.svelte` L503–513 is a full onboarding card carrying the literal join command `COCKPIT_HUB_URL=ws://<this-host>:3456/ws bun run agent`; L514–520 is a second, user-cleared state. Every tools panel has designed copy too (`ToolMatrix` L149/L164, `FleetMcp` L115, `FleetSkills` L142/L225/L313, `FleetAgents` L144/L216, `FleetMemory` L337/L403) | Row re-derived surface by surface and **re-rated 2 → 1**. Empty states are now recorded as among the strongest work in the codebase. Residual defect narrowed to repetition *within* one panel: `FleetSkills` states the same machine prerequisite at L207 and L349 |
| 2 | "No banner at all on a cold load with the hub down" | `FleetBoard.svelte` L305–307: `{#if cockpit.status !== 'connected'}<span class="text-caption">hub {cockpit.status}</span>` | Restated as a **hierarchy inversion**, not silent failure: the state is present but caption-sized with no countdown or retry, while the same surface shows a confident `No machines yet` card. The `wasConnected` gate (L139, set at L136) remains the real defect. **Re-rated 4 → 3** |
| 3 | "No surface carries a determinate reading at the board level" | `LiveSessionRow.svelte` L116–118 renders `<TaskRing done={progress.done} total={progress.total} size="sm" />` and `{progress.done}/{progress.total}`; `FleetBoard.svelte` L437 renders that row; `LiveSessionMenu.svelte` L66–67 carries `<IconStop /> Stop` | Row rewritten as mostly rejected. Real residual found and verified: L44, `const progress = $derived(plan && plan.tasks.length > 0 ? taskProgress(plan) : null)`, and `TaskRing` draws nothing at `total === 0` — so a **plan-less** open-ended run gets no determinate reading, which is precisely the Tier-4 case. **Re-rated 3 → 2** |

**4 — Backwards pattern derivation.** Five nodes presented the on-disk shape first and cited the law
after, which is the failure mode the plan's constraint names. All five re-derived forward as
*constraint → law → pattern*, with the on-disk match demoted to corroboration: Flow 2's payload
disclosure, Flow 4's instruction-vs-empty branch, Flow 5's template-vs-scratch branch, the `session`
spec's attention-queue block, and the `tools` spec's inventory selector. All five patterns survived
honest forward derivation and were kept; the `tools` one gained a real discriminator it lacked before
(addressability is what selects tabs *over* an accordion, and that was never stated when the pattern
was being justified backwards).

Table re-sorted after re-rating: severities now `[4, 3, 3, 3, 2, 2, 2, 2, 1, 1, 1, 0]`, descending,
all within 0–4. All 8 DW items re-verified after every edit.

## Recommendation

**BUILD**
