# fn-8.2 Replace legacy fetch imports in actions.ts

## Description

Remove the imports from `realtime.svelte.ts` and replace with proper alternatives.

**Current (bad):**
```typescript
import { fetchAgents, fetchInstances, fetchProjects } from './stores/realtime.svelte';
```

**Problem:** These functions update the old Svelte 4 stores. The new entity stores are updated via SSE events.

**Options:**
1. Remove fetch calls entirely - SSE reactivity handles updates
2. Use `getAgents()`, `getInstances()`, `getProjects()` from `data.remote.ts` if one-time fetch needed
3. Call entity store methods directly if refresh is needed

**Analysis needed:**
- Check where `fetchAgents`, `fetchInstances`, `fetchProjects` are called in actions.ts
- Determine if they're needed or if SSE already handles updates
- If needed, use data.remote.ts functions instead

**File:** `apps/dashboard/src/lib/actions.ts`, line 7

## Acceptance

- [ ] No imports from `realtime.svelte.ts`
- [ ] Actions still work correctly (test spawn, stop, resume)
- [ ] SSE updates still propagate correctly
- [ ] LSP shows no errors

## Done summary
TBD

## Evidence
- Commits:
- Tests:
- PRs:
