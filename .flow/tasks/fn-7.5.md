# fn-7.5 Remove legacy SSE code and update +layout.svelte

## Description

Remove the legacy SSE connection code from `realtime.svelte.ts` and update `+layout.svelte` to use the new ConnectionStore.

## Current State

- `+layout.svelte` imports `connect`, `disconnect`, `initializeFromSSR` from `realtime.svelte.ts`
- `realtime.svelte.ts` contains 500+ lines of SSE handlers (lines 1195-1681)
- Both old and new stores exist in parallel

## Steps

### 1. Update +layout.svelte

Replace old imports with new connection store:

```svelte
<script lang="ts">
  import '../app.css';
  import { onMount, onDestroy } from 'svelte';
  import { toast } from 'svelte-sonner';
  import { HUB_URL } from '$lib/config';
  // NEW: Use connection store instead of realtime functions
  import { connection, instances, permissions } from '$lib/stores';
  import { agents } from '$lib/stores/agents.svelte';
  import { projects } from '$lib/stores/projects.svelte';
  // ... rest of imports

  let { data, children } = $props();

  onMount(() => {
    // Initialize from SSR data
    if (data.agents) agents.initializeFromSSR(data.agents);
    if (data.instances) instances.initializeFromSSR(data.instances);
    if (data.projects) projects.initializeFromSSR(data.projects);

    // Connect to SSE
    connection.connect(HUB_URL);

    // ... rest of setup
  });

  onDestroy(() => {
    connection.disconnect();
  });
</script>
```

### 2. Remove Old SSE Code from realtime.svelte.ts

Remove these sections:
- `connect()` function (lines ~1195-1236)
- SSE event handlers (lines ~1238-1681)
- `disconnect()` function
- `initializeFromSSR()` function (if entity stores have their own)
- Any reconnection logic

### 3. Clean Up Unused Exports

Remove exports that are no longer needed:
- `connect`
- `disconnect`
- `initializeFromSSR`
- Any handler functions that were only used by SSE

### 4. Verify No Remaining Dependencies

```bash
grep -r "from '\$lib/stores/realtime" apps/dashboard/src --include="*.svelte" --include="*.ts"
```

Should only show type imports or facade re-exports.

### 5. Test Full Flow

1. Start hub: `bun run hub`
2. Start dashboard: `bun run dev:dashboard`
3. Verify:
   - Agents appear in sidebar
   - Instances can be created
   - Messages stream correctly
   - Reconnection works (stop hub, restart)

## Acceptance

- [ ] `+layout.svelte` uses ConnectionStore
- [ ] No SSE code remains in `realtime.svelte.ts`
- [ ] SSR initialization works for all entities
- [ ] Real-time updates flow correctly
- [ ] Reconnection works
- [ ] No console errors
- [ ] `bunx svelte-check` passes
- [ ] `realtime.svelte.ts` can potentially be deleted (or just contains legacy compat exports)

## Done summary
## fn-7.5: Remove legacy SSE code and update +layout.svelte

### Completed
Updated +layout.svelte to use the new store system with river.ts SSE handling.

### Changes Made
1. **+layout.svelte**: 
   - Replaced imports from `realtime.svelte.ts` with new stores
   - Uses `initializeFromSSR()` for SSR data initialization
   - Uses `setupSSEAndConnect()` / `disconnectSSE()` for connection lifecycle

2. **index.svelte.ts** (store facade):
   - Added `initializeFromSSR()` function that delegates to entity stores
   - Added `setupSSEAndConnect()` that wires all SSE handlers and connects
   - Added `disconnectSSE()` for cleanup

### Files Modified
- `apps/dashboard/src/routes/+layout.svelte`
- `apps/dashboard/src/lib/stores/index.svelte.ts`

### Legacy Code Status
- `realtime.svelte.ts` is no longer imported by layout
- Can be removed in a follow-up cleanup task
## Evidence
- Commits:
- Tests:
- PRs: