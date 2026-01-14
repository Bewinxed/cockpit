# fn-7.4 Update ConnectionStore to use RiverClient

## Description

Replace the native EventSource in `connection.svelte.ts` with river.ts RiverClient for type-safe SSE handling and automatic reconnection.

## Current Implementation

`apps/dashboard/src/lib/stores/connection.svelte.ts` uses:
- Native `EventSource` API
- Manual JSON parsing
- Custom exponential backoff reconnection
- Manual event listener registration

## Steps

### 1. Import river.ts and Event Types

```typescript
import { RiverClient } from 'river.ts';
import type { CockpitEventMap } from './sse-events';
import { agents } from './agents.svelte';
import { instances } from './instances.svelte';
import { permissions } from './permissions.svelte';
import { tasks } from './tasks.svelte';
import { projects } from './projects.svelte';
import { messageHandler } from './message-handler.svelte';
```

### 2. Update ConnectionStore Class

```typescript
class ConnectionStore {
  status = $state<'connecting' | 'connected' | 'disconnected' | 'error'>('disconnected');
  #client: RiverClient<CockpitEventMap> | null = null;

  connect(baseUrl: string = ''): void {
    this.status = 'connecting';

    this.#client = RiverClient.init<CockpitEventMap>({
      url: `${baseUrl}/api/events`,
      reconnect: true,
      maxRetries: 10,
      retryDelay: 1000,
      maxRetryDelay: 30000,
    })
      // Agent events
      .on('agent:connected', (data) => agents.handleEvent('agent:connected', data))
      .on('agent:disconnected', (data) => agents.handleEvent('agent:disconnected', data))
      .on('agent:reconnecting', (data) => agents.handleEvent('agent:reconnecting', data))

      // Instance events
      .on('instance:created', (data) => instances.handleEvent('instance:created', data))
      .on('instance:started', (data) => instances.handleEvent('instance:started', data))
      .on('instance:stopped', (data) => instances.handleEvent('instance:stopped', data))
      .on('instance:sleeping', (data) => instances.handleEvent('instance:sleeping', data))
      .on('instance:error', (data) => instances.handleEvent('instance:error', data))
      .on('instance:resumed', (data) => instances.handleEvent('instance:resumed', data))
      .on('instance:token_usage', (data) => instances.handleEvent('instance:token_usage', data))
      .on('instance:model-changed', (data) => instances.handleEvent('instance:model-changed', data))

      // Message events (most complex)
      .on('sdk:message', (data) => messageHandler.process(data))

      // Task events
      .on('task:created', (data) => tasks.handleEvent('task:created', data))
      .on('task:updated', (data) => tasks.handleEvent('task:updated', data))
      .on('task:completed', (data) => tasks.handleEvent('task:completed', data))

      // Permission events
      .on('permission:request', (data) => permissions.handleEvent('permission:request', data))

      // Project events
      .on('project:created', (data) => projects.handleEvent('project:created', data))
      .on('project:updated', (data) => projects.handleEvent('project:updated', data))
      .on('project:deleted', (data) => projects.handleEvent('project:deleted', data))

      // Lifecycle events
      .onOpen(() => {
        this.status = 'connected';
      })
      .onError((error) => {
        console.error('SSE error:', error);
        this.status = 'error';
      })
      .onClose(() => {
        this.status = 'disconnected';
      })
      .stream();
  }

  disconnect(): void {
    this.#client?.close();
    this.#client = null;
    this.status = 'disconnected';
  }

  reconnect(): void {
    this.disconnect();
    this.connect();
  }
}
```

### 3. Verify river.ts API

**IMPORTANT**: Check actual river.ts documentation for correct API. The above is a template based on common SSE library patterns. Adjust as needed.

### 4. Test Connection

```bash
bun run dev:dashboard
# Verify SSE connects and events flow through
```

## Acceptance

- [ ] ConnectionStore uses RiverClient instead of EventSource
- [ ] All 21 event types routed to correct handlers
- [ ] Auto-reconnection works
- [ ] Connection status updates correctly
- [ ] No runtime errors
- [ ] `bunx svelte-check` passes

## Done summary
## fn-7.4: Update ConnectionStore to use RiverClient

### Completed
Migrated ConnectionStore from native EventSource to river.ts RiverClient for type-safe SSE handling.

### Key Changes
1. **RiverEvents schema**: Defined all 21 event types using `RiverEvents.defineEvent()` with typed `data` payloads
2. **RiverClient integration**: Uses `RiverClient.init()` with the typed schema, `prepare()` for URL, and chained `.on()` handlers
3. **Event extraction**: River.ts passes `{ type, data }` objects, so handlers extract `.data` for store consumers
4. **Auto-reconnect**: Enabled via `reconnect: true` option + manual fallback with exponential backoff

### Files Modified
- `apps/dashboard/src/lib/stores/connection.svelte.ts` (full rewrite)

### Event Schema
```typescript
const cockpitEvents = new RiverEvents()
  .defineEvent('agent:connected', { data: {} as AgentConnectedEvent })
  // ... 20 more events
  .build();
```
## Evidence
- Commits:
- Tests:
- PRs: