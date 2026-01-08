# Slash Commands & Authentication - PRD

## Overview

Make slash commands functional in the dashboard, matching CLI behavior. This includes fixing the command execution flow and implementing web-based OAuth authentication for `/login`.

## Latest Progress (2026-01-08)

**/CLEAR COMMAND FIX & PERFORMANCE IMPROVEMENTS:**

Fixed the `/clear` command and addressed performance issues:

1. **`/clear` now works properly:**
   - Added `/clear` to `CLIENT_COMMANDS` for client-side handling
   - Handler clears local messages with `clearInstanceMessages(instanceId)`
   - Sends `/clear` to SDK to clear server-side conversation
   - Shows "Conversation cleared" confirmation message

2. **Fixed redundant `commands.list` API calls:**
   - The `$effect` watching instance was triggering `fetchCommands()` on every instance change
   - Added `commandsFetched` state to ensure commands are only fetched once per running state
   - Resets when instance stops, so commands refresh if it restarts

3. **Fixed unreachable command handlers:**
   - `/memory`, `/vim`, and `/terminal-setup` had handlers but weren't in `CLIENT_COMMANDS`
   - These commands were being sent to server instead of handled locally
   - Now properly added to `CLIENT_COMMANDS` array

**Files Changed:**
- `apps/dashboard/src/routes/instances/[id]/+page.svelte`
  - Added `clearInstanceMessages` import
  - Expanded `CLIENT_COMMANDS` to include `/clear`, `/memory`, `/vim`, `/terminal-setup`
  - Added `/clear` handler in `handleClientCommand()`
  - Added `commandsFetched` state to prevent redundant API calls

---

## Previous Progress (2026-01-07)

**HELP MENU - 1:1 CLAUDE CLI MATCH:**

Implemented a fully-featured help menu matching Claude CLI's `/help` TUI:
- ✅ New `HelpMenu.svelte` component with tabbed interface
- ✅ Three tabs: `general | commands | custom-commands` (Tab key cycles)
- ✅ General tab: shortcuts (`!`, `/`, `@`, `&`), keyboard shortcuts, version info
- ✅ Commands tab: lists all built-in slash commands with descriptions
- ✅ Custom-commands tab: lists user-defined commands, skills, and MCP commands
- ✅ `help_menu` message type for rich rendering (not markdown)
- ✅ Escape key closes the help menu
- ✅ Version synced dynamically from agent via `claude.version` RPC
- ✅ Commands synced via existing `commands.list` RPC

**Version Sync Implementation:**
- Added `CLAUDE_VERSION` protocol method in `@cockpit/core`
- Agent handler runs `claude --version` (with caching)
- Hub API route: `GET /api/agents/:id/claude-version`
- Dashboard fetches version when showing `/help`

---

**PREVIOUS: COMMAND OUTPUT MESSAGE TYPE:**

Added new `command_output` message type for slash command output:
- ✅ New message type `command_output` in realtime store
- ✅ Dedicated rendering in `ChatMessage.svelte` with Terminal icon header
- ✅ Markdown rendering with `breaks: true` option for proper line breaks

**SDK SLASH COMMAND OUTPUT FIX:**

Several slash commands (`/help`, `/doctor`, `/status`) don't emit output through the SDK's `query()` API - they write directly to stdout in CLI mode.

**Fix:** Implemented client-side handling for commands where SDK doesn't emit output:
- ✅ `/help` - Rich TUI matching Claude CLI (tabbed help menu)
- ✅ `/model` - Inline model picker form with keyboard navigation
- ✅ `/login` - OAuth flow with inline form
- ✅ `/logout` - Clears credentials via API

**AGENT RECONNECTION & INSTANCE RECONCILIATION:**

Fixed issue where agents wouldn't re-register after hub restart, and stale instance statuses in DB:

1. **Agent reconnection fix:**
   - Agent now calls `register()` on every 'connected' event (not just initial connect)
   - This ensures hub always knows about agents after restarts

2. **Instance reconciliation on agent connect:**
   - Agent sends its running instances during registration (`daemon.ts`)
   - Hub compares agent's instances with DB records (`websocket.ts`)
   - Orphaned instances (in DB as "running" but not on agent) are marked as "sleeping"
   - Added `getActiveByMachineId()` to instance tracker for reconciliation
   - Tested: Setting instance to "running" in DB, then starting agent -> instance marked as "sleeping"

---

**PREVIOUS: MODEL SWITCHING (2026-01-05)**

The `/model` command works as an inline UI form:
- ✅ Protocol methods: `models.list` and `models.set` added to core package
- ✅ Agent handlers: `handleModelsList` and `handleModelsSet` wired to daemon
- ✅ Hub API endpoints: `GET /instances/:id/models` and `PATCH /instances/:id/models`
- ✅ Dashboard UI: Inline model picker form in chat messages (not a modal)
- ✅ Keyboard navigation: Arrow up/down to select, Enter to apply, Escape to cancel

---

**CRITICAL BUGS FOUND & FIXED:**

1. **Credentials format mismatch**
   - Claude CLI expects `expiresAt` as **number** (Unix timestamp in ms), not ISO string
   - CLI REQUIRES these fields: `scopes`, `subscriptionType`, `rateLimitTier`
   - Our code was converting to ISO string ❌
   - Fixed: `packages/auth/src/credentials.ts` and `packages/auth/src/oauth.ts` ✅

2. **Database schema timestamp mode issue**
   - Drizzle's `{ mode: 'timestamp' }` converts integers to Date objects
   - It expects seconds but we store milliseconds
   - Caused `.getTime()` to multiply by 1000 again (1767636152936000 instead of 1767636152936)
   - Fixed: Removed timestamp mode from `expiresAt` in schema.ts ✅
   - Fixed: Removed `.getTime()` calls in instances.ts ✅

**CREDENTIALS FLOW NOW WORKING:**
- Hub passes credentials to agent via env vars ✅
- Agent saves credentials to `~/.claude/.credentials.json` ✅
- CLI accepts credentials and spawns instances ✅

**ALL ISSUES FIXED:**

1. ✅ **CLI additional fields** - `scopes`, `subscriptionType`, `rateLimitTier`
   - Added default values in `spawn.ts` when hub doesn't provide them
   - Credentials file now includes all required fields
   - Tested and verified spawn works with full credentials

2. ℹ️ **OAuth tokens scope** (FYI, not a bug)
   - OAuth tokens are for Claude Code sessions only
   - `Bearer $TOKEN` to `/v1/messages` returns "OAuth authentication is currently not supported"
   - This is expected - the token is designed for Claude Code, not direct API calls

## Slash Commands Status

| Command | Description | Implementation | Status |
|---------|-------------|----------------|--------|
| `/help` | Get help with using Claude Code | **Client-side** (tabbed TUI, synced version/commands) | ✅ Works |
| `/clear` | Clear conversation history | **Client-side** (clears local + sends to SDK) | ✅ Works |
| `/compact` | Clear history and compact context | Pass to SDK | ⏳ Untested |
| `/config` | View or update configuration | Pass to SDK | ⏳ Untested |
| `/cost` | Show token usage and cost | Pass to SDK | ⏳ Untested |
| `/doctor` | Check Claude Code health | Pass to SDK (**no output**) | ⚠️ SDK limitation |
| `/init` | Initialize project with CLAUDE.md | Pass to SDK | ⏳ Untested |
| `/login` | Switch Claude accounts | **Client-side** (OAuth inline form) | ✅ Works |
| `/logout` | Sign out of your account | **Client-side** (clear creds via API) | ✅ Works |
| `/memory` | Edit CLAUDE.md memory file | **Client-side** (info message) | ✅ Web N/A |
| `/model` | Switch AI model | **Client-side** (inline picker, keyboard nav) | ✅ Works |
| `/permissions` | View or update permissions | Pass to SDK | ⏳ Untested |
| `/pr-comments` | View PR comments | Pass to SDK | ⏳ Untested |
| `/review` | Request code review | Pass to SDK | ⏳ Untested |
| `/status` | View system status | Pass to SDK (**no output**) | ⚠️ SDK limitation |
| `/terminal-setup` | Install shell integration | Pass to SDK | ⏳ Untested |
| `/vim` | Toggle vim mode | Pass to SDK | ⏳ Untested |

**Legend:**
- ✅ Works - Tested and working
- ✅ Web workaround - Client-side info box with workaround instructions
- ✅ Web N/A - Not applicable in web dashboard (shows info message)
- ⏳ Untested - Should work (passed to SDK) but needs verification
- ⚠️ SDK limitation - Command works but SDK doesn't emit output (writes to stdout only)
- 🔧 In Progress - Currently being implemented
- ❌ Broken - Known issues

**Note:** Some slash commands (`/help`, `/doctor`, `/status`) don't emit output through the SDK's `query()` API. They write directly to stdout in CLI mode. For these, we either implement client-side alternatives or accept that they won't show output in the dashboard.

## Infrastructure Status

| Feature | Description | Status |
|---------|-------------|--------|
| Agent reconnection | Agent re-registers on hub restart | ✅ Works |
| Instance reconciliation | Orphaned instances marked as sleeping | ✅ Works |
| Credentials flow | Hub passes creds to agent via env vars | ✅ Works |
| OAuth authentication | Web-based OAuth with PKCE | ✅ Works |
| API key fallback | Alternative to OAuth | ✅ Works |

---

## Stop Condition

**The job is complete when:**
1. ✅ User can type `/help` in chat input, press Ctrl+Enter, and see help output from the agent
2. ✅ User can select any command from the palette dropdown, press Ctrl+Enter, and it executes
3. ✅ `/login` opens OAuth flow, user pastes code, credentials are stored in DB
4. ✅ `/logout` clears stored credentials
5. ✅ API key can be entered as fallback authentication method (POST /api/auth/api-key)
6. ⏳ All lints pass (`bun run lint` or equivalent) - needs verification

---

## Phase 1: Fix Command Execution Flow

### 1.1 Fix Ctrl+Enter Keyboard Handling

**Context:** Currently, when a command is selected from the palette and user presses Ctrl+Enter, nothing happens. The keyboard event handling in `ChatInput.svelte` has a conflict where Enter (for palette selection) interferes with Ctrl+Enter (for submit).

**Files to review:**
- `/home/user/cockpit/apps/dashboard/src/lib/components/features/ChatInput.svelte` (lines 100-140)

**What needs to be done:**
- [ ] Modify keyboard handler to properly distinguish between:
  - Enter (select command in palette)
  - Ctrl+Enter (submit message/command)
- [ ] Ensure Ctrl+Enter works both when palette is open AND closed

**Success condition:** User types `/help`, presses Ctrl+Enter, message is submitted to agent.

---

### 1.2 Route Commands to Agent via INSTANCE_SEND

**Context:** Most slash commands (15 of 17) should be sent to the running instance as regular messages via the existing `INSTANCE_SEND` protocol. The Claude Code SDK inside the instance parses and executes them.

**Files to review:**
- `/home/user/cockpit/apps/dashboard/src/lib/actions.ts` - `sendMessage()` function
- `/home/user/cockpit/packages/hub-server/src/api/instances.ts` - send endpoint
- `/home/user/cockpit/packages/agent-service/src/handlers/command.ts`

**What needs to be done:**
- [ ] Verify `sendMessage()` properly sends slash commands via POST `/instances/:id/send`
- [ ] Verify agent forwards message to SDK instance
- [ ] Test that `/help`, `/clear`, `/model`, `/status` work end-to-end

**Success condition:** `/help` command returns help text displayed in chat. `/clear` clears conversation.

---

### 1.3 Client-Side Command Detection

**Context:** Two commands (`/login`, `/logout`) must NOT be sent to the agent - they require client-side handling. Need to intercept these before sending.

**Files to review:**
- `/home/user/cockpit/apps/dashboard/src/lib/components/features/ChatInput.svelte`
- `/home/user/cockpit/apps/dashboard/src/routes/instances/[id]/+page.svelte`

**What needs to be done:**
- [ ] Create command router that detects `/login` and `/logout`
- [ ] Route these to client-side handlers instead of `sendMessage()`
- [ ] All other `/commands` continue to agent

**Success condition:** Typing `/login` triggers client-side OAuth flow, NOT sent to agent.

---

## Phase 2: Database Credentials Storage

### 2.1 Add Credentials Table to Schema

**Context:** Currently OAuth tokens are stored locally in `~/.claude/.credentials.json`. For web dashboard, credentials must be stored in the database so they can be managed centrally and passed to agents.

**Files to review:**
- `/home/user/cockpit/packages/db/src/schema.ts`
- `/home/user/cockpit/packages/db/src/index.ts`

**SDK/URL references:**
- Drizzle ORM docs: https://orm.drizzle.team/docs/sql-schema-declaration

**What needs to be done:**
- [ ] Add `credentials` table with columns:
  - `id` (primary key)
  - `userId` (optional, for multi-user)
  - `type` (enum: 'oauth' | 'api_key')
  - `accessToken` (encrypted)
  - `refreshToken` (encrypted, nullable)
  - `expiresAt` (timestamp, nullable)
  - `apiKey` (encrypted, nullable)
  - `createdAt`, `updatedAt`
- [ ] Create migration
- [ ] Export credential CRUD functions

**Success condition:** `credentials` table exists, can insert/query/delete records.

---

### 2.2 Credentials API Endpoints

**Context:** Dashboard needs API endpoints to manage credentials stored in DB.

**Files to review:**
- `/home/user/cockpit/packages/hub-server/src/api/` - existing endpoint patterns
- `/home/user/cockpit/packages/hub-server/src/index.ts` - route registration

**What needs to be done:**
- [ ] `GET /api/auth/status` - check if authenticated (has valid credentials)
- [ ] `POST /api/auth/oauth/callback` - store OAuth tokens after code exchange
- [ ] `POST /api/auth/api-key` - store API key
- [ ] `DELETE /api/auth/logout` - delete credentials
- [ ] `GET /api/auth/credentials` - get credentials for agent spawning

**Success condition:** API endpoints return correct responses, credentials persisted to DB.

---

## Phase 3: Web OAuth Flow

### 3.1 OAuth Initiation

**Context:** Claude MAX subscription uses OAuth 2.0 with PKCE. The flow requires opening Anthropic's auth URL, user copies code from their UI, pastes it back.

**Files to review:**
- `/home/user/cockpit/packages/auth/src/oauth.ts` - existing OAuth implementation
- `/home/user/cockpit/packages/auth/src/login.ts` - CLI login flow

**SDK/URL references:**
- Auth URL: `https://claude.ai/oauth/authorize`
- Token URL: `https://console.anthropic.com/v1/oauth/token`
- Client ID: `9d1c250a-e61b-44d9-88ed-5944d1962f5e`
- Scopes: `org:create_api_key`, `user:profile`, `user:inference`

**What needs to be done:**
- [ ] Create `/api/auth/oauth/start` endpoint that:
  - Generates PKCE code verifier + challenge
  - Stores verifier in session/temp storage
  - Returns authorization URL for client to open
- [ ] Dashboard opens auth URL in new tab/popup
- [ ] User authorizes, sees code on Anthropic's page

**Success condition:** Clicking "Login with Claude MAX" opens auth URL, user sees authorization code.

---

### 3.2 Code Exchange UI

**Context:** After user authorizes, Anthropic shows them a code to copy. Dashboard needs UI to accept this code and exchange it for tokens.

**Files to review:**
- `/home/user/cockpit/apps/dashboard/src/routes/` - existing page patterns

**What needs to be done:**
- [ ] Create login modal/page with:
  - "Open Authorization" button
  - Text input for pasting authorization code
  - "Complete Login" button
- [ ] On submit, call `/api/auth/oauth/callback` with code
- [ ] Backend exchanges code for tokens via `exchangeCodeForTokens()`
- [ ] Store tokens in `credentials` table
- [ ] Show success/error feedback

**Success condition:** User pastes code, tokens are exchanged and stored, UI shows "Logged in".

---

### 3.3 Token Refresh Logic

**Context:** OAuth tokens expire. Need automatic refresh before expiration.

**Files to review:**
- `/home/user/cockpit/packages/auth/src/oauth.ts` - `refreshAccessToken()`

**What needs to be done:**
- [ ] Add `refreshCredentials()` function that checks expiration
- [ ] Call refresh 5 minutes before expiry
- [ ] Update stored tokens in DB after refresh
- [ ] Handle refresh failures (clear credentials, prompt re-login)

**Success condition:** Tokens auto-refresh, user doesn't need to re-login frequently.

---

## Phase 4: API Key Fallback

### 4.1 API Key Input UI

**Context:** Users without Claude MAX subscription can use an API key instead.

**Files to review:**
- `/home/user/cockpit/apps/dashboard/src/lib/components/` - UI component patterns

**What needs to be done:**
- [ ] Add "Use API Key" option in login modal
- [ ] Text input for API key (with show/hide toggle)
- [ ] Validate API key format before saving
- [ ] Store in `credentials` table with `type: 'api_key'`

**Success condition:** User can enter API key, it's stored, can be used for authentication.

---

## Phase 5: Credential Flow to Agents ✅ COMPLETE

### 5.1 Pass Credentials on Instance Spawn

**Status:** ✅ Implemented

**Implementation:**
- [x] `getOAuthCredentials()` in `instances.ts` fetches default credential from DB
- [x] Auto-refreshes expired tokens before passing to agent
- [x] Credentials passed via `envVars` in spawn request:
  - `COCKPIT_OAUTH_ACCESS_TOKEN`
  - `COCKPIT_OAUTH_REFRESH_TOKEN`
  - `COCKPIT_OAUTH_EXPIRES_AT`
- [x] Agent's `spawn.ts` writes credentials to `~/.claude/.credentials.json`
- [x] Fallback: if no credentials in request, agent uses local file

**Code flow:**
1. Hub fetches default credential from `credentials` table
2. If expired, auto-refreshes and updates DB
3. Passes tokens via `envVars` in `INSTANCE_SPAWN` request
4. Agent writes to `~/.claude/.credentials.json` before spawning
5. Claude SDK reads credentials and authenticates

---

## Phase 6: /logout Command ✅ COMPLETE

### 6.1 Implement Logout Handler

**Status:** ✅ Implemented

**Implementation:**
- [x] Created logout handler in `+page.svelte` under `handleClientCommand`
- [x] Calls `DELETE /api/auth/logout` via Eden Treaty
- [x] Shows "Logged out successfully" message in chat
- [x] Server deletes default credential from DB

**How it works:**
1. User types `/logout` in chat
2. `handleClientCommand` detects it as a client-side command
3. Calls `api.api.auth.logout.delete()`
4. Server removes default credential from `credentials` table
5. Success message displayed in chat

---

## Files Summary

### Must Read Before Implementation
1. `/home/user/cockpit/apps/dashboard/src/lib/components/features/ChatInput.svelte`
2. `/home/user/cockpit/apps/dashboard/src/lib/components/features/CommandPalette.svelte`
3. `/home/user/cockpit/apps/dashboard/src/routes/instances/[id]/+page.svelte`
4. `/home/user/cockpit/packages/auth/src/oauth.ts`
5. `/home/user/cockpit/packages/auth/src/credentials.ts`
6. `/home/user/cockpit/packages/db/src/schema.ts`
7. `/home/user/cockpit/packages/hub-server/src/api/instances.ts`
8. `/home/user/cockpit/packages/agent-service/src/handlers/spawn.ts`

### Will Modify
1. `ChatInput.svelte` - keyboard handling fix
2. `+page.svelte` (instance) - command routing
3. `schema.ts` - add credentials table
4. `hub-server/src/api/` - add auth endpoints
5. `spawn.ts` - accept credentials parameter
6. New: Login modal component
7. New: Auth API routes

### External References
- OAuth endpoints: `https://claude.ai/oauth/authorize`, `https://console.anthropic.com/v1/oauth/token`
- Client ID: `9d1c250a-e61b-44d9-88ed-5944d1962f5e`
- Drizzle ORM: https://orm.drizzle.team/docs/sql-schema-declaration

---

## Phase 7: Database & UI Modernization

### 7.1 Replace Raw SQL with Drizzle ORM ✅ COMPLETE

**Status:** ✅ Already Using Drizzle ORM

**Audit Result:** All database queries already use Drizzle ORM properly. Found only `sql` template tag usage for dynamic expressions which is the correct Drizzle pattern.

### 7.2 Replace UI Components with shadcn-svelte ✅ COMPLETE

**Status:** ✅ Complete

**Goal:** Migrate custom UI components to shadcn-svelte for consistency and maintainability.

**Reference:** https://www.shadcn-svelte.com/docs

**Completed:**
- [x] Install shadcn-svelte CLI and initialize (components.json)
- [x] Install dependencies (bits-ui, tailwind-variants, clsx, tailwind-merge)
- [x] Add Button component with variants (default, secondary, ghost, destructive, outline, link)
- [x] Add Card component with subcomponents (CardHeader, CardTitle, CardDescription, CardContent, CardFooter)
- [x] Add Badge component with variants (default, secondary, success, warning, error, info, destructive)
- [x] Add Input component
- [x] Add Dialog component (replaces Modal pattern)
- [x] Create LoadingButton wrapper for loading states
- [x] Update variants: primary→default, danger→destructive
- [x] Update all Button/Badge snippet patterns to inline children format
- [x] Created $lib/utils.ts with cn() function

**Files Added:**
- `apps/dashboard/components.json` - shadcn-svelte configuration
- `apps/dashboard/src/lib/utils.ts` - cn utility for class merging
- `apps/dashboard/src/lib/components/ui/LoadingButton.svelte` - Loading state wrapper
- `apps/dashboard/src/lib/components/ui/button/` - shadcn Button
- `apps/dashboard/src/lib/components/ui/card/` - shadcn Card
- `apps/dashboard/src/lib/components/ui/badge/` - shadcn Badge
- `apps/dashboard/src/lib/components/ui/input/` - shadcn Input
- `apps/dashboard/src/lib/components/ui/dialog/` - shadcn Dialog

**Note:** Old custom components (Button.svelte, Card.svelte, etc.) kept for reference but unused. Modal components use legitimate snippet patterns for their own APIs.
