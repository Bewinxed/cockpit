# fn-6.7 Update store consumers and verify reactivity

## Description

Update all components that consume stores from `realtime.svelte.ts` to use the new class-based API, and verify reactivity works correctly.

## Consumer Updates

Components currently use `$storeName` syntax:
```svelte
{#each $agents.values() as agent}
```

Will need to update to:
```svelte
{#each realtime.agents.values() as agent}
```

Or if using getters:
```svelte
{#each realtime.onlineAgents as agent}
```

## Files to Update

Search for imports from `realtime.svelte.ts` and update usage:
- All components importing `agents`, `instances`, `projects`, etc.
- Layout components using connection status
- Sidebar components using filtered data
- Workspace components using instance data

## Verification Checklist

Test these scenarios:
1. **Agent Connection:** Connect agent, verify it appears in UI
2. **Instance Creation:** Create instance, verify it appears in tabs
3. **Message Streaming:** Send message, verify streaming works
4. **Real-time Updates:** SSE events update UI correctly
5. **Derived Data:** `populatedInstances`, `onlineAgents` computed correctly
6. **Tab State:** Instance tabs persist and update correctly

## Testing Commands

```bash
# Start dashboard
bun run dev:dashboard

# Start hub (for SSE)
bun run hub

# Type check
cd apps/dashboard && bunx svelte-check

# Verify no old store patterns
grep -r "\$agents\|\$instances\|\$projects" apps/dashboard/src --include="*.svelte"
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
