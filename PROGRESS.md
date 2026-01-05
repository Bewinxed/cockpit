# Slash Commands & Authentication - PRD

## Overview

Make slash commands functional in the dashboard, matching CLI behavior. This includes fixing the command execution flow and implementing web-based OAuth authentication for `/login`.

## Latest Progress (2026-01-05)

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

## Stop Condition

**The job is complete when:**
1. User can type `/help` in chat input, press Ctrl+Enter, and see help output from the agent
2. User can select any command from the palette dropdown, press Ctrl+Enter, and it executes
3. `/login` opens OAuth flow, user pastes code, credentials are stored in DB
4. `/logout` clears stored credentials
5. API key can be entered as fallback authentication method
6. All lints pass (`bun run lint` or equivalent)

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

## Phase 5: Credential Flow to Agents

### 5.1 Pass Credentials on Instance Spawn

**Context:** When spawning a new instance, agent needs credentials to authenticate with Claude API. Currently agents check local `~/.claude/` files. Need to pass from DB instead.

**Files to review:**
- `/home/user/cockpit/packages/hub-server/src/api/instances.ts` - spawn endpoint
- `/home/user/cockpit/packages/agent-service/src/handlers/spawn.ts`
- `/home/user/cockpit/packages/core/src/protocol/instance.ts`

**What needs to be done:**
- [ ] Modify spawn request to include credentials from DB
- [ ] Update `INSTANCE_SPAWN` protocol to accept credentials parameter
- [ ] Agent uses provided credentials instead of local file
- [ ] Fallback to local file if no credentials in request

**Success condition:** Instance spawns using DB credentials, not local file.

---

## Phase 6: /logout Command

### 6.1 Implement Logout Handler

**Context:** `/logout` should clear stored credentials and update UI state.

**Files to review:**
- `/home/user/cockpit/apps/dashboard/src/routes/instances/[id]/+page.svelte`

**What needs to be done:**
- [ ] Create logout handler function
- [ ] Call `DELETE /api/auth/logout`
- [ ] Clear client-side auth state
- [ ] Show "Logged out" feedback
- [ ] Optionally stop running instances

**Success condition:** `/logout` clears credentials, UI reflects logged-out state.

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
