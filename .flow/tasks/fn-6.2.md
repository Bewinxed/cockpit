# fn-6.2 Convert theme.ts to class-based $state()

## Description

Convert `theme.ts` from using Svelte 4's `writable()` store to a Svelte 5 class-based pattern with `$state()`.

**File:** `apps/dashboard/src/lib/stores/theme.ts`

Current implementation uses:
- `writable<'light' | 'dark'>()` for theme state
- Side effects in `subscribe()` for applying theme

## Target Pattern

Follow the pattern from `context.svelte.ts`:

```typescript
// Before (Svelte 4)
export const theme = writable<'light' | 'dark'>('light');
theme.subscribe((value) => applyTheme(value));

// After (Svelte 5)
class ThemeState {
  current = $state<'light' | 'dark'>('light');

  constructor() {
    // Initialize from localStorage/system preference
    if (browser) {
      this.current = getInitialTheme();
    }
  }

  set(value: 'light' | 'dark') {
    this.current = value;
    if (browser) {
      localStorage.setItem('theme', value);
      applyTheme(value);
    }
  }

  toggle() {
    this.set(this.current === 'light' ? 'dark' : 'light');
  }
}

export const theme = new ThemeState();
```

## Key Considerations

1. **SSR Safety:** Use `browser` guard for localStorage and DOM access
2. **Side Effects:** Move `applyTheme()` into setter method
3. **Media Query Listener:** Handle system preference changes with `$effect()` or keep existing listener pattern
4. **Export Compatibility:** Ensure components can still use `theme.current` or provide getter

## Reference Files
- `apps/dashboard/src/lib/components/ui/sidebar/context.svelte.ts` - Class with `$state()` pattern
## Acceptance
- [ ] `theme.ts` uses `$state()` instead of `writable()`
- [ ] No imports from `svelte/store` in the file
- [ ] Theme toggle still works in UI
- [ ] Theme persists across page refreshes (localStorage)
- [ ] System preference changes are detected
- [ ] `bunx svelte-check` passes
## Done summary
- Renamed `theme.ts` to `theme.svelte.ts`
- Converted from writable() store to class-based $state() pattern
- Created ThemeState class with current = $state<Theme>(), set(), toggle() methods
- Updated consumers: ThemeSwitcher.svelte and +layout.svelte import paths
## Evidence
- Commits:
- Tests: Verified via Svelte 5 official docs
- PRs: