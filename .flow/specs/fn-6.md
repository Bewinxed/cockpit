# Svelte 4 to Svelte 5 Complete Migration

## Overview

Complete the migration from Svelte 4 patterns to Svelte 5 runes across the dashboard application. The codebase is already ~95% migrated - this epic covers the remaining patterns.

**Current State:**
- All components use `$props()` instead of `export let`
- `$state()`, `$derived()`, `$effect()` are used throughout components
- Snippets with `{@render}` instead of slots
- No `createEventDispatcher` - uses callback props

**Remaining Svelte 4 patterns:**
1. `realtime.svelte.ts` - 20+ `writable()` and 15+ `derived()` stores (~2000 lines)
2. `theme.ts` - Single `writable()` store
3. 11 files using `onMount`/`onDestroy` instead of `$effect()`
4. `StreamingIndicator.svelte` - unused `derived` import

## Scope

### In Scope
- Convert `theme.ts` to class-based `$state()` pattern
- Remove unused store imports
- Evaluate and convert `onMount`/`onDestroy` to `$effect()` where appropriate
- Convert `realtime.svelte.ts` stores to Svelte 5 class-based reactive state
- Add basic reactivity tests for store migration validation

### Out of Scope
- Full test coverage for entire dashboard
- Refactoring store architecture beyond Svelte 5 migration
- Performance optimization (separate effort)

## Approach

### Phase 1: Quick Wins
1. Remove unused `derived` import from `StreamingIndicator.svelte:3`
2. Convert `theme.ts` to class-based `$state()` - small isolated change

### Phase 2: Lifecycle Migration
Convert `onMount`/`onDestroy` to `$effect()` where appropriate:
- **Keep as onMount** (SSR/external library needs):
  - `+layout.svelte` - EventSource connection
  - `DiffView.svelte`, `DiffModal.svelte` - @pierre/diffs library cleanup
- **Convert to $effect**:
  - `SubagentBranch.svelte` - setInterval with cleanup
  - `chat-list.svelte` - scroll behavior flag
  - Terminal components - evaluate each

### Phase 3: Store Migration (realtime.svelte.ts)
Convert module-level stores to class-based reactive state:
1. Create `RealtimeState` class with `$state()` properties
2. Convert `writable()` to `$state()`
3. Convert `derived()` to `$derived()` or `$derived.by()`
4. Ensure Map mutation patterns trigger reactivity (use `new Map(map)` pattern)
5. Update all consumer components

**Key Patterns:**
```typescript
// Before (Svelte 4)
export const agents = writable<Map<string, Agent>>(new Map());

// After (Svelte 5)
class RealtimeState {
  agents = $state<Map<string, Agent>>(new Map());

  setAgent(id: string, agent: Agent) {
    this.agents = new Map(this.agents).set(id, agent);
  }
}
export const realtime = new RealtimeState();
```

## Quick Commands

```bash
# Smoke test - verify dashboard starts
bun run dev:dashboard

# Type check
cd apps/dashboard && bunx svelte-check

# Verify no Svelte 4 patterns remain
grep -r "writable\|derived\|export let" apps/dashboard/src --include="*.svelte" --include="*.svelte.ts"

# Check for createEventDispatcher (should find none)
grep -r "createEventDispatcher" apps/dashboard/src
```

## Acceptance Criteria

- [ ] No `writable()` or `derived()` imports from `svelte/store` in `.svelte.ts` files
- [ ] No unused imports in any component
- [ ] `bun run dev:dashboard` starts without errors
- [ ] `bunx svelte-check` passes with no errors
- [ ] SSE real-time updates still work correctly
- [ ] Store reactivity verified (UI updates when state changes)
- [ ] No Svelte 4 deprecation warnings in console

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Map mutation not triggering reactivity | Use `new Map(map).set()` pattern, test explicitly |
| Mixed Svelte 4/5 patterns during migration | Migrate in isolated commits, test each phase |
| SSR hydration issues | Keep `onMount` for SSR-sensitive code |
| Factory store memory leaks | Memoize or convert to component-level `$derived` |

## References

### Files to Modify
- `apps/dashboard/src/lib/stores/realtime.svelte.ts` (lines 1, 195-227, 375-410, 671-698, 1078-1194, 2047-2194)
- `apps/dashboard/src/lib/stores/theme.ts` (lines 1, 35)
- `apps/dashboard/src/lib/components/features/StreamingIndicator.svelte` (line 3)
- `apps/dashboard/src/routes/+layout.svelte` (lines 3, 61, 113)
- `apps/dashboard/src/lib/components/workspace/WorkspaceInstance.svelte` (lines 2, 453, 464)
- `apps/dashboard/src/lib/components/features/DiffView.svelte` (lines 2, 68, 107)
- `apps/dashboard/src/lib/components/features/DiffModal.svelte` (lines 2, 115, 128)
- `apps/dashboard/src/lib/components/features/subagent/SubagentBranch.svelte` (lines 2, 79, 97)
- `apps/dashboard/src/lib/components/ui/chat/chat-list.svelte` (lines 3, 17)
- `apps/dashboard/src/lib/components/ui/terminal/terminal-*.svelte` (multiple files)

### Documentation
- [Svelte 5 Migration Guide](https://svelte.dev/docs/svelte/v5-migration-guide)
- [$state Documentation](https://svelte.dev/docs/svelte/$state)
- [$effect Documentation](https://svelte.dev/docs/svelte/$effect)
- [$derived Documentation](https://svelte.dev/docs/svelte/$derived)

### Existing Patterns to Follow
- `apps/dashboard/src/lib/components/ui/sidebar/context.svelte.ts` - Class with `$state()`, `$derived.by()`
- `apps/dashboard/src/lib/hooks/use-auto-scroll.svelte.ts` - Class with `$state()`
