# fn-6.5 Convert realtime.svelte.ts base stores to class-based $state()

## Description

Convert the base `writable()` stores in `realtime.svelte.ts` to a class-based pattern using `$state()`.

**File:** `apps/dashboard/src/lib/stores/realtime.svelte.ts`

**Stores to Convert (~20 writable stores):**
- Lines 195-212: `agents`, `instances`, `projects`, `tasks`, `pendingPermissions`
- Lines 2047-2106: `selectedInstanceId`, `splitViewState`, `instanceTabs`, etc.
- Line 1105: `connectionStatus`

## Target Architecture

Create a `RealtimeState` class:

```typescript
class RealtimeState {
  // Base state
  agents = $state<Map<string, Agent>>(new Map());
  instances = $state<Map<string, Instance>>(new Map());
  projects = $state<Map<string, Project>>(new Map());
  tasks = $state<Map<string, Task>>(new Map());
  pendingPermissions = $state<Map<string, PermissionRequest>>(new Map());

  // UI state
  selectedInstanceId = $state<string | null>(null);
  connectionStatus = $state<'connected' | 'disconnected' | 'reconnecting'>('disconnected');

  // Methods for updates (ensure reactivity with Map)
  setAgent(id: string, agent: Agent) {
    this.agents = new Map(this.agents).set(id, agent);
  }

  deleteAgent(id: string) {
    const newMap = new Map(this.agents);
    newMap.delete(id);
    this.agents = newMap;
  }

  // etc.
}

export const realtime = new RealtimeState();
```

## Key Considerations

1. **Map Mutation Reactivity:** Must use `new Map(map).set()` pattern - direct `map.set()` won't trigger reactivity
2. **Singleton Pattern:** Use `globalThis` for HMR persistence
3. **Export Compatibility:** Components currently use `$agents` syntax - will need updates in fn-6.7
4. **Split into logical groups:** Consider separate classes for different concerns (UI state vs data state)

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
