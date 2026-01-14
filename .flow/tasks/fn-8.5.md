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
## fn-8.5: Fix LSP diagnostics in components

### Changes Made to WorkspaceInstance.svelte
1. Replaced deprecated `Loader2` with `LoaderCircle` from lucide-svelte
2. Removed unused import `StreamingIndicator`
3. Removed unused import `agents` from stores
4. Removed unused variable `agent` derived from instance.machineId
5. Removed unused variable `pendingAuthUrl` (auth URL now stored in message metadata)
6. Removed unused index variable `groupIdx` from each loop

### Files Changed
- `apps/dashboard/src/lib/components/workspace/WorkspaceInstance.svelte`

### Verification
- No TypeScript errors in WorkspaceInstance.svelte
- All unused variable warnings fixed
## Evidence
- Commits:
- Tests:
- PRs: