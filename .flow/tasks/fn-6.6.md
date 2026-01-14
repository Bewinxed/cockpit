# fn-6.6 Convert realtime.svelte.ts derived stores to $derived()

## Description

Convert `derived()` stores to class properties using `$derived()` within the entity-based store classes created in fn-6.5.

## Derived Store Placement

### In `agents.svelte.ts`:
```typescript
class AgentStore {
  #agents = $state(new SvelteMap<string, Agent>());

  // Simple derived - direct class property
  online = $derived(Array.from(this.#agents.values()).filter(a => a.status === 'online'));
  count = $derived(this.#agents.size);
}
```

### In `instances.svelte.ts`:
```typescript
class InstanceStore {
  #instances = $state(new SvelteMap<string, Instance>());

  running = $derived(Array.from(this.#instances.values()).filter(i =>
    i.status === 'running' || i.status === 'starting'
  ));

  recent = $derived(
    Array.from(this.#instances.values())
      .sort((a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime())
      .slice(0, 5)
  );

  adhoc = $derived(
    Array.from(this.#instances.values()).filter(i => !i.projectId)
  );
}
```

### In `realtime.svelte.ts` (facade) - Complex multi-store derivations:
```typescript
import { agents } from './agents.svelte';
import { instances } from './instances.svelte';
import { projects } from './projects.svelte';

// Cross-store derivations stay in facade
export const populatedInstances = $derived.by(() =>
  Array.from(instances.all.values()).map(instance => ({
    ...instance,
    agent: agents.all.get(instance.machineId)?.name || 'Unknown',
    project: instance.projectId ? projects.all.get(instance.projectId)?.name : null,
  }))
);

export const stats = $derived.by(() => ({
  totalAgents: agents.all.size,
  onlineAgents: agents.online.length,
  totalInstances: instances.all.size,
  runningInstances: instances.running.length,
  totalProjects: projects.all.size,
  totalCostUsd: Array.from(instances.all.values()).reduce((sum, i) => sum + (i.totalCostUsd || 0), 0),
}));
```

## Factory Functions Strategy

**Decision from interview:** "Do the right thing, update consumers according to Svelte 5 best practices."

### Option: Component-level $derived (PREFERRED)
```svelte
<!-- In ChatList.svelte -->
<script>
  import { instances } from '$lib/stores/instances.svelte';

  let { instanceId } = $props();

  // Create derived in component - auto-tracked, auto-disposed
  const messages = $derived(instances.getMessages(instanceId));
</script>

{#each messages as message}
```

### Why This Works:
- No memoization needed - Svelte 5 handles reactivity
- Factory becomes simple getter: `getMessages(id) { return this.#messages.get(id) || []; }`
- Component-level `$derived` tracks the getter result

## Key Considerations

1. **Prefer $derived over $derived.by:** Use `$derived.by()` only when multi-line logic needed
2. **Co-locate derivations:** Put derived in same class as source state when possible
3. **Cross-store derivations:** Keep in facade or create utility module
4. **Factory → Getter:** Convert factory functions to simple getters, use $derived in consumers
## Acceptance
- [ ] All `derived()` calls replaced with `$derived()` or `$derived.by()`
- [ ] No `derived` imports from `svelte/store`
- [ ] Factory functions either memoized or converted to component-level patterns
- [ ] Derived values correctly depend on `$state()` properties
- [ ] TypeScript compiles without errors
- [ ] Complex derivations use `$derived.by()` with proper return types
## Done summary
TBD

## Evidence
- Commits:
- Tests:
- PRs:
