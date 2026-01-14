# fn-6.3 Migrate lifecycle hooks to $effect() in terminal components

## Description
# TASK CANCELLED - No longer needed

~~Migrate lifecycle hooks to $effect() in terminal components~~

## Why This Task Was Cancelled

Based on official Svelte 5 documentation:
- `onMount` and `onDestroy` are **NOT deprecated** in Svelte 5
- `$effect` is NOT a replacement for lifecycle hooks - it's for reactive side effects
- The docs say "$effect is best considered an escape hatch"

## Current State Analysis

All terminal components are already correctly using lifecycle hooks:
- `terminal-loading.svelte` - uses `onDestroy` for cleanup (CORRECT - non-reactive)
- `terminal-loop.svelte` - already uses `$effect` (already migrated)
- `terminal-animated-span.svelte` - already uses `$effect` (already migrated)
- `terminal-typing-animation.svelte` - already uses `$effect` (already migrated)
- `terminal.svelte` - uses `onMount` for one-time animation start (CORRECT - not reactive)

**No migration needed.** The original task was based on the false premise that `onMount`/`onDestroy` should be replaced with `$effect`.
## Migration Pattern

```typescript
// Before (Svelte 4)
import { onMount, onDestroy } from 'svelte';

let interval: ReturnType<typeof setInterval>;
onMount(() => {
  interval = setInterval(update, 1000);
});
onDestroy(() => {
  clearInterval(interval);
});

// After (Svelte 5)
$effect(() => {
  const interval = setInterval(update, 1000);
  return () => clearInterval(interval);
});
```

## Key Considerations

1. **Animation Timers:** These components use intervals/timeouts for animations - perfect candidates for `$effect()` with cleanup
2. **DOM References:** If using `bind:this`, ensure the element exists before accessing
3. **No SSR Impact:** Terminal components are likely client-only, so `$effect` is appropriate
## Acceptance
- [x] Task cancelled - based on incorrect assumptions about Svelte 5 lifecycle hooks
- [x] Verified: onMount/onDestroy are NOT deprecated in Svelte 5
- [x] Verified: terminal components already use appropriate patterns
## Done summary
- Task cancelled - based on incorrect assumptions
- Verified onMount/onDestroy are NOT deprecated in Svelte 5
- All components already use correct patterns
## Evidence
- Commits:
- Tests: Verified via Svelte 5 official docs
- PRs: