# fn-7 SSE Migration to river.ts

## Overview

Migrate the dashboard SSE (Server-Sent Events) implementation from native EventSource with manual handlers to **river.ts** for type-safe, composable event handling.

**Current State:**
- Native `EventSource` in `realtime.svelte.ts` with manual reconnection
- Monolithic `sdk:message` handler (296 lines!) with deeply nested logic
- No compile-time type checking for event payloads
- SSE connection functions still in old store after fn-6 migration

**Target State:**
- Type-safe event definitions with full TypeScript typing
- Modular event handlers that route to entity stores
- Automatic reconnection via river.ts
- Clean separation between SSE layer and store mutations

## Scope

### In Scope
- Install and configure river.ts
- Create TypeScript definitions for all 21 SSE event types
- Add event handlers to entity stores
- Extract monolithic `sdk:message` handler into modular service
- Update ConnectionStore to use RiverClient
- Remove SSE code from realtime.svelte.ts
- Update +layout.svelte to use new connection

### Out of Scope
- Hub-side changes (uses existing BroadcastService)
- WebSocket protocol changes (agent communication)
- New event types
- Performance optimization

## SSE Event Types (21 Total)

### Agent Events
- `agent:connected` - `{ machineId, hostname, tailscaleIp, os, status, connectedAt }`
- `agent:disconnected` - `{ machineId }`
- `agent:reconnecting` - `{ machineId }`
- `agent:updated` - `{ machineId, ...agent }`

### Instance Lifecycle Events
- `instance:created` - `{ id, machineId, status: 'starting', cwd, projectId?, model? }`
- `instance:started` - `{ id, status: 'running' }`
- `instance:stopped` - `{ instanceId, instance, stats }`
- `instance:sleeping` - `{ instanceId, sdkSessionId? }`
- `instance:error` - `{ instanceId, error }`
- `instance:resumed` - `{ id, status: 'starting' }`

### Message Streaming Events
- `sdk:message` - Complex message object (most critical event)
- `instance:token_usage` - `{ instanceId, inputTokens, outputTokens, costDelta }`
- `instance:model-changed` - `{ instanceId, model }`

### Task & Permission Events
- `task:created|updated|completed` - Task object
- `permission:request` - `{ requestId, instanceId, toolName, toolInput, ... }`

### Project Events
- `project:created|updated|deleted` - Project object or `{ id }`

## Approach

### Phase 1: Install & Type Definitions
1. Install river.ts package
2. Create `sse-events.ts` with all 21 event type definitions
3. Build typed event schema for river.ts

### Phase 2: Entity Store Event Handlers
Add SSE event handlers to each entity store:
```typescript
// agents.svelte.ts
handleEvent(type: AgentEventType, data: AgentEventPayload): void {
  switch (type) {
    case 'agent:connected': this.set(data.machineId, data); break;
    case 'agent:disconnected': this.updateStatus(data.machineId, 'offline'); break;
  }
}
```

### Phase 3: Message Event Handler
Extract the 296-line `sdk:message` handler into a dedicated service:
- `message-handler.svelte.ts` - Message normalization and routing
- Handles streaming state, tool invocations, subagent routing

### Phase 4: Connection Store Integration
Update `connection.svelte.ts` to use RiverClient:
```typescript
import { RiverClient } from 'river.ts';
import { cockpitEvents } from './sse-events';

class ConnectionStore {
  #client: RiverClient<typeof cockpitEvents> | null = null;

  connect(baseUrl: string) {
    this.#client = RiverClient.init(cockpitEvents, { reconnect: true })
      .prepare(`${baseUrl}/api/events`)
      .on('agent:connected', (data) => agents.handleEvent('agent:connected', data))
      .on('sdk:message', (data) => messageHandler.process(data))
      .stream();
  }
}
```

### Phase 5: Cleanup Legacy
1. Remove old `connect()` from realtime.svelte.ts
2. Update `+layout.svelte` to use new connection store
3. Remove unused SSE code from old store

## Quick commands

```bash
# Install river.ts
bun add river.ts

# Type check
cd apps/dashboard && bunx svelte-check

# Start dashboard
bun run dev:dashboard

# Verify SSE connection
curl -N http://localhost:3000/api/events
```

## Acceptance

- [ ] river.ts installed and working
- [ ] All 21 event types have TypeScript definitions
- [ ] Entity stores have `handleEvent()` methods
- [ ] `sdk:message` handler extracted and modular
- [ ] ConnectionStore uses RiverClient
- [ ] No SSE code remains in realtime.svelte.ts
- [ ] Auto-reconnection works (test by stopping hub)
- [ ] `bunx svelte-check` passes with no errors
- [ ] Dashboard receives real-time updates

## References

- [river.ts GitHub](https://github.com/Bewinxed/river.ts)
- Hub broadcast service: `packages/hub-server/src/services/broadcast.ts`
- Current SSE connection: `apps/dashboard/src/lib/stores/realtime.svelte.ts:1195-1681`
- Entity stores: `apps/dashboard/src/lib/stores/*.svelte.ts`
