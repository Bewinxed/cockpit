# fn-6.5 Convert realtime.svelte.ts base stores to class-based $state()

## Description

**Divide & Conquer:** Break the 2252-line `realtime.svelte.ts` into entity-based store classes using `SvelteMap` from `svelte/reactivity`.

**Target Architecture:** Entity-based split with class methods for mutations.

## File Split Strategy

Create these new files under `apps/dashboard/src/lib/stores/`:

### 1. `agents.svelte.ts` - Agent state
```typescript
import { SvelteMap } from 'svelte/reactivity';

class AgentStore {
  #agents = $state(new SvelteMap<string, Agent>());

  get all() { return this.#agents; }
  online = $derived(Array.from(this.#agents.values()).filter(a => a.status === 'online'));

  set(id: string, agent: Agent) { this.#agents.set(id, agent); }
  updateStatus(id: string, status: Agent['status']) {
    const agent = this.#agents.get(id);
    if (agent) this.#agents.set(id, { ...agent, status });
  }
  delete(id: string) { this.#agents.delete(id); }
  clear() { this.#agents.clear(); }
}

export const agents = new AgentStore();
```

### 2. `instances.svelte.ts` - Instance + messages + streaming + subagents
```typescript
import { SvelteMap } from 'svelte/reactivity';

class InstanceStore {
  #instances = $state(new SvelteMap<string, Instance>());
  #messages = $state(new SvelteMap<string, Message[]>());
  #streaming = $state(new SvelteMap<string, StreamingMessage>());
  #subagents = $state(new SvelteMap<string, SubagentState>());

  get all() { return this.#instances; }
  running = $derived(Array.from(this.#instances.values()).filter(i => i.status === 'running'));

  // Instance methods
  set(id: string, instance: Instance) { this.#instances.set(id, instance); }
  updateStatus(id: string, status: Instance['status']) { /* ... */ }

  // Message methods
  addMessage(instanceId: string, message: Message) { /* ... */ }
  getMessages(instanceId: string) { return this.#messages.get(instanceId) || []; }
  clearMessages(instanceId: string) { this.#messages.delete(instanceId); }

  // Subagent methods
  startSubagent(toolUseId: string, instanceId: string, type: string) { /* ... */ }
  completeSubagent(toolUseId: string, result?: string) { /* ... */ }
}

export const instances = new InstanceStore();
```

### 3. `connection.svelte.ts` - SSE/river.ts client
```typescript
import { RiverClient } from 'river.ts';

class ConnectionStore {
  status = $state<'connecting' | 'connected' | 'disconnected' | 'error'>('disconnected');
  #client: RiverClient | null = null;

  connect(baseUrl: string) {
    // river.ts integration - see epic spec for event definitions
  }
  disconnect() {
    this.#client?.close();
    this.status = 'disconnected';
  }
}

export const connection = new ConnectionStore();
```

### 4. `ui.svelte.ts` - UI state (selection, sidebar, split view)
```typescript
class UIStore {
  selectedInstanceId = $state<string | null>(null);
  splitView = $state<SplitViewState>({ enabled: false });
  sidebarOpen = $state(false);
  sidebarCollapsed = $state(false);
  sidebarFilter = $state<SidebarFilterState>({ type: 'all' });
  // ...
}

export const ui = new UIStore();
```

### 5. `realtime.svelte.ts` - Unified facade (backwards compat)
```typescript
// Re-export for backwards compatibility during migration
export { agents } from './agents.svelte';
export { instances } from './instances.svelte';
export { connection } from './connection.svelte';
export { ui } from './ui.svelte';

// Keep complex derived stores here initially
export const populatedInstances = $derived.by(() => /* ... */);
```

## Key Considerations

1. **Use SvelteMap:** `import { SvelteMap } from 'svelte/reactivity'` - mutations are reactive without reassignment!
2. **Class Methods:** All mutations via methods (e.g., `instances.addMessage()`)
3. **Private State:** Use `#privateField` to enforce method access
4. **HMR Persistence:** Use `globalThis` pattern for dev mode
5. **Incremental Migration:** Keep facade for backwards compat, migrate consumers in fn-6.7

## Reference Patterns
- `apps/dashboard/src/lib/components/ui/sidebar/context.svelte.ts` - Class with `$state()`
- `apps/dashboard/src/lib/hooks/use-auto-scroll.svelte.ts` - Class with `$state()`
## Acceptance
- [ ] All `writable()` calls replaced with `$state()` in class properties
- [ ] `RealtimeState` class created with proper typing
- [ ] Map mutation methods use `new Map(map)` pattern for reactivity
- [ ] HMR persistence handled via `globalThis`
- [ ] No `writable` imports from `svelte/store`
- [ ] TypeScript compiles without errors
- [ ] File structure is readable and maintainable
## Done summary
TBD

## Evidence
- Commits:
- Tests:
- PRs:
