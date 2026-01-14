# fn-8.5 Fix LSP diagnostics in components

## Description

Fix remaining LSP warnings and errors in dashboard components.

**Known issues from diagnostics:**

1. **WorkspaceInstance.svelte:**
   - `Loader2` is deprecated (use different icon)
   - `StreamingIndicator` is declared but never read
   - `agent` is declared but never read
   - `pendingAuthUrl` is declared but never read (can remove - auth event listener was removed)
   - `groupIdx` is declared but never read

2. **realtime.svelte.ts:** (will be deleted in fn-8.4, ignore these)
   - Parameter 'a' implicitly has 'any' type
   - Parameter 'i' implicitly has 'any' type
   - Parameter 'p' implicitly has 'any' type
   - 'instanceId' declared but never read
   - 'index' declared but never read

**Actions:**
1. Remove or use unused variables
2. Replace deprecated `Loader2` with alternative (e.g., `LoaderCircle` or custom)
3. Clean up any other warnings that appear after fn-8.4 deletion

## Acceptance

- [ ] WorkspaceInstance.svelte has no LSP warnings
- [ ] `bunx svelte-check` shows no errors or warnings in modified files
- [ ] No unused imports or variables

## Done summary
TBD

## Evidence
- Commits:
- Tests:
- PRs:
