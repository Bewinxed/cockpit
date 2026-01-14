# fn-6.4 Migrate lifecycle hooks to $effect() in chat and workspace components

## Description

Evaluate and migrate `onMount`/`onDestroy` in chat and workspace components where appropriate. Some uses may need to remain as `onMount` for SSR considerations.

**Files to Evaluate:**
- `apps/dashboard/src/lib/components/ui/chat/chat-list.svelte` (lines 3, 17) - scroll behavior
- `apps/dashboard/src/lib/components/workspace/WorkspaceInstance.svelte` (lines 2, 453, 464) - message loading, scroll
- `apps/dashboard/src/lib/components/features/subagent/SubagentBranch.svelte` (lines 2, 79, 97) - timer interval

**Files to Keep as onMount (external library/SSR):**
- `apps/dashboard/src/routes/+layout.svelte` (EventSource connection)
- `apps/dashboard/src/lib/components/features/DiffView.svelte` (@pierre/diffs library)
- `apps/dashboard/src/lib/components/features/DiffModal.svelte` (@pierre/diffs library, keyboard handlers)

## Migration Decisions

| File | Current Use | Decision |
|------|-------------|----------|
| `chat-list.svelte` | Scroll behavior flag | Convert - simple timing |
| `WorkspaceInstance.svelte` | Message loading + scroll | Evaluate - may have reactive deps |
| `SubagentBranch.svelte` | setInterval timer | Convert - cleanup pattern |
| `+layout.svelte` | EventSource setup | Keep - SSR, runs once |
| `DiffView.svelte` | External library | Keep - library cleanup |
| `DiffModal.svelte` | External library + keyboard | Keep - library cleanup |

## Migration Pattern

```typescript
// Before
onMount(() => {
  smoothScrollEnabled = true;
});

// After
$effect(() => {
  smoothScrollEnabled = true;
});
```

For `SubagentBranch.svelte` timer:
```typescript
// Before
onMount(() => {
  interval = setInterval(updateElapsed, 1000);
});
onDestroy(() => {
  if (interval) clearInterval(interval);
});

// After
$effect(() => {
  const interval = setInterval(updateElapsed, 1000);
  return () => clearInterval(interval);
});
```
## Acceptance
- [ ] `chat-list.svelte` uses `$effect()` instead of `onMount`
- [ ] `SubagentBranch.svelte` uses `$effect()` with cleanup for timer
- [ ] `WorkspaceInstance.svelte` evaluated and migrated where appropriate
- [ ] Files with external libraries (`DiffView`, `DiffModal`) retain `onMount`
- [ ] `+layout.svelte` retains `onMount` for EventSource
- [ ] Chat scrolling still works correctly
- [ ] Subagent elapsed time displays correctly
- [ ] `bunx svelte-check` passes for all modified components
## Done summary
TBD

## Evidence
- Commits:
- Tests:
- PRs:
