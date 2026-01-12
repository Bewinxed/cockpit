# fn-3.1 Add context menu to SidebarInstanceItem

## Description
TBD

## Acceptance
- [ ] TBD

## Done summary
## Done Summary

Context menu already implemented in SidebarInstanceItem.svelte.

### Menu Items
1. **Open in Split View** - Calls enableSplitView(instance.id)
2. **Copy Path** - Copies instance.cwd to clipboard
3. **Stop Instance** - Conditional, only shows for running/starting instances
4. **Remove Instance** - Closes tab and stops instance

### Implementation
- Uses bits-ui ContextMenu components
- Right-click triggers menu
- Menu state tracked with isMenuOpen

### Verified
Full context menu at `apps/dashboard/src/lib/components/sidebar/SidebarInstanceItem.svelte` lines 75-138
## Evidence
- Commits:
- Tests: code review
- PRs: