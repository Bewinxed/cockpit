# fn-9.2 Questions store and SSE event handling

## Description

Create the questions store for managing pending question requests and handle SSE events. Follow the permissions store pattern.

1. **Questions store** (`apps/dashboard/src/lib/stores/questions.svelte.ts`):
   - Singleton with HMR persistence via `globalThis.__cockpitQuestionStore`
   - `Map<string, QuestionRequest>` for pending questions by requestId
   - `handleRequest(request: QuestionRequest)` - add to pending
   - `handleResponse(requestId: string)` - remove from pending
   - `getPendingForInstance(instanceId: string)` - get pending questions
   - Derived `count` store for badge/indicator

2. **SSE event type** (`apps/dashboard/src/lib/stores/sse-events.ts`):
   ```typescript
   interface QuestionRequestEvent {
     requestId: string;
     instanceId: string;
     toolUseId: string;
     questions: Array<{...}>;
     createdAt: number;
   }
   ```

3. **Event handler registration** in realtime store SSE setup

## Files to Modify

- `apps/dashboard/src/lib/stores/questions.svelte.ts` (create)
- `apps/dashboard/src/lib/stores/sse-events.ts` (add type)
- `apps/dashboard/src/lib/stores/index.ts` (export)
- SSE event handler registration (where `permission:request` is handled)

## References

- Permissions store: `apps/dashboard/src/lib/stores/permissions.svelte.ts`
- SSE events: `apps/dashboard/src/lib/stores/sse-events.ts`
## Acceptance
- [ ] `questions` store exported from `$lib/stores`
- [ ] Store survives HMR (uses globalThis singleton pattern)
- [ ] `question:request` SSE events populate the store
- [ ] `getPendingForInstance(instanceId)` returns correct pending questions
- [ ] `count` derived store updates reactively
- [ ] `bun run --filter=@cockpit/dashboard check` passes
## Done summary
TBD

## Evidence
- Commits:
- Tests:
- PRs:
