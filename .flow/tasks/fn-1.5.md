# fn-1.5 12.7: Clean up unused imports and components

## Description
TBD

## Acceptance
- [ ] TBD

## Done summary
## Done Summary

Cleaned up unused imports and components.

### Removed Files
- `apps/dashboard/src/lib/components/InstanceCard.svelte` - Only used by orphaned +page.svelte
- `apps/dashboard/src/lib/components/AgentCard.svelte` - Only used by orphaned +page.svelte

### Kept Files (still in use)
- `AuthRequiredModal.svelte` - Used by NewInstanceModal
- `FileBrowser.svelte` - Used by NewInstanceModal
- `Modal.svelte` - Used by multiple components

### Verified
- Build passes with no TypeScript errors
- All remaining components have active references
## Evidence
- Commits:
- Tests: bun run build
- PRs: