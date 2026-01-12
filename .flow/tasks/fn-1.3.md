# fn-1.3 12.2: Remove old /agents page

## Description
TBD

## Acceptance
- [ ] TBD

## Done summary
## Done Summary

Redirect `/agents` and `/agents/[id]` to root already implemented.

### Implementation
- `apps/dashboard/src/routes/agents/+page.server.ts` performs 301 redirect to `/`
- `apps/dashboard/src/routes/agents/[id]/+page.server.ts` performs 301 redirect to `/`
- Sidebar now shows all agents, no separate pages needed

### Verified
Routes exist and redirect to root.
## Evidence
- Commits:
- Tests: code review
- PRs: