# Svelte 4 to Svelte 5 Complete Migration

## Overview

Complete the migration from Svelte 4 patterns to Svelte 5 runes across the dashboard application. The codebase is already ~95% migrated - this epic covers the remaining patterns.

**Current State:**
- All components use `$props()` instead of `export let`
- `$state()`, `$derived()`, `$effect()` are used throughout components
- Snippets with `{@render}` instead of slots
- No `createEventDispatcher` - uses callback props

**Remaining Svelte 4 patterns:**
1. `realtime.svelte.ts` - 20+ `writable()` and 15+ `derived()` stores (~2000 lines)
2. `theme.ts` - Single `writable()` store ✅ (already converted to `theme.svelte.ts`)
3. `StreamingIndicator.svelte` - unused `derived` import

## Important: Lifecycle Hooks Are NOT Deprecated

**`onMount` and `onDestroy` are valid Svelte 5 APIs.** They are NOT replaced by `$effect`.

| Pattern | Use Case |
|---------|----------|
| `onMount` | Client-only one-time initialization (DOM APIs, external libs, EventSource) |
| `onDestroy` | Cleanup (only lifecycle hook that runs on server) |
| `$effect` | **Reactive** side effects that re-run when dependencies change |

**Anti-patterns to avoid:**
- Using `$effect` as a replacement for `onMount` when code doesn't need to re-run reactively
- Using `$effect` to sync state instead of `$derived` (the docs call `$effect` an "escape hatch")
- Empty-dependency `$effect(() => { ... })` when `onMount` would express intent more clearly

## Scope

### In Scope
- Convert `realtime.svelte.ts` stores to Svelte 5 class-based reactive state
- Remove unused store imports
- Verify existing lifecycle hook usage is appropriate (not wholesale replacement)
- Document decision criteria for `onMount` vs `$effect` in codebase

### Out of Scope
- Full test coverage for entire dashboard
- Refactoring store architecture beyond Svelte 5 migration
- Performance optimization (separate effort)
- Converting valid `onMount`/`onDestroy` to `$effect` (they're not deprecated!)

## Approach

### Phase 1: Quick Wins ✅
1. ✅ Remove unused `derived` import from `StreamingIndicator.svelte:3`
2. ✅ Convert `theme.ts` to class-based `$state()` (now `theme.svelte.ts`)

### Phase 2: Store Migration (realtime.svelte.ts) - Divide & Conquer

**Migration Strategy** (from interview):
- Analyze the ~2252-line file and break into entity-based classes
- Use `SvelteMap` from `svelte/reactivity` for reactive Map mutations
- Target ideal state, not current implementation
- Class methods for mutations (e.g., `realtime.addMessage()`)
- LSP rename for consumer migration (ensure correct tsconfig for monorepo)

**Entity-Based Store Split:**
```typescript
// agents.svelte.ts
class AgentStore {
  #agents = $state<SvelteMap<string, Agent>>(new SvelteMap());

  get all() { return this.#agents; }
  online = $derived(Array.from(this.#agents.values()).filter(a => a.status === 'online'));

  set(id: string, agent: Agent) { this.#agents.set(id, agent); }
  delete(id: string) { this.#agents.delete(id); }
}
export const agents = new AgentStore();

// instances.svelte.ts
class InstanceStore {
  #instances = $state<SvelteMap<string, Instance>>(new SvelteMap());
  #messages = $state<SvelteMap<string, Message[]>>(new SvelteMap());
  #streaming = $state<SvelteMap<string, StreamingMessage>>(new SvelteMap());
  #subagents = $state<SvelteMap<string, SubagentState>>(new SvelteMap());

  running = $derived(Array.from(this.#instances.values()).filter(i => i.status === 'running'));

  addMessage(instanceId: string, message: Message) { /* ... */ }
  updateToolResult(instanceId: string, toolId: string, result: unknown) { /* ... */ }
}
export const instances = new InstanceStore();

// connection.svelte.ts - SSE/river.ts client
class ConnectionStore {
  status = $state<'connecting' | 'connected' | 'disconnected' | 'error'>('disconnected');
  #client: RiverClient<CockpitEvents> | null = null;

  connect(baseUrl: string) { /* river.ts RiverClient */ }
  disconnect() { /* cleanup */ }
}
export const connection = new ConnectionStore();

// ui.svelte.ts - UI state
class UIStore {
  selectedInstanceId = $state<string | null>(null);
  splitView = $state<SplitViewState>({ enabled: false });
  sidebarOpen = $state(false);
  // ...
}
export const ui = new UIStore();
```

**SSE Refactor with river.ts:**
```typescript
import { RiverClient, type RiverEvents } from 'river.ts';

// Define typed events matching hub's SSE event types
const cockpitEvents = new RiverEvents()
  .defineEvent('agent:connected', { machineId: '', hostname: '', os: '', status: '' })
  .defineEvent('agent:disconnected', { machineId: '' })
  .defineEvent('instance:created', { id: '', machineId: '', status: '' })
  .defineEvent('sdk:message', { instanceId: '', message: {} })
  // ... all other SSE events
  .build();

// In connection.svelte.ts
this.#client = RiverClient.init(cockpitEvents, { reconnect: true })
  .prepare('/api/events')
  .on('agent:connected', (data) => agents.set(data.machineId, data))
  .on('sdk:message', (data) => instances.handleMessage(data.instanceId, data.message))
  .stream();
```

**Unified Facade (optional):**
```typescript
// realtime.svelte.ts - thin facade for backwards compat during migration
export { agents } from './stores/agents.svelte';
export { instances, messages } from './stores/instances.svelte';
export { connection } from './stores/connection.svelte';
export { ui } from './stores/ui.svelte';
```

**Key Patterns:**
```typescript
// Use SvelteMap from svelte/reactivity (NOT new Map().set() pattern)
import { SvelteMap } from 'svelte/reactivity';

class Store {
  items = $state(new SvelteMap<string, Item>());

  set(id: string, item: Item) {
    this.items.set(id, item); // SvelteMap mutations are reactive!
  }
}
```

### Phase 3: Testing & Verification

**Update ASSUMPTIONS.md** with Svelte 5 patterns that must pass:
```markdown
## Svelte 5 Store Patterns

### SV1: SvelteMap Reactivity
- **Assumption**: SvelteMap mutations trigger reactive updates
- **Expected**: UI updates when `map.set()` called without reassignment
- **Verify**: Add agent → Agent appears in sidebar without page refresh

### SV2: Class-based Store Methods
- **Assumption**: Calling store methods updates UI reactively
- **Expected**: `instances.addMessage()` → Chat updates immediately
- **Verify**: Send message → See streaming response

### SV3: Derived Store Efficiency
- **Assumption**: $derived only recalculates when dependencies change
- **Expected**: Derived stores don't recalculate on unrelated state changes
- **Verify**: Change agent status → Only agent-related deriveds update

### SV4: river.ts SSE Connection
- **Assumption**: river.ts RiverClient handles SSE with type safety
- **Expected**: All events typed, auto-reconnect works
- **Verify**: Disconnect network → Reconnects within 30s
```

**Playwright MCP Verification:**
After each major change, use Playwright MCP agent to verify:
1. Navigate to dashboard
2. Confirm agents load and display
3. Spawn an instance
4. Send a message and verify streaming
5. Check SSE reconnection

### Phase 4: Lifecycle Pattern Documentation
Document when to use each pattern:
- `onMount`: EventSource setup, external library init, DOM measurements
- `onDestroy`: Server-safe cleanup, subscription teardown
- `$effect`: Canvas drawing, reactive subscriptions, analytics that track state changes

## Quick Commands

```bash
# Smoke test - verify dashboard starts
bun run dev:dashboard

# Type check
cd apps/dashboard && bunx svelte-check

# Verify no Svelte 4 store patterns remain
grep -r "writable\|derived" apps/dashboard/src/lib/stores --include="*.svelte.ts"

# Check for createEventDispatcher (should find none)
grep -r "createEventDispatcher" apps/dashboard/src
```

## Acceptance Criteria

- [ ] No `writable()` or `derived()` imports from `svelte/store` in `.svelte.ts` files
- [ ] No unused imports in any component
- [ ] `bun run dev:dashboard` starts without errors
- [ ] `bunx svelte-check` passes with no errors
- [ ] SSE real-time updates still work correctly
- [ ] Store reactivity verified (UI updates when state changes)
- [ ] No Svelte 4 deprecation warnings in console
- [ ] Lifecycle hook usage follows documented decision criteria

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Map mutation not triggering reactivity | Use `new Map(map).set()` pattern, test explicitly |
| Mixed Svelte 4/5 patterns during migration | Migrate in isolated commits, test each phase |
| Over-reliance on $effect | Follow decision criteria: prefer $derived, use $effect as escape hatch |
| SSR hydration issues | Keep `onMount` for SSR-sensitive code (it's correct!) |

## References

### Files to Modify
- `apps/dashboard/src/lib/stores/realtime.svelte.ts` (lines 1, 195-227, 375-410, 671-698, 1078-1194, 2047-2194)

### Files Already Migrated ✅
- `apps/dashboard/src/lib/stores/theme.svelte.ts` - class-based `$state()`
- `apps/dashboard/src/lib/components/features/StreamingIndicator.svelte` - unused import removed

### Files Correctly Using onMount/onDestroy (DO NOT CHANGE)
- `apps/dashboard/src/routes/+layout.svelte` - EventSource connection (client-only, one-time)
- `apps/dashboard/src/lib/components/workspace/WorkspaceInstance.svelte` - event listeners
- `apps/dashboard/src/lib/components/features/DiffView.svelte` - @pierre/diffs library
- `apps/dashboard/src/lib/components/features/DiffModal.svelte` - @pierre/diffs + keyboard
- `apps/dashboard/src/lib/components/ui/terminal/terminal.svelte` - one-time animation start
- `apps/dashboard/src/lib/components/ui/terminal/terminal-loading.svelte` - non-reactive cleanup

### Documentation
- [Svelte 5 Lifecycle Hooks](https://svelte.dev/docs/svelte/lifecycle-hooks) - onMount/onDestroy are NOT deprecated
- [$effect Documentation](https://svelte.dev/docs/svelte/$effect) - "best considered an escape hatch"
- [$derived Documentation](https://svelte.dev/docs/svelte/$derived) - "90% of the time you want $derived"

### Existing Patterns to Follow
- `apps/dashboard/src/lib/components/ui/sidebar/context.svelte.ts` - Class with `$state()`, `$derived.by()`
- `apps/dashboard/src/lib/hooks/use-auto-scroll.svelte.ts` - Class with `$state()`
