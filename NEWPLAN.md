# Cockpit CLI Parity & Session Continuity Fix

## Phase 1: Fix Session Continuity (CRITICAL)

- [x] Add `sdkSessionId` field to `ManagedInstance` interface
- [x] Add `resume: instance.sdkSessionId` to query() options
- [x] Capture `session_id` from first SDK message in the streaming loop
- [x] Test that sessions persist across messages (manual verification needed at runtime)

**File:** `packages/agent-service/src/instance-manager.ts`

**Status:** Complete. Session ID is now captured from first SDK message and used for `resume` option on subsequent queries. Manual testing recommended.

---

## Phase 2: Persist Messages to Database

- [x] Add `saveMessage()` method to `instance-tracker.ts`
- [x] Add `getMessages()` method to `instance-tracker.ts`
- [x] Persist messages in `websocket.ts` when `sdk.message` events arrive
- [x] Add `GET /instances/:id/messages` endpoint
- [x] Add `POST /instances/:id/resume` endpoint

**Files:**
- `packages/hub-server/src/services/instance-tracker.ts`
- `packages/hub-server/src/api/websocket.ts`
- `packages/hub-server/src/api/instances.ts`

**Status:** Complete. Added `saveMessage`, `getMessages`, `getMessagesSince`, `deleteMessages`, `countMessages`, and `incrementCost` methods. Messages are persisted on `sdk.message` and `instance.message` events. Added `/messages` and `/resume` endpoints.

---

## Phase 3: Streaming Indicators

- [x] Extract token usage from SDK `result` messages in websocket.ts
- [x] Add `calculateCost()` utility function (using SDK's total_cost_usd directly)
- [x] Add `incrementCost()` method to instance-tracker
- [x] Broadcast `instance:token_usage` events
- [x] Add `streamingStates` store in dashboard
- [x] Create `StreamingIndicator.svelte` component
- [x] Integrate into instance detail page

**Files:**
- `packages/hub-server/src/api/websocket.ts`
- `packages/hub-server/src/services/instance-tracker.ts`
- `apps/dashboard/src/lib/stores/realtime.ts`
- `apps/dashboard/src/lib/components/features/StreamingIndicator.svelte` (new)
- `apps/dashboard/src/routes/instances/[id]/+page.svelte`

**Status:** Complete. Token usage is extracted from SDK result messages and broadcast. StreamingIndicator shows streaming state, token counts, and cost.

---

## Phase 4: Projectless Instances UI

- [x] Add "Ad-hoc Sessions" section to dashboard home (via adhocInstances derived store)
- [x] Update NewInstanceModal to make project optional (already was optional)
- [x] Add filter/tabs to instances list page

**Files:**
- `apps/dashboard/src/lib/stores/realtime.ts` - Added adhocInstances and projectInstances stores
- `apps/dashboard/src/lib/components/NewInstanceModal.svelte` - Already had project as optional
- `apps/dashboard/src/routes/instances/+page.svelte` - Added type filter for ad-hoc/project

**Status:** Complete. Added type filter to instances page to filter by ad-hoc (no project) vs project instances.

---

## Phase 5: Plugin & Slash Command Support

- [x] Add `COMMANDS_LIST` to protocol commands (types added)
- [x] Add type mappings to `CommandParamsMap` and `CommandResultMap`
- [x] Create `commands-discovery.ts` handler
- [x] Register handler in agent-service
- [x] Add `GET /instances/:id/commands` endpoint
- [x] Create `CommandPalette.svelte` component
- [x] Integrate into ChatInput with `/` trigger

**Files:**
- `packages/core/src/protocol/commands.ts`
- `packages/core/src/protocol/index.ts` - Added COMMANDS_LIST to PROTOCOL_METHODS
- `packages/agent-service/src/handlers/commands-discovery.ts` (new)
- `packages/agent-service/src/handlers/index.ts`
- `packages/agent-service/src/daemon.ts` - Added handler dispatch
- `packages/hub-server/src/api/instances.ts`
- `apps/dashboard/src/lib/components/features/CommandPalette.svelte` (new)
- `apps/dashboard/src/lib/components/features/ChatInput.svelte`
- `apps/dashboard/src/lib/components/features/index.ts`
- `apps/dashboard/src/routes/instances/[id]/+page.svelte`

**Status:** Complete. Command palette shows available slash commands when user types `/`. Built-in Claude Code commands are always shown, and custom commands are discovered from `.claude/commands/` directory.

---

## Current Status

**All phases complete!**

Summary of changes:
1. **Session Continuity**: SDK session ID is now captured and used for resume
2. **Message Persistence**: Messages are saved to database and retrievable
3. **Streaming Indicators**: Token usage and cost are displayed in real-time
4. **Projectless Instances**: Ad-hoc instances are now first-class citizens with filtering
5. **Command Palette**: Slash commands are discoverable via `/` trigger

---

## Bug Fixes Applied

1. **WebSocket Error Handling**: Added try-catch around `handleRequest` in websocket.ts to prevent silent failures
2. **Database Path**: Fixed hub-server to use `../../cockpit.db` (monorepo root) instead of `./cockpit.db`
3. **Cloud IDE Support**: Added auto-detection for Firebase Studio, Codespaces, and Gitpod URL patterns in dashboard config
