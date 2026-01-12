# fn-2.3 6.3: Add split view state management

## Description
TBD

## Acceptance
- [ ] TBD

## Done summary
## Done Summary

Split view state management already implemented in realtime.svelte.ts.

### Implementation
- `splitViewState` writable store with `enabled`, `secondInstanceId`, `splitRatio`
- `enableSplitView(secondInstanceId)` - enables split view
- `disableSplitView()` - disables split view
- Auto-closes split view when one of the instances is closed

### Integration
- Used in WorkspaceTabs.svelte to conditionally render WorkspaceSplit
- Used in InstanceHeader.svelte and SidebarInstanceItem.svelte to enable split view

### Verified
State management exists at `apps/dashboard/src/lib/stores/realtime.svelte.ts` lines 1503-1518
## Evidence
- Commits:
- Tests: code review
- PRs: