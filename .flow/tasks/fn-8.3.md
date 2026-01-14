# fn-8.3 Remove deprecated exports from index.svelte.ts

## Description

Remove the deprecated compatibility shims from `CrossStoreDerivations` class in `index.svelte.ts`.

**Current (deprecated):**
```typescript
// Lines 335-347
/** @deprecated Use agents.online directly */
readonly onlineAgents = $derived(agents.online);

/** @deprecated Use tasks.active directly */
readonly activeTasks = $derived(tasks.active);

/** @deprecated Use permissions.sorted directly */
readonly allPendingPermissions = $derived(permissions.sorted);

/** @deprecated Use permissions.count directly */
readonly pendingPermissionCount = $derived(permissions.count);
```

**Before removing:**
1. Search for any usage of `stores.onlineAgents`, `stores.activeTasks`, `stores.allPendingPermissions`, `stores.pendingPermissionCount`
2. If found, update to use the direct store methods
3. Then remove the deprecated exports

**File:** `apps/dashboard/src/lib/stores/index.svelte.ts`, lines 335-347

## Acceptance

- [ ] No usage of deprecated exports found (or updated if found)
- [ ] Deprecated exports removed from CrossStoreDerivations
- [ ] LSP shows no errors
- [ ] Build succeeds

## Done summary
TBD

## Evidence
- Commits:
- Tests:
- PRs:
