# fn-1.1 12.4: Redirect /instances/[id] to root with instance in tabs

## Description
TBD

## Acceptance
- [ ] TBD

## Done summary
## Done Summary

Redirect `/instances/[id]` to root with tabs already implemented.

### Implementation
- `apps/dashboard/src/routes/instances/[id]/+page.server.ts` performs 301 redirect
- URL pattern: `/instances/abc123` → `/?tabs=abc123&active=abc123`

### Verified
Route exists and performs correct redirect to tab-based URL format.
## Evidence
- Commits:
- Tests: code review
- PRs: