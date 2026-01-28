# Cockpit Dashboard UX Rework

## Phase 1: Discovery

**What the app does:** Cockpit is a multi-agent management dashboard for Claude Code sessions. It's analogous to a "mission control" for AI coding agents running across machines.

**Core user tasks:**
1. **Monitor** running Claude instances across machines (agents)
2. **Chat** with instances — send messages, see streaming responses, tool use, subagents
3. **Manage permissions** — approve/deny tool usage requests
4. **Spawn new instances** on connected agents
5. **Switch views** — chat (linear) vs flow (DAG visualization)
6. **Navigate** between instances via tabs, sidebar, command palette

**UI structure:**
- **TopBar** — logo, search (cmd+K), notifications bell, connection dot
- **Sidebar** — instances grouped by project, agents section
- **Workspace** — tab bar + WorkspaceInstance (the main view per instance)
- **StatusBar** — connection status, running count, cost, theme toggle, version
- **Overlays** — command palette, notification center, new instance modal

---

## Phase 2: UX Audit

### Overall Layout: 5/10

**Problems:**
1. **Three chrome bars competing for space.** TopBar (48px) + tab bar (40px) + instance header (40px) + status bar (36px) = 164px of chrome before you see any content. On a 900px laptop that's 18% of the screen consumed by navigation. Compare: VS Code uses ~80px total (activity bar + tab bar).

2. **Duplicated information.** Connection status appears in BOTH TopBar (dot) and StatusBar (text + dot). Running instance count is in both Sidebar header and StatusBar. Cost appears in both instance header and StatusBar. Notification bell is in TopBar AND StatusBar has a permissions count.

3. **Instance header is right-aligned only** with no title/breadcrumb on the left — wastes the entire left half of a 40px bar for just tokens/cost/model/actions on the right.

4. **Sidebar is thin and grouped by project** but the project grouping forces an extra level of hierarchy even when most users probably have 1-2 projects. The collapse/expand adds friction.

5. **Tab bar lacks key features** — no drag-to-reorder, no overflow handling, no tab grouping. With 5+ instances it becomes a row of truncated labels.

### Chat View: 6/10

**What works:**
- Clean message layout with avatars
- Grouped tool invocations (ToolGroup)
- Streaming indicator with activity states
- Subagent parallel visualization

**Problems:**
1. **1717-line monolith component.** WorkspaceInstance handles chat rendering, activity state machine, message loading, client commands, login flow, model picker, memory editor, question handling, message editing, OAuth, resume — everything. This isn't just a code quality issue, it means the UX is a grab-bag of concerns stuffed into one view.

2. **Chat input is bare.** Just a textarea + send button. No file attachment, no image paste, no mention/reference, no formatting hints. Compare Claude.app or ChatGPT which have richer input affordances.

3. **The "Jump to present" button** sits at `bottom-20 right-8` — awkwardly positioned, can overlap with scroll content.

4. **Empty state messaging is vague** — "What project are we working on today?" doesn't help a new user understand what to do.

5. **Permission requests appear above the input** as a horizontal bar, but the notification center is a separate panel in the top-right. Two different places to deal with permissions.

### Flow View: 4/10

**Problems:**
1. The toggle between chat/flow is a small icon pair in the instance header — easy to miss.
2. Flow view has no visible loading/empty state handling from what I can see.
3. The transition between views uses `slide` animation on the x-axis which feels disorienting for what's essentially a layout mode switch.

### New Instance Modal: 5/10

**Problems:**
1. Lots of advanced options (bypass permissions, plan mode, env vars, tool restrictions) behind a disclosure — but the basic flow (pick agent, pick directory, type prompt) could be much simpler.
2. No template/preset system for common setups.
3. File browser for directory selection is a separate nested modal — modal-in-modal.

### Command Palette: 6/10

**What works:** Quick instance search, basic actions. The `cmd+K` shortcut is standard.

**Problems:** Limited actions, no keyboard-first navigation patterns beyond what exists. "Stop All Instances" is TODO.

### StatusBar: 3/10

**Problems:**
1. Cost display ("$0.00 today") is vague — whose cost? All instances? Just running ones?
2. "v0.1.0" wastes space.
3. Theme toggle in the status bar is unconventional — belongs in settings or a menu.
4. The "running" filter button is hidden down here — most users won't discover it.

---

## Phase 3: Ideal Design

If designing from scratch for a polished product (think: Linear meets Cursor meets Vercel dashboard):

### Layout Philosophy
- **Maximize workspace.** One thin combined header (32-36px) with logo, tabs inline, and actions. No separate tab bar. No status bar.
- **Sidebar is optional.** Most interaction happens through tabs and the command palette. Sidebar appears on demand or for overview.
- **Status is contextual.** Connection/cost/agent info shows in the instance header, not a global bar.

### Component Structure
1. **HeaderBar** — Logo | [inline tabs] | search | notifications | connection
2. **Workspace** — Full-height, instance content fills everything
3. **InstanceView** — Split into clean sub-components:
   - `MessageList` — just renders messages
   - `ActivityIndicator` — standalone streaming/tool state
   - `InputArea` — rich input with attachments, commands
   - `PermissionsBar` — inline permission requests
4. **Panels** (overlays, not separate pages):
   - Command palette (cmd+K)
   - Instance inspector (right slide-out for details/settings)
   - Notification center

### Reference apps for patterns:
- **Linear** — minimal chrome, keyboard-first, inline status
- **VS Code** — tab management, split views, command palette
- **Cursor** — AI chat in editor context, streaming UX
- **Vercel** — clean dashboard, status-aware cards

---

## Phase 4: Implementation Plan

Comparing ideal to current, prioritized by impact. The architecture migration (item 0) is the foundation — everything else builds on it.

---

### 0. Migrate from global singleton stores to SvelteKit remote functions

**The core problem:** The current architecture uses module-level singleton stores (`SvelteMap`-backed classes exported from `$lib/stores/*.svelte.ts`). These are populated by:
1. SSR: an `initializeFromSSR()` call that mutates the global store on the server — but this state is **never serialized** into the HTML payload. The client starts with empty stores.
2. WebSocket: real-time events mutate the same globals via handlers like `instances.handleCreated(data)`.

This is fundamentally un-SvelteKit. SvelteKit's data model is: **load functions provide data, the framework serializes it, components consume it reactively.** Global mutable singletons bypass all of that.

**The target architecture:**

```
┌────────────────────────────────────────────────────────────┐
│  data.remote.ts (query/command functions)                   │
│  - getAgents(), getInstances(), getProjects()              │
│  - getInstanceMessages(id)                                  │
│  - spawnInstance(), stopInstance() (commands)               │
│  Runs on server, framework handles SSR serialization       │
└────────────────────┬───────────────────────────────────────┘
                     │ consumed via `await` or `.current`
                     ▼
┌────────────────────────────────────────────────────────────┐
│  Components                                                 │
│  - Use `await getInstances()` directly in markup           │
│  - Or `const q = getInstances(); q.current / q.loading`    │
│  - Mutations via commands: `await stopInstance(id)`         │
│  - Commands call `.refresh()` to invalidate queries        │
└────────────────────────────────────────────────────────────┘
                     │
                     │ WebSocket only for PUSH events
                     ▼
┌────────────────────────────────────────────────────────────┐
│  ws-events.svelte.ts (thin WebSocket layer)                │
│  - Receives real-time events (streaming, permissions, etc) │
│  - Calls query.set() / query.refresh() to update remote    │
│    function caches — NOT separate global stores            │
│  - Ephemeral state only (streaming text, activity state)   │
│    lives in component-local $state or small context stores │
└────────────────────────────────────────────────────────────┘
```

**What changes:**

| Current | Target |
|---------|--------|
| `agents.svelte.ts` (SvelteMap singleton) | `getAgents()` remote query, consumed via `await` |
| `instances.svelte.ts` (SvelteMap singleton, 800+ lines) | `getInstances()` / `getInstance(id)` remote queries |
| `projects.svelte.ts` (SvelteMap singleton) | `getProjects()` remote query |
| `permissions.svelte.ts` (SvelteMap singleton) | Component-local `$state` fed by WebSocket events |
| `questions.svelte.ts` (SvelteMap singleton) | Component-local `$state` fed by WebSocket events |
| `ui.svelte.ts` (global UI state) | Stays as-is — UI state (sidebar, theme) is legitimately global |
| `instances.getMessages(id)` | `getInstanceMessages(id)` remote query per instance |
| `instances.getStreamingState(id)` | Component-local `$state` fed by WebSocket |
| `stores.populatedInstances` (cross-store derivation) | `$derived` in components that need it, composing query results |
| `stores.stats` (cross-store derivation) | Derived locally where needed |
| `stores.instancesByProject` | Derived locally in Sidebar |
| `initializeFromSSR()` | **Deleted.** Remote functions handle SSR automatically. |
| `+layout.server.ts` | **Deleted.** Not needed — remote functions replace it. |

**What stays the same:**
- `ui.svelte.ts` — sidebar state, command palette, theme, view mode. These are truly global client-side state.
- WebSocket connection setup — still in `onMount` in the layout. But instead of mutating global stores, WS handlers call `query.set()` or `query.refresh()` on the remote function caches to push real-time updates into the framework's data layer.

**Migration steps (ordered):**

**Step 0a: Expand `data.remote.ts` with all needed queries/commands.**
Currently it has `getAgents`, `getInstances`, `getProjects`, `getTabMessages`. Add:
- `getInstance(id)` — single instance
- `getInstanceMessages(id)` — messages for one instance
- `stopInstance(id)` — command
- `spawnInstance(...)` — command
- `sendMessage(instanceId, message)` — command
- `respondToPermission(...)` — command

**Step 0b: Migrate components to consume remote functions directly.**
Start with the simplest consumers:
- `Sidebar.svelte` — replace `stores.instancesByProject` with `$derived` over `await getInstances()` + `await getProjects()`
- `WorkspaceEmpty.svelte` — replace `stores.stats` with derived from query results
- `CommandPalette.svelte` — replace `stores.populatedInstances` with query
- `StatusBar.svelte` — replace `stores.stats` (or delete StatusBar per item 2)

Then the harder ones:
- `WorkspaceInstance.svelte` — replace `instances.getMessages(id)`, `instances.getStreamingState(id)`, etc.
- `InstanceHeader.svelte` — replace `instances.getStreamingState(id)`

**Step 0c: Rewire WebSocket handlers to update remote function caches.**
Instead of:
```ts
adapter.on('instance:created', (data) => instances.handleCreated(data));
```
Do:
```ts
adapter.on('instance:created', (data) => {
  // Push new instance into the cached query result
  getInstances().set([...getInstances().current, mapToInstanceData(data)]);
});
```
Or more simply: `getInstances().refresh()` to re-fetch from hub. For high-frequency events (streaming), use component-local `$state` instead.

**Step 0d: Split ephemeral state from entity state.**
The current `instances.svelte.ts` conflates:
- **Entity data** (id, status, cwd, model, cost) — belongs in remote queries
- **Streaming state** (isStreaming, contentBlocks, lastChunkAt) — ephemeral, belongs in component `$state`
- **Messages** (the chat history) — per-instance, belongs in `getInstanceMessages(id)` remote query
- **Subagent tree** (toolUseId, status, messages) — ephemeral, component `$state`
- **Activity events** (turn started, tool progress) — ephemeral, component `$state`

Only entity data goes through remote functions. Ephemeral state stays client-side-only, managed by the WebSocket event layer and passed down via props or Svelte context.

**Step 0e: Delete the old stores.**
Once all consumers are migrated:
- Delete `agents.svelte.ts`, `instances.svelte.ts`, `projects.svelte.ts`, `permissions.svelte.ts`, `questions.svelte.ts`
- Delete `initializeFromSSR()` and the `CrossStoreDerivations` class
- Delete `+layout.server.ts` (remote functions make it unnecessary)
- Simplify `index.svelte.ts` to just re-export WebSocket setup + `ui` store

**Why this order:** Step 0a is pure addition (no breaking changes). Step 0b can be done component-by-component. Step 0c can coexist with old stores during migration. Step 0d is the conceptual split. Step 0e is cleanup.

---

### High Impact (UI)

1. **Merge TopBar + TabBar into one row.** Eliminate 40px of chrome. Tabs sit inline next to the logo, actions on the right. This alone makes the app feel significantly more spacious.

2. **Eliminate StatusBar entirely.** Move connection dot into the header. Move cost into instance header. Drop version number. Move theme toggle into a user menu or command palette action.

3. **Enrich the instance header.** Add instance name/project on the left side. Keep tokens/cost/model/actions on the right. This replaces both the old bare header and the status bar info.

4. **Break up WorkspaceInstance (1717 lines).** Extract:
   - `MessageList.svelte` — pure message rendering + grouping logic
   - `ActivityIndicator.svelte` — the activity state machine (~200 lines of `deriveActivityState` + debounce)
   - `client-commands.ts` — handlers for `/help`, `/login`, `/model`, `/memory`, `/clear`, `/vim`
   - `instance-actions.ts` — `handleSend`, `handleInterrupt`, `handleEditMessage`, `loadMessages`

### Medium Impact (UI)

5. **Improve empty state.** When no tabs are open, show recent instances as clickable cards (not just "Welcome to Cockpit" text). Think: VS Code's welcome tab with recent projects.

6. **Consolidate permission UX.** Permissions should appear inline in the chat where the tool was called, not in a separate notification panel AND above the input.

7. **Better tab overflow.** When tabs exceed the header width, show a dropdown/scrollable tabs or a "more tabs" button.

### Lower Impact (UI)

8. **Animate view mode transitions** with a crossfade instead of x-axis slide.
9. **Add drag-to-reorder tabs.**
10. **New instance modal simplification** — start with just agent + prompt, expand to show directory/options on demand.
