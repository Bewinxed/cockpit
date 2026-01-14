# fn-9.1 Run sv check on dashboard

## Description
Run `sv check` (Svelte's official diagnostic CLI) on the `apps/dashboard/` SvelteKit project.

## Commands

```bash
cd apps/dashboard
bunx sv check --output machine-verbose 2>&1 | tee /tmp/svelte-diagnostics.txt
bunx sv check --output human 2>&1 | head -100  # For readable summary
```

## What to capture

- All errors (exit code, count, file locations)
- All warnings (Svelte-specific, TypeScript, a11y)
- Diagnostic sources: `js`, `svelte`, `css`

## Key files to check

- `src/lib/stores/*.svelte.ts` - Svelte 5 rune-based stores
- `src/lib/components/**/*.svelte` - Svelte 5 components
- `src/routes/**/*.svelte` - Page components

## Known issues to expect

- `connection.svelte.ts` has river.ts import errors
- Experimental features (`async`, `remoteFunctions`) may trigger warnings
## Acceptance
- [ ] `sv check` command executes without crashing
- [ ] Output is captured in both machine and human-readable formats
- [ ] Error count and warning count are documented
- [ ] File paths with issues are listed
## Done summary
TBD

## Evidence
- Commits:
- Tests:
- PRs:
