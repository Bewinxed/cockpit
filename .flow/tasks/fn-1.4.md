# fn-1.4 12.5: Remove old navigation menu components

## Description
TBD

## Acceptance
- [ ] TBD

## Done summary
## Done Summary

Removed old navigation menu components (orphaned dashboard view).

### Removed Files
- `apps/dashboard/src/routes/+page.svelte` - Old dashboard page (never rendered, no slot in layout)

### Verified
- No old navigation menu components existed separately
- The +page.svelte was orphaned code (AppShell renders workspace directly)
- Build passes after removal
## Evidence
- Commits:
- Tests: bun run build
- PRs: