# NEW.md — Cockpit Rework Brief

**This file is the single source of truth for the rework.** It was distilled on
2026-07-30 from a full audit of this repo, a type-level diff of the Claude Agent
SDK (0.1.77 → 0.3.220), and ecosystem research. Read it fully before touching
code. Do not re-derive or re-litigate anything stated here as decided. Where
CLAUDE.md and this file disagree, this file wins.

The failure mode this file exists to prevent: this repo was previously killed by
serial re-planning — seven planning docs, four stacked migrations, each
abandoned halfway. **No new planning documents.** Plans live here, nowhere
else. Finish over polish: the user has explicitly
said they fixate on minor things — when a choice arises between shipping the
working loop and improving a detail, ship the loop.

---

## 1. Product

Cockpit is a **self-hosted, multi-machine mission control for Claude Code
sessions**. Sessions run on the user's own hardware; the control plane and
transcripts stay on their infrastructure. This niche is verified open (checked
2026-07-30): Anthropic's Remote Control relays through Anthropic servers and
requires a claude.ai subscription; `claude agents` is single-machine;
Desktop SSH is one host at a time. Nothing self-hosted and multi-machine exists.

North star (in priority order):

1. **Subagent observability.** See every machine → session → live subagent →
   tool call, at a glance AND drill-down. Top-level fleet view answers "what is
   everything doing right now / what needs me"; clicking in goes as deep as a
   single tool result diff.
2. **Side quests.** One-click ephemeral exploration: fork a session (or spawn a
   throwaway one in a git worktree), try an idea, keep it or discard it.
   Scratch sessions are visually distinct from mainline work.
3. **Machines as peers** (model borrowed from slopus/happy2): a remote
   machine's sessions appear identically to local ones — same screens, same
   code paths, just Connect/Disconnect. No remote-specific branches above the
   connection layer.
4. **Project home** (Linear-style, files-as-truth): a project page that shows
   the project's documents (rendered markdown from the repo via the `fs` verb —
   PRD/research/CLAUDE.md, pinned docs first), recent + active sessions, and
   start-session/side-quest actions. Strictly a view over the repo's files —
   **no separate document store, no WYSIWYG, no issue tracker.** Light
   markdown editing via the `fs` verb at most. (Happy 2's "rig-documents"/
   "file-viewer" plans reach the same files-as-truth conclusion.)

Explicitly NOT the product: teams/collaboration, channels, a Slack clone,
multi-provider harnesses (Codex/Kimi). One user, their machines, Claude.

---

## 2. The decision: fresh spine, same repo, quarry the old code

The existing implementation was written by weaker models against SDK 0.1.x and
died mid-migration (two tab systems that never got bridged — the primary click
path renders an empty workspace; a stores→remote-functions migration stalled
halfway; 544 dashboard type errors). The middle layer fights the SDK: a
35-method bespoke JSON-RPC protocol re-models what the SDK exports, and a
1,300-line conversation-graph DB re-implements what the SDK now ships built-in.

Therefore: **build new packages clean; treat old code as a quarry, not a
foundation.** Extract specific proven pieces (list in §6) one at a time,
updating them to new SDK types as they cross the boundary. Delete each old
package/app once its replacement is load-bearing. Never import from a legacy
package into a new one "temporarily."

---

## 3. Stack (decided — do not re-open)

| Layer | Choice | Notes |
|---|---|---|
| Runtime | Bun (workspaces monorepo) | `bun:sqlite`, built-in WebSocket, `Bun.file`, `Bun.$` |
| Agent SDK | `@anthropic-ai/claude-agent-sdk` pinned `0.3.220`+ | facts in §4 |
| Backend style | **Effect v4** — `effect@beta` (4.0.0-beta.102 as of 2026-07-30) | services/layers, typed errors, Effect.Schema where schemas are needed server-side |
| HTTP/WS server | **Elysia 2.0 "DayDream"** — `elysia@next` (2.0.0-beta.1, released 2026-07-30) | write v2-native code (§5); do NOT copy 1.x patterns from old hub |
| DB | Drizzle + `bun:sqlite` | tiny registry only (§7) — no message tables |
| Frontend | SvelteKit 2 + Svelte 5 (runes) | keep — the renderers to preserve are Svelte |
| Styling | Tailwind 4, existing Flexoki v2 theme + TX-02 mono font | keep the visual identity from `apps/dashboard/src/app.css` |
| UI kit | bits-ui / shadcn-svelte, **only components actually used** | the old app vendored ~400 files, ~90% unused — never do that again |

Beta risk, accepted knowingly: Elysia 2.0's plugin ecosystem (incl. Eden
Treaty) may lag. Mitigation: dashboard↔hub traffic is overwhelmingly WebSocket
+ SvelteKit remote functions; the few REST calls can be plain `fetch` with
shared types until Eden supports 2.0. If an Elysia 2 beta bug genuinely blocks,
pin a newer `2.0.0-exp/beta` build rather than falling back to 1.x.

Effect v4 scope: hub and agent-service internals (session supervision,
reconnect, credential refresh, RPC dispatch) — places with retries, resources,
and typed failure. Don't force Effect into the SvelteKit app.

## 4. Claude Agent SDK 0.3.220 — verified facts (typed against real d.ts, 2026-07-30)

- **v1 `query()` with an `AsyncIterable<SDKUserMessage>` prompt is the blessed
  multi-turn API.** The v2 session API (`unstable_v2_createSession` etc.) was
  deprecated in 0.2.133 and **deleted** in 0.3.142. The old repo's
  `persistent-session.ts` pattern (InputStream feeding query()) is the right
  shape — port the pattern, not the file.
- **Sessions are first-class:** `listSessions({dir?, limit?})`,
  `getSessionInfo(id)`, `getSessionMessages(id, {limit?, offset?})`,
  `renameSession`, `tagSession`, `deleteSession`, `forkSession` (as
  `Options.forkSession: true` + `resume`), `listSubagents(id)`,
  `getSubagentMessages(id)`. `SDKSessionInfo` carries `sessionId, summary,
  lastModified, customTitle?, firstPrompt?, gitBranch?, cwd?, tag?, createdAt?`.
- **`sessionStore` option (alpha):** mirror session transcripts to an external
  backend "so any host can resume them." This is the sanctioned cross-machine
  session mobility primitive — the hub implements a sessionStore backend
  instead of owning a message schema.
- **Subagent tree is handed to you:** `parent_agent_id` on subagent messages
  (added 0.3.202) for building agent trees; `forwardSubagentText`,
  `agentProgressSummaries` options. Depth cap is now 1 (was 5), concurrency
  capped at 20 (`CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`).
- **Permissions:** `canUseTool` now receives a `requestId` for correlating
  out-of-band responses — use it as the permission-relay key end to end.
- **Dialogs:** `onUserDialog` + `supportedDialogKinds` (CLI fails closed on
  undeclared kinds) replace the old AskUserQuestion interception hack. On
  multi-client sessions the first attached client's declaration wins.
- **`Query` handle methods** (call through the control tunnel, never re-model):
  `interrupt()`, `setPermissionMode()`, `setModel()`, `supportedModels()`,
  `supportedCommands()`, `setMaxThinkingTokens()`, `getContextUsage()`,
  `accountInfo()`, `mcpServerStatus()`, `readFile()`, `rewindFiles(userMessageId,
  {dryRun?})` (+ `skippedLinks` in responses), `reinitialize()` (re-delivers
  blocked permission/dialog requests after a transport gap — use on reconnect),
  `streamInput()`, `stopTask()`, `close()`.
- **Useful `Options`:** `effort`, `thinking`, `maxBudgetUsd`, `taskBudget`,
  `persistSession: false` (ephemeral sessions — side quests), `title`,
  `includePartialMessages`, `enableFileCheckpointing`, `stderr`,
  `spawnClaudeCodeProcess` (custom process spawner for remote/container),
  `systemPrompt`, `settingSources`, `mcpServers`.
- **Breaking vs 0.1.x:** TodoWrite is gone (Task tools: TaskCreate/TaskUpdate/
  TaskGet/TaskList — the old `mcp-task-tracker` package and `task.updated`
  pipeline are dead concepts); MCP servers connect in background by default
  (init message may report `status: "pending"`); zod peer dep is now v4.
- The public `Transport` interface exists (docs mention WebSocket/SSE
  transports and multi-client fan-out) but subprocess `query()` is the
  supported path — do not build on undocumented `--sdk-url`.
- Cautionary tale: omnara (2.6k stars) died wrapping the Claude Code CLI —
  "unfeasible to maintain." Stay on the SDK. Never parse CLI output.

## 5. Elysia 2.0 — write v2-native (breaking vs the old hub's 1.x code)

`resolve()` → `derive()`; lifecycle hooks drop the `on` prefix (`request`,
`parse`, …); scope `{as:'scoped'}` → `'plugin'`; error handling maps Error
classes directly (no `code` strings) with RFC 9457 `problem()` helper;
WebSocket is an opt-in `websocket()` plugin using generator functions with
`yield` for type-safe streaming (fits the frame-relay design perfectly); route
schema/options precede the handler; `aot: false` is removed. TypeBox 1.3;
Standard Schema supported (Effect.Schema can plug in). A codemod exists
(`bunx @elysia/codemod`) but we write fresh — the old hub is not being ported.

Drift log (real installed types vs the summaries above; types win — §9):
- Elysia 2: `websocket()` imports from `elysia/websocket`; WS handlers are
  still `message(ws, body)` (generators optional, not the calling convention);
  WS lifecycle hooks are per-route, not on the plugin; TypeBox 1.3 is the
  `typebox` package (renamed from `@sinclair/typebox`), a required peer along
  with `exact-mirror`; incoming WS strings are JSON-parsed by default.
- Elysia 2 WS: a NEW `ElysiaWS` wrapper is constructed per lifecycle callback —
  socket objects have no stable identity across open/message/close; key every
  registry on the memoized `ws.id`, never on the wrapper reference.
- Subagent attribution (corrects §4): live `SDKMessage`s carry
  `parent_tool_use_id` (the Agent tool's use id) — that is the tree key.
  `parent_agent_id` exists only on stored `SessionMessage`s and is always
  null at depth 1. The spawn tool is named `Agent` (detect via
  `subagent_type` in input); `task_started/updated/notification` frames
  carry description, last tool, and `agentProgressSummaries` output.
- Svelte 5 runes: a `$state` proxy never writes back to its target object —
  after `record[key] = literal`, return/keep `record[key]` (the proxy), never
  the literal; mutations on the raw literal are invisible to the UI.
- Effect v4: `Effect.async` → `Effect.callback`; no `Effect.Service` — use
  `Context.Service` classes + curried `Layer.effect(Key)(effect)`; capped
  backoff is `Schedule.min([exponential, spaced])` + `Schedule.jittered`;
  Schema is `effect/Schema`, not `@effect/schema`.
- Transcript rendering (extends §8 polish): the session view virtualizes via
  `virtua` (Virtualizer + external scrollRef; `ssr.noExternal` required) and
  ingests stored transcripts newest-first in turn-aligned chunks; the wire
  still ships the whole JSONL in one `getSessionMessages` reply — chunked
  transport over the tunnel is the known follow-up. Native find is replaced
  by store-backed Ctrl+F (virtualized DOM defeats browser find).
- Harness-agnostic rework (2026-08-13, supersedes §1's "not multi-provider" and
  §6's claude-only tunnel): the wire now speaks a cockpit-owned neutral spine
  (`packages/core/src/harness.ts` — `HarnessKind = claude|opencode|pi`,
  `NeutralMessage`, `NeutralSessionInfo`, capabilities). The agent runs one
  `Harness` adapter per runtime (`packages/agent/src/harnesses/{claude,opencode,pi}.ts`);
  the hub and dashboard are harness-agnostic, gated by per-harness capabilities.
  `SpawnPayload` gains `harness`/`resume:{sessionKey,fork,atMessage}`/
  `persistSession`; frames are `kind:'frame'` (+ a legacy `sdk`→`frame` shim in
  the hub so a not-yet-restarted daemon keeps streaming); the `instances` row
  gains `harness`. The SDK is now an agent-internal dep — `@cockpit/core` no
  longer imports it (the old `SDK*` type names are neutral aliases). opencode
  runs its server per machine via `@opencode-ai/sdk`; pi via the in-process
  `@earendil-works/pi-coding-agent` (no permissions by design). Migrations
  `0012`/`0013` add the `harness`/`harnesses` columns (split into two files —
  drizzle's sqlite migrator runs only the first statement of a multi-statement
  file).   The three "gaps" closed 2026-08-13: **fleet sync** is per-harness
  (`Harness.syncFleet`/`fleetStatus`, shared file-sync in
  `harnesses/fleet-common.ts` — opencode converges `~/.config/opencode/` skills/
  memory/`opencode.json` mcp, pi `~/.pi/agent/` skills/memory); **hand-off tools**
  are shared (`harnesses/handoff-shared.ts`) and exposed by claude's MCP server,
  pi's `customTools`, and an opencode plugin the harness writes into
  `~/.config/opencode/plugins/cockpit-handoff.js` (which reaches the fleet over
  the hub's new `POST /api/relay/{spawn,send}` REST relay, reading
  `COCKPIT_HUB_URL`/`COCKPIT_MACHINE_ID` off the env the daemon sets); **tasks**
  translate opencode's native `todo` list through a `getTodos` control (pi has
  none and stays off).
- Part-carrying opencode events (`message.part.updated`) carry the session id
  only inside `properties.part.sessionID`, never `properties.sessionID`
  directly — routing and streaming text (`properties.delta`, while `part.text`
  is the full accumulated text) fixed 2026-08-14.
- opencode's own defaults allow almost every tool; cockpit injects ask-rules
  via `createOpencode`'s `config` option (which reaches the server through
  `OPENCODE_CONFIG_CONTENT`) and maps its permission modes in the hand-off
  plugin's `permission.ask` hook. The `question` tool's default is **allow**
  (not deny); when the model uses it a `question.asked` event rides the v1
  `client.event.subscribe({query:{directory}})` stream with `properties.id` +
  `properties.questions`. The opencode harness answers it itself via the
  directory-scoped `POST /question/{id}/reply` (and `/reject`) REST routes, so
  the turn completes instead of hanging — no `question` key exists on the real
  `Config['permission']` type.
- opencode reads `~/.claude/skills/` and falls back to the claude memory file
  itself, so its own skills/memory fleet sync was dropped from the opencode
  harness (`syncFleet`/`fleetStatus` now only converge MCP).
- An abort surfaces as `session.error` with `error.name ===
  'MessageAbortedError'` — treated as a turn ending (`result` subtype
  `aborted`), not a session failure.
- A live opencode server asks permissions as `permission.asked`
  (`{id, sessionID, permission, patterns, metadata, always, tool}`), not the
  `permission.updated` the v1 SDK types declare — verified by raw capture
  2026-08-14; the adapter listens for both literals.
- Delegation stays on the tunnel, not on A2A (decided 2026-08-14, functionality
  retained in full): the fleet's own frames/verbs already carry the task
  lifecycle A2A models (busy=working, permission/question=input-required,
  result=completed, handoff=follow-up), and no harness speaks A2A natively — an
  internal adoption would be a second protocol re-modeling the first (§2's
  failure mode, imported). A2A belongs at the hub edge as an optional future
  gateway (agent card → relay spawn/send, task status ← frames, auto-report as
  the completed artifact), built on the delegate primitives, after a
  current-spec research pass. ACP is likewise noted only as a possible future
  harness adapter, not a delegation wire.
- Delegate sessions (2026-08-14): `SpawnPayload.parent` + the `instances`
  `parent_instance_id`/`parent_tool_use_id` columns track parentage
  structurally. The `delegate` tool on all three harnesses spawns a scratch
  child; the HUB auto-delivers each delegate turn's final text to its parent as
  a queued peer report (aborted turns skipped), so no prompt protocol is
  injected — guidance flows back through `handoff`. Parent-scoped brakes:
  `stop_delegate`/`interrupt_delegate` on all three harnesses, guarded twice
  (tool-side and hub-side) so a session can only brake its own delegates;
  interrupt is the fleet's pause. Urgent hand-offs: claude injects mid-turn via
  `streamInput`, opencode/pi interrupt-then-deliver with a factual note;
  parent-scoped, and the hub downgrades anything else to a normal queued send.
- opencode composer `/commands` route through `POST /session/:id/command` (the
  body's `model` is a plain string, unlike prompt's object); `resume.atMessage`
  without fork maps to `session.revert` (rewind capability on); the machine
  catalog aggregates `project.list × session.list(directory)` and filters child
  sessions (`parentID`) out of the rail.
- opencode adapter: provider retry/status notices surface as system `provider_retry` frames; errors carry name+status+message verbatim (errorText).
- hub: a delegate's failed turn reports the harness error text instead of "(no text)".
- dashboard: unknown system subtypes render their `content` verbatim.
- dashboard: hand-off briefs dedup between live peer echo and stored transcript (SDK storage strips `origin` — measured, peer-echo-proof.ts); stored briefs render as peer messages.
- dashboard: plain harness tasks (task_type local_bash) no longer mint subagent cards; completions render as one system.task line, suppressed when a real branch exists; subagent report bodies are capped/log-aware (OutputBlock).
- dashboard: vendor model-provider logos via unplugin-icons (`@iconify-json/logos` + `@iconify-json/thesvg-color`) — `providerOf(model)` in `models.svelte.ts` maps a model id to its lab; `ProviderLogo.svelte` renders the mark (nothing on unknown, so callers keep their fallback).
- dashboard: delegate card upgraded — width-capped at the prose idiom, `fly` entrance, the `handoffBrief` as a two-line task line, the delegate's cumulative cost (`$0.0000`, mono/tabular), and an in-card `max-h-96` transcript that sticks to the bottom while working.
- delegates: a delegate's `question`/`ask` routes to its parent session as `answer_delegate`; only the parent's death escalates it to the user.
- delegates: spawned with `bypassPermissions` (a child of a session that already passed the gate).
- dashboard: `result` frames report cost on success too — `FrameMapping.cost` lands on `SessionState.totalCost` (a successful turn's cost has no transcript line to scrape).
- dashboard: delegate reports fold into the delegate card (Report section, log-aware via OutputBlock) instead of rendering as `user.peer` handoff bubbles; the bubble is suppressed only when the card is provably in the transcript.
- dashboard: delegate asks now parse to `user.delegate_ask` via the `[delegate-ask …]` marker (survives SDK storage), fold into the DelegateBranch card as an Asks section with answered/denied/pending state, and never render as raw user bubbles (2026-08-15).
- dashboard: delegate auto-reports parse via the `[Report from delegate <name>#<short8> — turn complete|failed]` header (stored copies carry only the short id — `matchesSession` prefix-matches); ask bodies unpack from `tool — {json}` (`askBodyParts`/`askShort`/`askDetail`, never raw JSON, never Markdown); `answer_delegate` calls render as readable receipts (AnswerDelegate renderer); handoffs to one's own delegate render "Follow-up to <label>" instead of a raw uuid (2026-08-15, hand-applied).
- dashboard: the permission card knows opencode's lowercase tool names (`edit`/`bash`/`webfetch`, `filepath` key), caps long input values (diffs) in scrollable blocks, and the hover-expanded permission stack is capped at 50vh — a delegate ask storm no longer fills the viewport (2026-08-15, hand-applied).
- delegates: the hub's `delegate_events` table is the system of record for a delegate's asks, answers and reports; the dashboard consumes it (`GET /api/delegate-events?parent=|instance=` on open, `delegate_event` frames live — a settled ask is not re-broadcast, so the client folds an `answer` into its ask's status by requestId) and transcript marker parsing (`[delegate-ask …]`, `[Report from delegate …]`) is the legacy fallback for sessions that predate the table. The daemon auto-allows tool asks under `bypassPermissions` — opencode's plugin permission hook is dead at 1.18.14, verified (2026-08-15).
- fleet-forced web tooling: search is the Exa MCP and fetch is the firecrawl MCP (both in the fleet MCP registry, §11), so the daemon denies the built-ins — `disallowedTools: ['WebSearch','WebFetch']` merged into every Claude spawn's options, `webfetch: 'deny'` on the opencode server (a deny publishes no permission event, so `autoAllows` never sees it), and `permissions.deny` converged into `~/.claude/settings.json` at boot for the `claude` the user starts by hand (2026-08-15).
- dashboard: the beui.dev port wave (2026-08-16) — beautifului.dev ships no code (newsletter teaser), so beui.dev's open registry was the cloned source (its `EASE_OUT` is byte-identical to `--ease-out-expo`). Landed: `AgentPresence` (3×3 pixel grid + shimmer + elapsed, shown from send until the tail is visibly alive; `showsPresence` in `presence.ts` is the rule, and a live thinking tail suppresses it), the MessageScroller follow protocol grafted onto virtua (intent-driven leave-live-edge incl. `pointerdown`, programmatic-scroll guard, smooth growth-follow), Shiki dual-theme code everywhere through one `agent-code.ts` pipeline (tool cards, markdown fences via Streamdown's `code` snippet, bash-well command lines painted / output plain, `vitesse-light`/`-dark`), ThinkingBlock live-shimmer + "Thought for Ns" (`thinkingDurationMs`; stored transcripts read plain "Thought" — `SessionMessage` carries no timestamp, fixing that is a core+daemon change awaiting an idle window), `SourcesStrip` under answers from Exa/firecrawl results (`sources.ts`, real result shapes only), composer send↔stop morph + `DictationButton` (SpeechRecognition, renders nothing where absent), FleetBoard status filter chips (`statusOf` files any red row under Needs-you, deliberately out-counting the queue), and `SelectionActions` (quote any transcript passage into the composer; Playwright-verified). New dep: `shiki@4` only — `motion@13` was staged for spring parity but every port landed on CSS/Svelte transitions/`.pressable`, so it was removed rather than shipped unused.
- thinking is evidence, fleet-wide (2026-08-16): the dashboard's tail renders a 4-step precedence (`presence.ts` doc is normative) driven by the partial stream — `streamPhase` in `frames.ts` reads `content_block_start/stop`, `thinking_delta`, `signature_delta` ("Finishing thought…"), and tool_use starts; `LiveThinking` streams the reasoning trace (clamped 6 lines, top fade); with no evidence the presence line says "Working…"/"Running N agents", never "Thinking…". `NeutralStreamMessage.event` in core was widened with the thinking events (the opencode adapter emits them typed; the claude adapter still forwards raw SDK partials through `toNeutral`'s cast, and the dashboard reads those by shape — the union under-describes claude partials on purpose). The settled block's "Thought for Ns" prefers `metadata.thinkingDurationMs`, stamped by the client's own clock, because two blocks of one frame share a mapped timestamp and adjacency reads 0 there. Opencode's adapter streams reasoning live (start/delta/stop with prefix-diffing, main sessions only, children buffered as before) — awaiting a daemon cycle. Delegate rows carry `SpawnPayload.title` (brief's first line, hub migration 0017, `instances.title`) — daemon side also awaits the cycle; the opencode plugin's own delegate tool was left untitled deliberately, it is dead code at 1.18.14. Observed while verifying: the remote Mac's daemon predates the harness rework (`harness: null` shim rows) and emits no partials at all — its sessions have no streaming until that daemon is redeployed.

---

## 6. Architecture: the tunnel

**Principle: tunnel the SDK, never re-model it.** `packages/core`'s only job is
the thin envelope + re-exported SDK types. The dashboard imports SDK message
types directly (type-only imports). Every SDK feature should reach the UI as
"frames flow through + optionally add a renderer" — one layer of work, not five.

```
Dashboard (SvelteKit)
   │  WebSocket (frames + control) & remote functions (SSR reads)
Hub (Elysia 2 + Effect)          ← relay + registry + sessionStore backend
   │  WebSocket per agent (same envelope)
Agent daemon (Bun + Effect)      ← spawns query(), pumps frames verbatim
   │  in-process
Claude Agent SDK 0.3.x
```

The protocol is ~7 verbs, not 35:

| Verb | Direction | Purpose |
|---|---|---|
| `register` / heartbeat | agent→hub | machine identity (keep stable `machineId` fingerprint), health |
| `spawn` | hub→agent | start `query()` with Options passed through verbatim |
| `send` | hub→agent | forward an `SDKUserMessage` into the session's input stream |
| `stop` | hub→agent | end a session / kill the child |
| `control` | hub→agent | generic passthrough: invoke a named `Query` method with args, return result (covers interrupt, models, rewind, context usage, everything in §4) |
| `frames` | agent→hub→dashboard | every SDK message verbatim (+ `machineId`/`instanceId` envelope); includes permission `canUseTool` and `onUserDialog` requests keyed by `requestId` |
| `fs` | hub→agent | directory listing for the cwd picker (+ small file read/write for CLAUDE.md editing) |

Hub responsibilities and nothing more: agent registry, instance registry,
project grouping, credential storage + OAuth refresh + distribution (quarry the
old flow — it worked), sessionStore backend, frame fan-out to dashboard
clients, pending permission/dialog relay keyed by SDK `requestId`.

**DB: 4 tables.** `agents`, `instances`, `projects`, `credentials` — plus
whatever blob table the sessionStore backend needs. **No messages/threads/
spans/blocks/tool_invocations tables.** Message history is served from SDK
session storage (`getSessionMessages` via the agent, or the sessionStore
mirror when the machine is offline).

Auth: none on the hub surface for now (explicit user decision — Tailscale
network is the trust boundary). Don't add auth scaffolding.

Naming: the product is **Outpost** (renamed from Cockpit, user decision
2026-08-07): UI copy/wordmark first; internal identifiers (`@cockpit/*`,
`COCKPIT_*`) migrate in a coordinated pass because the daemon restart it
forces is gated on idle sessions. Package scope `@cockpit/*`, env vars
`COCKPIT_*`, one hub port default **3456** until that pass. The agentdeck/cockpit
split-brain (env vars `AGENTDECK_HUB_URL` vs `COCKPIT_HUB_URL`, ports
3456/4000/3000/3847 in different files) was a real bug class in the old code.

---

## 7. The quarry — what to extract from legacy code (and what's radioactive)

Port deliberately, one piece at a time, updating types to SDK 0.3:

- **Message renderers** (the investment to preserve):
  `apps/dashboard/src/lib/components/features/ChatMessage.svelte`,
  `ToolGroup.svelte`, `DiffView.svelte`, `DiffModal.svelte`, the
  `message-renderers/` registry pattern (priority-sorted plugin registry) with
  `ThinkingBlock`, `ResultError`, `CompactBoundary`, `LoginPrompt`,
  `MemoryPicker`, `ModelPicker`, `AskQuestionPicker` (re-target to
  `onUserDialog`), `MCPStatus`.
- **Flow view** (`features/flow/` + `src/lib/utils/flow-*.ts`): @xyflow/svelte
  + dagre DAG of a conversation — re-base node data on `parent_agent_id`
  instead of heuristics. Port after chat works, it's priority 2's drill-down.
- **Realtime client plumbing**: reconnect with exponential backoff + HMR-safe
  teardown in `apps/dashboard/src/lib/stores/index.svelte.ts`; the
  `query.batch` remote-function pattern in `src/lib/data.remote.ts`.
- **OAuth**: all of `packages/auth` (PKCE flow, `~/.claude/.credentials.json`
  compatible format) and the hub's refresh + env-var distribution flow in the
  old `hub-server/src/api/instances.ts` + `agent-service/src/handlers/spawn.ts`.
- **Theme**: `apps/dashboard/src/app.css` (Flexoki v2 tokens, shadow ladder,
  radius) + `src/fonts/` TX-02 files (drop the `__MACOSX/` junk).
- **Patterns only** (reference, don't copy files): `persistent-session.ts`'s
  InputStream-feeding-query() shape; `Sidebar.svelte`'s structure;
  `MessageList.svelte`'s message grouping; machineId hardware fingerprint in
  `packages/core/src/utils/id.ts`; mDNS discovery if wanted (SSH-style
  enrollment like happy2 is the better long-term story).

Radioactive — never port, delete on sight: both old tab systems
(`url-sync.svelte.ts` AND the broken AppShell wiring), the 35-method protocol
(`packages/core/src/protocol/`), `instance-tracker.ts` and the conversation-
graph schema, `packages/mcp-task-tracker`, the ~400-file `ui/` vendored kit,
orphaned components (`TopBar`, `StatusBar`, `WorkspaceTabs`, `SubagentTree`,
`StreamingIndicator`, icon trio), hardcoded `#37352f` Notion-brown buttons in
three renderers (use theme tokens when porting those files). Unrelated root
leftovers (comfyproxy, root src/, update-creds.ts, stale docs, pnpm locks,
old tests/scripts) were already deleted on 2026-07-30.

---

## 8. Execution phases (each has a hard done-criterion; do them in order)

- **Phase 0 — Scaffold.** New packages `packages/core`, `packages/agent`,
  `packages/hub` (fresh, Effect v4 + Elysia 2), `apps/dashboard` stays but gets
  a new minimal shell route. Pin SDK 0.3.220. Rewrite CLAUDE.md to match
  reality. *Done when: `bun run typecheck` is clean on new packages.*
- **Phase 1 — One machine, one session, one browser tab.** Agent daemon spawns
  `query()`, hub relays frames, dashboard shows a streaming chat with the
  ported ChatMessage/ToolGroup renderers, input box sends messages,
  permissions surface via `requestId` relay. THE loop. *Done when: you can
  have a full working conversation with tool approvals from the browser.*
- **Phase 2 — Sessions & machines.** `listSessions`/`getSessionMessages`
  through the tunnel; resume; sidebar of machines→projects→sessions; second
  machine connects and looks identical (peer model). ONE tab system:
  route-based `/session/[id]`. *Done when: two machines' sessions are
  browsable, resumable, and streaming side by side.*
- **Phase 3 — Observability.** Fleet view: every session's state
  (working/blocked-on-permission/idle), live tool-call activity, subagent tree
  from `parent_agent_id` (flow view re-based). *Done when: with 3+ concurrent
  sessions the top-level view answers "what needs me?" in one glance.*
- **Phase 4 — Side quests.** Fork-session button (`forkSession` +
  `persistSession:false` option), worktree spawn for scratch experiments,
  scratch section in sidebar, keep/discard. *Done when: idea → fork → verdict
  without touching a terminal.*
- **Phase 5 — Project home.** The Linear-style project page from north-star
  item 4: docs rail (rendered repo markdown, pinned PRD first), sessions
  list, spawn actions. *Done when: opening a project answers "what is this,
  what's happening" without a terminal or editor.*
- **Phase 6 — Polish.** Only now: design pass, animations, keyboard palette,
  empty states. Delete remaining legacy packages and this section's
  temptations until here.

Legacy deletion cadence: at the end of each phase, delete every legacy file the
phase obsoleted. The rework is complete when `apps/dashboard` contains no
pre-rework code paths and `packages/{agent-service,hub-server,db,core}`'s old
implementations are gone.

## 9. Working rules

- Bun everywhere; no Node-isms (`ws`, `better-sqlite3`, `node:fs` where
  `Bun.file` works).
- Plans in this file, nowhere else.
- Verify by running: `bun run dev` (hub+agent+dashboard) and driving the real
  UI, not just typecheck. The old repo's checklist was full of "✅ works"
  claims that were false — trust only what you've exercised.
- When old code disagrees with this file, this file wins. When the SDK's real
  types disagree with this file, the types win — note the drift here in one
  line, don't write a new doc about it.
- SDK drift: `bypassPermissions` cannot be entered live —
  `setPermissionMode` refuses it unless the session was launched with
  `allowDangerouslySkipPermissions` — so switching into it relaunches the
  session on its own SDK session. Every other direction switches live,
  downgrades out of bypass included.
- SDK drift: `query()` holds its process back until the session is given
  work, so a relaunch's first frame is no signal that it is up. `spawn` carries
  an optional `requestId` and the agent answers it with a `control_result`.
- Script drift: §12 promises the hub under `bun --watch` in dev, but the root
  `hub` script ran the watchless `start` — a hub frozen at boot-time code
  looked like missing endpoints. Root script now calls `dev` (2026-08-07).

## 10. Tool provisioning

Machines carry the user's workflow CLIs — opencode and the Antigravity CLI
today, more later. One click and automatic: a `tools` policy table on the hub
says what every machine must have; the daemon reports `ToolStatus[]` in
`register`; the hub answers with machine-scoped `installTool` controls for
whatever is missing. No new verb — `listTools`/`installTool` join `listRepos`
in the machine-scoped control set. The catalog is data
(`packages/core/src/tools.ts`): adding a tool is one `ToolSpec` — ordered
per-OS install methods, `needs` prerequisite gating, `pinnedCommand` for
version pins, a `native` escape hatch for installs no portable one-liner can
express. The agent's executor is generic and never names a tool. A failed
install waits for a click instead of retrying on every register (the daemon
remembers failures per boot). Last-known status lives in an `agents.tools`
JSON column and rides the `instances` frame, so every dashboard follows
installs live; the UI is one `/tools` machines × tools matrix with per-cell
install/retry and a per-tool "required everywhere" toggle. Deliberately not
here: tool auth (opencode's auth.json and Google's login stay the user's),
sudo-needing installs, and upgrade flows beyond re-running the installer.
Gemini CLI was the original ask and is deliberately absent: Google cut
consumer access on 2026-06-18 and points terminals at the Antigravity CLI;
swapping the entry was one spec object, which is the point of the catalog.

## 11. Fleet MCP + skills, and the `/` menu

One place manages what every machine's Claude Code can reach. The hub owns
the desired state (three tables: `mcp_servers`, `marketplaces`, `plugins`);
a machine-scoped `syncFleetConfig` control applies it and answers with a
`FleetSyncReport`; the hub sends it on register and on any change, so a new
machine converges the moment it appears. Status lands in an `agents.fleet`
JSON column and rides the `instances` frame. No new verbs.

How applying works (verified against CLI 2.1.223 docs, 2026-08-07):
- **MCP servers** merge into `~/.claude.json` top-level `mcpServers` — user
  scope loads for every project and the SDK reads it regardless of
  `settingSources`. A sidecar (`~/.claude/cockpit-fleet.json` — one file
  for the MCP, marketplace and plugin lists alike) names what cockpit
  manages; anything else in any file is never touched.
  `bunx <pkg>` is the quick-add path for stdio servers; the daemon writes
  the runner's absolute path (Windows: `cmd /c` only for `.cmd` shims —
  stdio servers spawn without a shell). Remote servers are `http`/`sse`
  entries with headers; `${VAR}` expansion is the CLI's own.
- **Skills** arrive two ways. Plugin bundles (which can carry MCP servers
  and hooks, not just files) install through the plugin system, headless:
  the daemon runs `claude plugin marketplace add <source>` and
  `claude plugin install <plugin>@<marketplace> --scope user`, both
  idempotent; state is read back from `~/.claude/plugins/
  {known_marketplaces,installed_plugins}.json`. A `marketplaceCatalog`
  control reads a linked marketplace's `marketplace.json` so the dashboard
  can browse what is installable. Plain skills are **fetched directly**:
  the hub resolves `npm:pkg@ver` / `github:owner/repo/path@ref` / a raw
  URL to the skill's files once, hashes them, and sync carries the files —
  a daemon writes `~/.claude/skills/<name>/` only on a hash change.
  Installer CLIs (`npx impeccable`-style) are deliberately never run on
  machines: an installer is a wrapper around copying files, and cockpit
  does the copy itself — no Node, no TTY, one download for N machines,
  removal deletes exactly what the sidecar says cockpit wrote.
- **Reload**: new sessions pick everything up (MCP config is read at
  session start by CLI design — no forced restarts of working sessions;
  per-session relaunch is the opt-in). Skill file edits hot-reload live.
- **`/` menu**: the composer's command palette exists and was never fed.
  Init frames carry `slash_commands` + `skills` on every turn;
  `supportedCommands()` (already reachable — the agent reflects any Query
  method) adds descriptions/argument hints; the SDK's `commands_changed`
  push replaces the cache mid-session. `AvailableCommand` is hoisted to
  core (it was declared three times in the dashboard) and derived from the
  SDK's `SlashCommand`.

**Scopes.** Every row carries Claude Code's own placement: `user` (every
machine — `~/.claude.json` top-level `mcpServers`, `~/.claude/skills/`,
plugins `--scope user`), `local` (one project, privately — the
`projects["<cwd>"]` map in `~/.claude.json`, plugins `--scope local`), or
`project` (one project, shared — repo-root `.mcp.json`, plugins `--scope
project`). A project-bound row defaults to `local`, so cockpit never dirties
a working tree unless the reader asks it to. The hub resolves `projectId` →
`cwd` as it sends a sync, and a machine only receives the project rows that
live on it.

**Discovery and adoption.** A machine's existing config is never touched and
was, at first, never seen either — half a feature. `inspectConfig(cwd?)`
reports what a machine really has (all scopes, managed and not) and what a
session in `cwd` would see; the dashboard runs it the moment a folder is
chosen for a session and on the project page. Unmanaged rows are shown
beside fleet rows with an **Adopt** action: an MCP definition is copied into
the hub, and a skill's files are read off that machine
(`readSkillFiles`) and stored like any fetched skill — so a skill written on
one machine reaches the rest. Adoption is always explicit, and a fleet
server shadowed by a nearer scope says so rather than looking broken.

**Subagents** joined the fleet config 2026-08-08: each is stored as its
verbatim markdown file keyed by the front matter's `name`, and the hub writes
`<home>/.claude/agents/<name>.md` over the `fs` verb — on save, on register
and on a manual re-push — until daemon-side sync (Phase B) takes over
convergence and, with it, removal.

Deliberately not here: MCP server OAuth (each machine's `claude mcp login`
stays its own), enterprise managed-settings surfaces, and writing hooks or
subagents that a skill ships outside its own directory.

## 12. Services, and updating a fleet you are editing

Cockpit supervises the code it is built from, so "keep it running" and "keep it
current" are one problem. `cockpit service install [hub|dashboard|agent]`
writes per-user services — systemd units on Linux, LaunchAgents on macOS (on a
Mac the LaunchAgent is not optional: only a job inside the Aqua session can
read the login keychain Claude Code keeps credentials in). Everything is
per-user: no sudo, nothing outside `$HOME`.

Each service gets the update rule its risk deserves:

- **hub** — restarting it costs nothing: sessions live in the daemons, which
  reconnect with backoff, and state is on disk. `install --dev` runs it under
  `bun --watch`, so an edit is live in a second.
- **dashboard** — `--dev` runs vite itself (invoked directly with `--port`;
  vite ignores `PORT`, and a unit that claims a port it does not hold is worse
  than no unit). Prod serves the built bundle. Same port either way.
- **agent** — never watched, never restarted automatically. It hosts the
  sessions a restart would cut in half. `cockpit service restart agent` asks
  the hub how many of this machine's sessions are mid-turn and refuses while
  any are; `--when-idle` waits for them; `--force` overrides. When the hub
  cannot be reached to answer, it refuses rather than guessing — restarting
  blind is what cost two sessions on 2026-08-07.

**Knowing a machine is behind.** Every daemon reports its `BuildInfo` (package
version, short commit, whether the checkout is dirty, boot time) on register;
the hub reports its own on `/health`. A machine quietly a month behind is the
normal failure of a fleet edited while it runs, and this is what lets a rail
say so instead of the user meeting it as a protocol error.

**Catching one up.** `POST /api/agents/:machineId/update` runs the
`updateCockpit` control: `git pull --ff-only`, `bun install`, a dashboard
build where a dashboard is served, then restarts. It refuses a dirty checkout
unless forced — a dev machine must never be clobbered. The agent and the hub
schedule their own restarts a second late, so the report reaches the caller
before the socket carrying it dies; the report says what actually happened,
and a step asked for but skipped says why.

Deliberately not here: updating a machine that is not a git checkout,
cross-version protocol negotiation (the fleet is one user's, and the answer to
skew is to update), and Windows services.
