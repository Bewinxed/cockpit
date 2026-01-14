# fn-6.4 Migrate lifecycle hooks to $effect() in chat and workspace components

## Description
# TASK CANCELLED - No longer needed

~~Migrate lifecycle hooks to $effect() in chat and workspace components~~

## Why This Task Was Cancelled

Based on official Svelte 5 documentation:
- `onMount` and `onDestroy` are **NOT deprecated** in Svelte 5
- `$effect` is for **reactive** side effects, NOT a replacement for lifecycle hooks
- The docs explicitly state "$effect is best considered an escape hatch"

## Current State Analysis

All target components are already using the CORRECT patterns:
- `chat-list.svelte` - already uses `$effect` (already migrated)
- `SubagentBranch.svelte` - already uses `$effect` for reactive interval (already migrated, correct use)
- `WorkspaceInstance.svelte` - uses `onMount`/`onDestroy` for event listeners (CORRECT - one-time setup)
- `+layout.svelte` - uses `onMount`/`onDestroy` for EventSource (CORRECT - client-only, one-time)
- `DiffView.svelte` - uses `onMount`/`onDestroy` for external library (CORRECT)
- `DiffModal.svelte` - uses `onMount`/`onDestroy` + `$effect` hybrid (CORRECT)

**No migration needed.** The original task was based on the false premise that all `onMount`/`onDestroy` should become `$effect`.
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
- [x] Task cancelled - based on incorrect assumptions about Svelte 5 lifecycle hooks
- [x] Verified: onMount/onDestroy are NOT deprecated in Svelte 5
- [x] Verified: all target components already use appropriate patterns
- [x] +layout.svelte correctly uses onMount for EventSource (client-only)
- [x] WorkspaceInstance.svelte correctly uses onMount for event listeners
- [x] DiffView/DiffModal correctly use onMount for external library cleanup
## Done summary
- Task cancelled - based on incorrect assumptions
- Verified onMount/onDestroy are NOT deprecated in Svelte 5
- All components already use correct patterns
## Evidence
- Commits:
- Tests: Verified via Svelte 5 official docs
- PRs: