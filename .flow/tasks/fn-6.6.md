# fn-6.6 Convert realtime.svelte.ts derived stores to $derived()

## Description

Convert `derived()` stores in `realtime.svelte.ts` to `$derived()` or `$derived.by()` runes.

**File:** `apps/dashboard/src/lib/stores/realtime.svelte.ts`

**Derived Stores to Convert (~15 stores):**
- Lines 219-227: `instanceMessages` (per-instance message stores)
- Lines 375-410: `streamingStates` (per-instance streaming state)
- Lines 671-698: `subagents` (subagent tree)
- Lines 1078-1099: `instanceStatus`, `hasPendingPermission`
- Lines 1108-1194: `populatedInstances`, `onlineAgents`, `runningInstances`, `stats`
- Lines 2119-2194: `activeInstancesForTabs`, `filteredProjects`, etc.

## Migration Pattern

```typescript
// Before (Svelte 4)
export const onlineAgents = derived(agents, ($agents) =>
  [...$agents.values()].filter(a => a.status === 'online')
);

// After (Svelte 5) - Add to RealtimeState class
get onlineAgents() {
  return $derived.by(() =>
    [...this.agents.values()].filter(a => a.status === 'online')
  );
}

// Or as standalone (if needed externally)
export const onlineAgents = $derived.by(() =>
  [...realtime.agents.values()].filter(a => a.status === 'online')
);
```

## Factory Functions

Handle factory-created derived stores:
- `getInstanceMessages(instanceId)` - Consider memoization or move to component-level `$derived`
- `getStreamingState(instanceId)` - Same consideration

Options:
1. **Keep as factory:** Memoize with WeakMap
2. **Move to component:** Use `$derived` in consuming components
3. **Add to class:** Getters with parameters (less idiomatic)

## Key Considerations

1. **Dependency Tracking:** `$derived` auto-tracks dependencies - simpler than explicit `derived(store, fn)`
2. **Complex Logic:** Use `$derived.by()` for multi-line computations
3. **Export Strategy:** Decide between class getters vs module-level exports
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
