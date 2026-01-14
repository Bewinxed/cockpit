# fn-9.2 Run tsc --noEmit on packages

## Description
Run TypeScript compiler in check-only mode on all packages in the monorepo.

## Commands

```bash
# From repo root
bunx tsc --noEmit --pretty 2>&1 | tee /tmp/tsc-diagnostics.txt

# Or per-package for more granular results
bun run --filter '*' typecheck 2>&1 | tee /tmp/all-typecheck.txt
```

## Packages to check

- `packages/core/` - Shared types and protocols
- `packages/db/` - Drizzle ORM schema
- `packages/hub-server/` - Elysia backend
- `packages/agent-service/` - Bun CLI agent
- `packages/auth/` - Authentication module
- `packages/mcp-task-tracker/` - MCP server

## Expected output

- Type errors with file:line:column
- Severity and error codes (e.g., TS2307, TS7006)
## Acceptance
- [ ] `tsc --noEmit` executes on all packages
- [ ] Output is captured to file
- [ ] Error count per package is documented
- [ ] Any new errors vs existing errors are noted
## Done summary
TBD

## Evidence
- Commits:
- Tests:
- PRs:
