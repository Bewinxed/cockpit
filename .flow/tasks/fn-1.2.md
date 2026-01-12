# fn-1.2 12.1: Remove old /instances list page

## Description
TBD

## Acceptance
- [ ] TBD

## Done summary
## Done Summary

Redirect `/instances` to root already implemented.

### Implementation
- `apps/dashboard/src/routes/instances/+page.server.ts` performs 301 redirect to `/`
- Sidebar now shows all instances, no separate list page needed

### Verified
Route exists and redirects to root.
## Evidence
- Commits:
- Tests: code review
- PRs: