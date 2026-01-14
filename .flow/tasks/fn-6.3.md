# fn-6.3 Migrate lifecycle hooks to $effect() in terminal components

## Description

Migrate `onMount`/`onDestroy` lifecycle hooks to `$effect()` with cleanup in terminal UI components.

**Files:**
- `apps/dashboard/src/lib/components/ui/terminal/terminal-loading.svelte` (lines 3, 52)
- `apps/dashboard/src/lib/components/ui/terminal/terminal-loop.svelte` (lines 2, 17)
- `apps/dashboard/src/lib/components/ui/terminal/terminal-animated-span.svelte` (lines 3, 28)
- `apps/dashboard/src/lib/components/ui/terminal/terminal-typing-animation.svelte` (lines 3, 23)
- `apps/dashboard/src/lib/components/ui/terminal/terminal.svelte` (lines 5, 27)

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
- [ ] No `onMount`/`onDestroy` imports in terminal components
- [ ] All cleanup logic uses `$effect()` return functions
- [ ] Terminal animations work correctly
- [ ] No memory leaks (intervals/timeouts properly cleaned up)
- [ ] `bunx svelte-check` passes for all terminal components
## Done summary
TBD

## Evidence
- Commits:
- Tests:
- PRs:
