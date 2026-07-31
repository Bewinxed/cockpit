# NEW.md — Cockpit Rework Brief

**This file is the single source of truth for the rework.** It was distilled on
2026-07-30 from a full audit of this repo, a type-level diff of the Claude Agent
SDK (0.1.77 → 0.3.220), and ecosystem research. Read it fully before touching
code. Do not re-derive or re-litigate anything stated here as decided. Where
CLAUDE.md and this file disagree, this file wins.

The failure mode this file exists to prevent: this repo was previously killed by
serial re-planning — seven planning docs, four stacked migrations, each
abandoned halfway. **No new planning documents.** Plans live here; tasks live in
`.flow/bin/flowctl` (create new epics; epics fn-1 through fn-12 are legacy
history, never re-anchor to them). Finish over polish: the user has explicitly
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
   PRD/research/CLAUDE.md, pinned docs first), its flowctl epics with progress,
   recent + active sessions, and start-session/side-quest actions. Strictly a
   view over the repo's files + flowctl — **no separate document store, no
   WYSIWYG, no issue tracker.** Light markdown editing via the `fs` verb at
   most. (Happy 2's "rig-documents"/"file-viewer" plans reach the same
   files-as-truth conclusion.)

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

Naming: the product is **Cockpit** everywhere — package scope `@cockpit/*`,
env vars `COCKPIT_*`, one hub port default **3456**. The agentdeck/cockpit
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
  item 4: docs rail (rendered repo markdown, pinned PRD first), flowctl epics
  + progress, sessions list, spawn actions. *Done when: opening a project
  answers "what is this, what's the plan, what's happening" without a
  terminal or editor.*
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
- Tasks in flowctl (new epics only), plans in this file, nowhere else.
- Verify by running: `bun run dev` (hub+agent+dashboard) and driving the real
  UI, not just typecheck. The old repo's checklist was full of "✅ works"
  claims that were false — trust only what you've exercised.
- When old code disagrees with this file, this file wins. When the SDK's real
  types disagree with this file, the types win — note the drift here in one
  line, don't write a new doc about it.
