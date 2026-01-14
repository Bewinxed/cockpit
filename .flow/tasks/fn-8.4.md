# fn-8.4 Delete realtime.svelte.ts and resolve imports

## Description

Delete the legacy `realtime.svelte.ts` file (74KB, 2200+ lines) after ensuring all imports are resolved.

**Pre-deletion checklist:**
1. Verify fn-8.2 is complete (actions.ts no longer imports from it)
2. Search for any remaining imports: `grep -r "realtime.svelte" apps/dashboard/src/`
3. Fix any remaining imports before deletion

**What to delete:**
- `apps/dashboard/src/lib/stores/realtime.svelte.ts`

**The new architecture that replaces it:**
- `agents.svelte.ts` - Agent entity store
- `instances.svelte.ts` - Instance entity store
- `projects.svelte.ts` - Project entity store
- `tasks.svelte.ts` - Task entity store
- `permissions.svelte.ts` - Permission entity store
- `ui.svelte.ts` - UI state store
- `connection.svelte.ts` - SSE connection (river.ts)
- `sdk-message-handler.ts` - Message processing
- `types.ts` - Canonical type definitions
- `index.svelte.ts` - Store facade with cross-store derivations

## Acceptance

- [ ] `grep -r "realtime.svelte" apps/dashboard/src/` returns no results
- [ ] `realtime.svelte.ts` is deleted
- [ ] Build succeeds: `bun run build`
- [ ] `bunx svelte-check` passes

## Done summary
## fn-8.4: Delete realtime.svelte.ts and resolve imports

### Changes Made
1. Deleted the 74KB legacy `realtime.svelte.ts` file
2. Fixed Elysia type mismatch by:
   - Adding `@types/bun: latest` to hub-server devDependencies
   - Adding `@types/bun: latest` override in root package.json
   - Clean reinstall to unify Elysia resolution
3. Removed `any` cast in api.ts - now uses proper type-safe access

### Files Changed
- `packages/hub-server/package.json` - added @types/bun
- `package.json` - added @types/bun override
- `apps/dashboard/src/lib/api.ts` - removed `as any` cast

### Verification
- No TypeScript errors in api.ts
- Only one Elysia version in lockfile
- No remaining imports to realtime.svelte.ts (only comments)
## Evidence
- Commits:
- Tests:
- PRs: