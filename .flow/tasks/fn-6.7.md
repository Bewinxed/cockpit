# fn-6.7 Update store consumers and verify reactivity

## Description

Update all components consuming stores to use the new entity-based class API and verify reactivity.

**Migration Strategy from interview:** Use LSP rename (ensure correct tsconfig for monorepo).

## Migration Steps

### 1. Configure LSP for Monorepo

Ensure `apps/dashboard/tsconfig.json` is correctly configured:
```json
{
  "extends": "./.svelte-kit/tsconfig.json",
  "compilerOptions": {
    "paths": {
      "$lib/*": ["./src/lib/*"]
    }
  }
}
```

### 2. Update Import Statements

```typescript
// Before
import { agents, instances, messages, addMessage } from '$lib/stores/realtime.svelte';

// After - import from specific entity stores
import { agents } from '$lib/stores/agents.svelte';
import { instances } from '$lib/stores/instances.svelte';
```

### 3. Update Store Access Patterns

```svelte
<!-- Before: $storeName syntax -->
{#each $agents.values() as agent}
{#each $instances.values() as instance}
{$connectionStatus}

<!-- After: class property access -->
{#each agents.all.values() as agent}
{#each agents.online as agent}  <!-- derived -->
{#each instances.all.values() as instance}
{connection.status}
```

### 4. Update Mutation Calls

```typescript
// Before: store.update() or function calls
agents.update(map => { map.set(id, agent); return map; });
addMessage(instanceId, message);

// After: class methods
agents.set(id, agent);
instances.addMessage(instanceId, message);
```

### 5. Update Factory Consumers

```svelte
<!-- Before: factory function returns Readable -->
<script>
  const messages = getInstanceMessages(instanceId);
</script>
{#each $messages as msg}

<!-- After: $derived in component -->
<script>
  import { instances } from '$lib/stores/instances.svelte';
  const messages = $derived(instances.getMessages(instanceId));
</script>
{#each messages as msg}
```

## Files to Update (by search)

```bash
# Find all consumers
grep -rn "from '\$lib/stores/realtime" apps/dashboard/src --include="*.svelte" --include="*.ts"
grep -rn "\$agents\|\$instances\|\$projects\|\$tasks" apps/dashboard/src --include="*.svelte"
```

## Verification with Playwright MCP

After migration, use Playwright MCP agent to verify (per ASSUMPTIONS.md):

1. **SV1**: Add agent → appears in sidebar (SvelteMap reactivity)
2. **SV2**: `instances.addMessage()` → chat updates (class methods)
3. **SV3**: Change agent status → only agent deriveds update (efficiency)
4. **SV4**: Disconnect/reconnect network → SSE reconnects (river.ts)

## Testing Commands

```bash
# Start dashboard
bun run dev:dashboard

# Start hub (for SSE)
bun run hub

# Type check
cd apps/dashboard && bunx svelte-check

# Verify no old store patterns
grep -rn "\$agents\|\$instances\|\$projects" apps/dashboard/src --include="*.svelte"

# Verify no writable/derived imports
grep -rn "from 'svelte/store'" apps/dashboard/src/lib/stores --include="*.svelte.ts"
```
## Acceptance
- [ ] All store consumers updated to new API
- [ ] No `$storeName` patterns for migrated stores
- [ ] Dashboard starts without errors (`bun run dev:dashboard`)
- [ ] `bunx svelte-check` passes with no errors
- [ ] Agent list updates when agents connect/disconnect
- [ ] Instance tabs update when instances are created/stopped
- [ ] Message streaming displays correctly
- [ ] SSE real-time events update UI
- [ ] No console errors related to store access
- [ ] Derived values (onlineAgents, populatedInstances, etc.) compute correctly
## Done summary
# fn-6.7 Complete

## Summary
Updated all store consumers to use new Svelte 5 entity-based stores. Key changes:

1. **Migrated WorkspaceInstance.svelte** - Largest component, updated all imports and calls:
   - `$instances.get()` → `instances.get()`
   - `addMessage()` → `instances.addMessage()`
   - `updateStreamingState()` → `instances.updateStreamingState()`
   - `$activeSubagents.get()` → `instances.getSubagent()`
   - Factory functions → direct store methods

2. **Fixed cross-store derivations** - Svelte 5 doesn't allow exporting `$derived` directly from modules:
   - Wrapped derivations in `CrossStoreDerivations` class
   - Exported as `stores` singleton
   - Components now use `stores.stats`, `stores.populatedInstances`, etc.

3. **Updated all components** importing from `realtime.svelte.ts`:
   - InstancesTable, Sidebar, CommandPalette → `stores.populatedInstances`
   - WorkspaceEmpty, StatusBar → `stores.stats`
   - WorkspaceInstance → full migration to entity stores

4. **Remaining SSE functions** (`connect`, `disconnect`, `initializeFromSSR`) stay in `realtime.svelte.ts` - these are infrastructure, not store consumers.

## Files Changed
- `src/lib/stores/index.svelte.ts` - Added CrossStoreDerivations class
- `src/lib/components/workspace/WorkspaceInstance.svelte` - Full migration
- `src/lib/components/workspace/InstancesTable.svelte` - `stores.populatedInstances`
- `src/lib/components/shell/Sidebar.svelte` - `stores.instancesByProject`, `stores.stats`
- `src/lib/components/command-palette/CommandPalette.svelte` - `stores.populatedInstances`
- `src/lib/components/workspace/WorkspaceEmpty.svelte` - `stores.stats`
- `src/lib/components/shell/StatusBar.svelte` - `stores.stats`

## Verification
- `bunx svelte-check` passes with 0 errors
- Dashboard starts successfully
- No `$storeName` patterns remaining for migrated stores
## Evidence
- Commits:
- Tests:
- PRs: