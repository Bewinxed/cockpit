# Relational Message Architecture Refactor

## Overview

Refactor the message/subagent storage architecture from JSON blob reconstruction to proper relational database models. Currently, messages are stored as raw JSON in a single `content` column, requiring expensive parsing and tree reconstruction on every load. This plan normalizes the schema, adds proper foreign keys, and eliminates runtime reconstruction.

**Scope**: Schema migration + hub-server write path + dashboard read path + DRY fixes

## Problem Statement

### Current Architecture Issues
1. **JSON blob storage**: `messages.content` stores entire SDK messages as JSON
2. **Runtime reconstruction**: `reconstructSubagentsFromHistory()` scans all messages to rebuild subagent tree
3. **No relational integrity**: `parentToolUseId` derived at parse time, not stored
4. **Tool result matching**: O(n) scan through JSON content blocks to match `tool_use` → `tool_result`
5. **DRY violations**: `getToolGlance()` and `getResultGlimpse()` duplicated across components

### Current Message Flow
```
Agent → WebSocket → Hub.handleNotification() → instanceTracker.saveMessage()
                                                       ↓
                                            SQLite (raw JSON blob)
                                                       ↓
Dashboard ← parseDbMessages() ← reconstructSubagentsFromHistory() ← API
```

### SDK Message Structure (Verified from Live Data)

**Root-level message (assistant with Task tools):**
```json
{
  "type": "assistant",
  "message": {
    "model": "claude-opus-4-5-20251101",
    "role": "assistant",
    "content": [
      { "type": "text", "text": "..." },
      {
        "type": "tool_use",
        "id": "toolu_015D36eARg...",
        "name": "Task",
        "input": {
          "subagent_type": "Explore",
          "description": "Test agent gamma search",
          "prompt": "..."
        }
      }
    ],
    "usage": { "input_tokens": 3, "output_tokens": 2, ... }
  },
  "parent_tool_use_id": null,  // Root message
  "session_id": "...",
  "uuid": "..."
}
```

**Subagent message (child of Task tool):**
```json
{
  "type": "user",
  "message": {
    "role": "user",
    "content": [
      {
        "type": "tool_result",
        "tool_use_id": "toolu_01KoMyu4Dx...",
        "content": "..."
      }
    ]
  },
  "parent_tool_use_id": "toolu_015D36eARg...",  // Links to parent Task!
  "session_id": "...",
  "uuid": "...",
  "tool_use_result": {  // SDK adds structured metadata!
    "filenames": [...],
    "durationMs": 1923,
    "numFiles": 100,
    "truncated": true
  }
}
```

**Key Fields to Extract:**
| JSON Path | Column Name | Notes |
|-----------|-------------|-------|
| `.type` | `sdk_type` | 'user', 'assistant', 'system', 'result' |
| `.parent_tool_use_id` | `parent_tool_use_id` | Null for root, set for subagent messages |
| `.session_id` | `session_id` | Groups messages in a conversation |
| `.uuid` | `sdk_uuid` | Already stored, but as column |
| `.message.role` | `role` | 'user' or 'assistant' |
| `.message.model` | `model` | e.g. 'claude-opus-4-5-20251101' |
| `.message.usage.input_tokens` | `input_tokens` | Token tracking |
| `.message.usage.output_tokens` | `output_tokens` | Token tracking |
| `.message.content[].text` | `text_content` | Extracted for display/search |
| `.tool_use_result.durationMs` | (tool_invocations) | Tool execution time |

## Target Architecture

### New Schema Design

```sql
-- messages table (enhanced)
messages (
  id TEXT PRIMARY KEY,
  instance_id TEXT NOT NULL REFERENCES instances(id),
  sdk_uuid TEXT UNIQUE,
  sdk_type TEXT NOT NULL,        -- 'user' | 'assistant' | 'system' | 'result'
  sdk_subtype TEXT,              -- 'init' | 'compact_boundary' | etc.
  parent_tool_use_id TEXT,       -- Links to subagent parent (indexed)
  role TEXT,                     -- 'user' | 'assistant' (for quick filtering)
  text_content TEXT,             -- Extracted text for display/search
  raw_content JSON,              -- Full SDK message (for replay/compatibility)
  model TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cost_usd REAL,
  timestamp INTEGER NOT NULL,
  created_at INTEGER NOT NULL
)

-- tool_invocations table (new)
tool_invocations (
  id TEXT PRIMARY KEY,           -- SDK's tool_use_id (e.g. toolu_015D36eARg...)
  message_id TEXT NOT NULL REFERENCES messages(id),
  instance_id TEXT NOT NULL REFERENCES instances(id),
  tool_name TEXT NOT NULL,       -- 'Task', 'Glob', 'Read', etc.
  tool_input JSON,               -- The input object passed to tool
  tool_result JSON,              -- SDK's tool_use_result metadata
  tool_result_content TEXT,      -- Raw result content (can be large)
  is_error INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'success' | 'error'
  duration_ms INTEGER,           -- From tool_use_result.durationMs
  -- For Task tools (subagents)
  subagent_type TEXT,            -- 'Explore', 'flow:repo-scout', etc.
  subagent_description TEXT,     -- Short description from input.description
  created_at INTEGER NOT NULL,
  completed_at INTEGER
)
```

### New Message Flow
```
Agent → WebSocket → Hub.handleNotification() → extractMessageFields()
                                                       ↓
                                            saveMessage() + saveToolInvocations()
                                                       ↓
                                            SQLite (normalized columns + JSON backup)
                                                       ↓
Dashboard ← Drizzle relations query ← No reconstruction needed
```

## Phases

### Phase 1: DRY Fixes & Quick Wins
**Goal**: Fix code review issues without schema changes

#### Tasks
1. **Create shared tool display utilities**
   - Create `/apps/dashboard/src/lib/utils/tool-display.ts`
   - Extract `getToolGlance()` from ToolGroup.svelte
   - Extract `getResultGlimpse()` (consolidate with `getResultGlance`)
   - Export `extractResultText()` from realtime.svelte.ts

2. **Update components to use shared utilities**
   - `ToolGroup.svelte`: Import from tool-display.ts
   - `SubagentBranch.svelte`: Import from tool-display.ts

3. **Fix Svelte 5 deprecation warnings**
   - `SubagentBranch.svelte:290`: Replace `<svelte:self>` with self-import pattern

4. **Remove unused code**
   - `WorkspaceInstance.svelte`: Remove unused `sentMessage` variable

**Acceptance**:
- [ ] `bunx svelte-check` shows 0 errors, reduced warnings
- [ ] No duplicate `getToolGlance` implementations

---

### Phase 2: Schema Migration (Non-Breaking)
**Goal**: Add new columns without breaking existing functionality

#### Tasks
1. **Add columns to messages table**
   ```typescript
   // packages/db/src/schema.ts additions
   sdkUuid: text('sdk_uuid'),
   sdkType: text('sdk_type'),
   sdkSubtype: text('sdk_subtype'),
   parentToolUseId: text('parent_tool_use_id'),
   role: text('role'),
   textContent: text('text_content'),
   model: text('model'),
   inputTokens: integer('input_tokens'),
   outputTokens: integer('output_tokens'),
   costUsd: real('cost_usd'),
   ```

2. **Create tool_invocations table**
   ```typescript
   export const toolInvocations = sqliteTable('tool_invocations', {
     id: text('id').primaryKey(),
     messageId: text('message_id').references(() => messages.id).notNull(),
     instanceId: text('instance_id').references(() => instances.id).notNull(),
     toolName: text('tool_name').notNull(),
     toolInput: text('tool_input', { mode: 'json' }),
     toolResult: text('tool_result', { mode: 'json' }),
     isError: integer('is_error', { mode: 'boolean' }).default(false),
     status: text('status').notNull().default('pending'),
     subagentType: text('subagent_type'),
     subagentDescription: text('subagent_description'),
     createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
     completedAt: integer('completed_at', { mode: 'timestamp' }),
   });
   ```

3. **Add indexes**
   ```typescript
   index('messages_sdk_uuid_idx').on(table.sdkUuid),
   index('messages_sdk_type_idx').on(table.sdkType),
   index('messages_parent_tool_use_idx').on(table.parentToolUseId),
   index('tool_invocations_status_idx').on(table.status),
   index('tool_invocations_instance_idx').on(table.instanceId),
   ```

4. **Define Drizzle relations**
   ```typescript
   export const messagesRelations = relations(messages, ({ one, many }) => ({
     instance: one(instances, {
       fields: [messages.instanceId],
       references: [instances.id],
     }),
     toolInvocations: many(toolInvocations),
   }));
   ```

5. **Generate and apply migration**
   ```bash
   bun run --filter @cockpit/db db:generate
   bun run --filter @cockpit/db db:migrate
   ```

**Acceptance**:
- [ ] Migration applies successfully
- [ ] Existing functionality still works (columns nullable, JSON fallback)
- [ ] New tables/columns visible in DB

---

### Phase 3: Write Path Update (Hub Server)
**Goal**: Populate new columns when messages arrive

#### Tasks
1. **Create message field extractor**
   - Location: `/packages/hub-server/src/services/message-extractor.ts`
   - Extract `sdkType`, `sdkSubtype`, `parentToolUseId`, `role`, `textContent` from SDK message
   - Handle all SDK message types: user, assistant, system, result, stream_event

2. **Create tool invocation extractor**
   - Same file or separate
   - Find `tool_use` blocks in assistant messages
   - Extract `toolName`, `toolInput`, `subagentType` (for Task tools)

3. **Update instanceTracker.saveMessage()**
   - Call extractors before insert
   - Insert to both `messages` and `tool_invocations` tables
   - Handle `tool_result` blocks: UPDATE matching `tool_invocations` row

4. **Update WebSocket handler**
   - `/packages/hub-server/src/api/websocket.ts`
   - Pass full message context to saveMessage

**Edge Cases**:
- `tool_result` arrives before `tool_use`: Queue or create pending record
- Duplicate `sdkUuid`: Upsert instead of insert
- `parentToolUseId` for nested subagents: Store as-is (SDK provides correct hierarchy)

**Acceptance**:
- [ ] New messages populate all normalized columns
- [ ] `tool_invocations` records created for tool_use blocks
- [ ] `tool_invocations.status` updates when tool_result arrives

---

### Phase 4: Read Path Update (Dashboard)
**Goal**: Load from normalized columns, eliminate reconstruction

#### Tasks
1. **Update message loading API**
   - Return normalized fields from DB instead of just `content`
   - Include related `toolInvocations` via Drizzle `with`
   - Filter by `parentToolUseId IS NULL` for main chat messages

2. **Simplify parseDbMessages()**
   - Use normalized columns directly
   - Fall back to JSON parsing only for legacy messages (migration period)
   - Remove two-pass tool_result matching (now a DB join)

3. **Simplify reconstructSubagentsFromHistory()**
   - Query by `parentToolUseId` instead of scanning
   - Or: Remove entirely if subagent state can be derived from normalized data

4. **Update Message type**
   - Add normalized fields to interface
   - Deprecate metadata.subagentType in favor of column

5. **Update SubagentBranch to use DB data**
   - Load tool invocations from DB
   - Remove in-memory status tracking

**Acceptance**:
- [ ] Page load doesn't require `reconstructSubagentsFromHistory()`
- [ ] Subagent tree displays correctly from DB data
- [ ] Tool status (pending/success/error) shows correctly

---

### Phase 5: Backfill Migration
**Goal**: Populate normalized columns for existing messages

#### Tasks
1. **Create backfill script**
   - Location: `/packages/db/scripts/backfill-normalized-columns.ts`
   - Read all messages with `sdkType IS NULL`
   - Parse `content` JSON, extract normalized values
   - Update in batches (1000 rows per transaction)

2. **Extract tool invocations from existing data**
   - Scan `content` for `tool_use` blocks
   - Create `tool_invocations` records
   - Match `tool_result` blocks to update status

3. **Verification queries**
   ```sql
   -- Should return 0 after backfill
   SELECT COUNT(*) FROM messages WHERE sdk_type IS NULL AND content IS NOT NULL;

   -- Tool invocations should match tool_use count in messages
   SELECT COUNT(*) FROM tool_invocations;
   ```

4. **Add backfill to migration pipeline**
   - Run after schema migration
   - Idempotent (can re-run safely)

**Acceptance**:
- [ ] All existing messages have normalized columns populated
- [ ] Tool invocations table populated for historical data
- [ ] Verification queries pass

---

### Phase 6: Cleanup & Optimization
**Goal**: Remove legacy code paths, optimize queries

#### Tasks
1. **Remove JSON fallback code**
   - Delete `reconstructSubagentsFromHistory()`
   - Simplify `parseDbMessages()` to only use columns
   - Remove JSON scanning from tool result matching

2. **Add database constraints**
   - Consider making `sdkType` NOT NULL (after backfill verified)
   - Add CHECK constraints for status enum values

3. **Performance testing**
   - Measure message load time before/after
   - Test with large conversation (1000+ messages)
   - Verify index usage with EXPLAIN QUERY PLAN

4. **Update types**
   - Make normalized fields required in TypeScript types
   - Remove deprecated metadata fields

**Acceptance**:
- [ ] No runtime JSON parsing for message display
- [ ] Query performance improved (< 100ms for 1000 messages)
- [ ] All tests pass

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Migration corrupts data | Low | Critical | Test on copy of prod DB first, backup before migration |
| In-flight sessions break during deploy | Medium | High | Deploy during low-traffic window, or implement versioned message format |
| Backfill takes too long | Medium | Medium | Run in background, batch processing, add progress logging |
| Foreign key violations | Low | Medium | Use soft references initially, add constraints after verification |
| Dashboard/Hub version mismatch | Medium | High | Deploy hub first, dashboard second; hub writes both formats during transition |

## Rollback Strategy

1. **Schema changes are additive** - new columns don't break old code
2. **Keep `content` JSON column** - can always fall back to JSON parsing
3. **Feature flag for new read path** - environment variable to toggle
4. **Backfill is non-destructive** - only populates NULL columns

## Testing Requirements

### Unit Tests
- [ ] `extractMessageFields()` handles all SDK message types
- [ ] `extractToolInvocations()` finds all tool_use blocks
- [ ] Tool result matching updates correct record

### Integration Tests
- [ ] Message round-trip: save → load → display matches original
- [ ] Subagent tree: Task tool creates proper hierarchy
- [ ] Tool status: pending → success/error transitions

### Manual Tests
- [ ] Create new conversation, verify DB populated correctly
- [ ] Page refresh, verify subagent tree persists
- [ ] Run `/clear`, verify messages and tool_invocations deleted
- [ ] Parallel subagents display correctly

## References

### Files to Modify

| File | Changes |
|------|---------|
| `/packages/db/src/schema.ts` | Add columns, new table, relations |
| `/packages/hub-server/src/services/instance-tracker.ts` | Update saveMessage(), add saveToolInvocation() |
| `/packages/hub-server/src/api/websocket.ts` | Pass context to saveMessage() |
| `/apps/dashboard/src/lib/stores/realtime.svelte.ts` | Simplify/remove reconstruction |
| `/apps/dashboard/src/lib/components/workspace/WorkspaceInstance.svelte` | Simplify parseDbMessages() |
| `/apps/dashboard/src/lib/components/features/ToolGroup.svelte` | Use shared utils |
| `/apps/dashboard/src/lib/components/features/subagent/SubagentBranch.svelte` | Use shared utils, fix svelte:self |

### New Files

| File | Purpose |
|------|---------|
| `/apps/dashboard/src/lib/utils/tool-display.ts` | Shared getToolGlance, getResultGlimpse |
| `/packages/hub-server/src/services/message-extractor.ts` | Extract normalized fields from SDK messages |
| `/packages/db/scripts/backfill-normalized-columns.ts` | Backfill migration script |
| `/packages/db/drizzle/XXXX_relational_messages.sql` | Generated migration |

### External Documentation
- [Drizzle ORM Relations](https://orm.drizzle.team/docs/relations)
- [Drizzle SQLite JSON](https://orm.drizzle.team/docs/column-types/sqlite#json)
- [Claude Agent SDK Types](https://github.com/anthropics/claude-agent-sdk-typescript)
- [Svelte 5 Runes](https://svelte.dev/docs/svelte/$state)

## Open Questions

1. **Retention policy**: Should we add message pruning? Affects backfill volume.
2. **Streaming messages**: Persist `stream_event` messages or keep ephemeral?
3. **Synthetic messages**: Persist local commands (`isSynthetic: true`)?
4. **Large tool results**: Store inline or reference external storage?

---

## Definition of Done

- [ ] All 6 phases completed
- [ ] Zero Svelte check errors/warnings for new code
- [ ] Database queries use indexes (verified with EXPLAIN)
- [ ] Page refresh shows subagent tree without reconstruction
- [ ] No duplicate code for getToolGlance/getResultGlimpse
- [ ] Backfill completed for existing data
- [ ] Tests pass
