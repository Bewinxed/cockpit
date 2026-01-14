# fn-8 Post-Migration Cleanup: Remove legacy code and fix anti-patterns

## Overview

Clean up the codebase after the fn-6 (Svelte 5 stores) and fn-7 (river.ts SSE) migrations. Remove legacy `realtime.svelte.ts`, fix string-matching anti-patterns, and consolidate duplicate types.

**Current State:**
- `realtime.svelte.ts` (74KB, 2200+ lines) is legacy dead code
- `actions.ts` uses string-matching for auth error detection (bad pattern)
- `actions.ts` still imports fetch functions from legacy `realtime.svelte.ts`
- Duplicate type definitions across `types.ts`, `realtime.svelte.ts`, and `data.remote.ts`
- Some deprecated exports still in `index.svelte.ts`
- Various LSP warnings in components

**Target State:**
- Legacy `realtime.svelte.ts` deleted
- Proper error handling via error codes, not string matching
- Single source of truth for types in `types.ts`
- Clean imports with no legacy dependencies
- Zero LSP diagnostics

## Findings from Repo Scan

### 1. String-Matching Anti-Patterns (actions.ts:29)
```typescript
// BAD - fragile string matching
const errorStr = extractErrorMessage(error).toLowerCase();
if (errorStr.includes('auth') || errorStr.includes('login') || errorStr.includes('credential')) {
  return true;
}
```
Should use only error codes (which are already checked at line 35).

### 2. Legacy Imports (actions.ts:7)
```typescript
// BAD - imports from legacy file
import { fetchAgents, fetchInstances, fetchProjects } from './stores/realtime.svelte';
```
These fetch functions duplicate what entity stores already do. Remove them and use SSE-based reactivity or `getAgents()`, `getInstances()`, `getProjects()` from `data.remote.ts`.

### 3. Duplicate Types
Types are defined in 3+ places:
- `stores/types.ts` (canonical)
- `stores/realtime.svelte.ts` (legacy, delete)
- `data.remote.ts` (uses simpler API response types, OK to keep)

### 4. Legacy SSE Code
The entire `realtime.svelte.ts` file is superseded by:
- Entity stores: `agents.svelte.ts`, `instances.svelte.ts`, etc.
- Connection: `connection.svelte.ts` (uses river.ts)
- Message handler: `sdk-message-handler.ts`

### 5. Deprecated Exports (index.svelte.ts:335-347)
```typescript
/** @deprecated Use agents.online directly */
readonly onlineAgents = $derived(agents.online);
```
These are compatibility shims that should be removed after verifying nothing uses them.

## Scope

### In Scope
- Delete `realtime.svelte.ts`
- Fix `isAuthError()` in `actions.ts` to use only error codes
- Remove fetch functions from `actions.ts` or replace with proper alternatives
- Remove deprecated exports from `index.svelte.ts`
- Fix LSP diagnostics in components
- Verify no imports remain from deleted file

### Out of Scope
- New features
- Hub/agent changes
- Performance optimization

## Tasks

### fn-8.1: Remove string-matching from isAuthError
Fix `actions.ts` to use only error codes for auth detection, not string matching.

### fn-8.2: Replace legacy fetch imports in actions.ts
Remove `fetchAgents`, `fetchInstances`, `fetchProjects` imports from `realtime.svelte.ts`. Either:
- Use data.remote.ts functions for one-time fetches
- Let SSE reactivity handle updates (preferred)

### fn-8.3: Remove deprecated exports from index.svelte.ts
Remove the deprecated `onlineAgents`, `activeTasks`, `allPendingPermissions`, `pendingPermissionCount` exports after verifying nothing uses them.

### fn-8.4: Delete realtime.svelte.ts
Delete the legacy 74KB file and verify all imports are resolved.

### fn-8.5: Fix LSP diagnostics in components
Fix remaining warnings in WorkspaceInstance.svelte and other files.

## Quick commands

```bash
# Check for imports from realtime
grep -r "realtime.svelte" apps/dashboard/src/

# Check LSP diagnostics
cd apps/dashboard && bunx svelte-check

# Verify build
bun run build
```

## Acceptance

- [ ] `realtime.svelte.ts` is deleted
- [ ] No string matching for error type detection
- [ ] No imports from deleted file
- [ ] Zero deprecated exports
- [ ] `bunx svelte-check` passes with no errors
- [ ] Build succeeds

## References

- fn-6: Svelte 5 entity stores migration
- fn-7: river.ts SSE migration
- Entity stores: `apps/dashboard/src/lib/stores/*.svelte.ts`
- Type definitions: `apps/dashboard/src/lib/stores/types.ts`
