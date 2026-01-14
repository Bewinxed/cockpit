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
TBD

## Evidence
- Commits:
- Tests:
- PRs:
