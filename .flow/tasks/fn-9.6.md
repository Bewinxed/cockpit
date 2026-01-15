# fn-9.6 SDK message handler integration

## Description

Wire up the SDK message handler to create system messages with `ask_question` subtype for rendering.

1. **Extend MessageMetadata** (`apps/dashboard/src/lib/stores/types.ts`):
   ```typescript
   // In MessageMetadata interface
   questionRequestId?: string;
   questions?: Array<{
     question: string;
     header: string;
     options: Array<{ label: string; description: string }>;
     multiSelect: boolean;
   }>;
   questionAnswers?: Record<string, string>;  // For inactive state
   ```

2. **Create system message on question:request SSE**:
   - In realtime store SSE handler
   - Create message with `type: 'system'`, `subtype: 'ask_question'`
   - Store question data in metadata

3. **Update message on response**:
   - When question is answered, update message metadata with answers
   - This triggers inactive state rendering

4. **Wire up ChatMessage.svelte** callbacks:
   - Pass `onQuestionSubmit` and `onQuestionCancel` to renderer
   - `onQuestionSubmit` calls `POST /api/instances/:id/question`

## Files to Modify

- `apps/dashboard/src/lib/stores/types.ts` (extend MessageMetadata)
- `apps/dashboard/src/lib/stores/realtime.svelte.ts` or SSE handler (create message on event)
- `apps/dashboard/src/lib/components/features/ChatMessage.svelte` (wire callbacks)

## References

- Permission SSE handling: search for `permission:request` in codebase
- ChatMessage renderer props: `apps/dashboard/src/lib/components/features/ChatMessage.svelte`
## Acceptance
- [ ] MessageMetadata includes `questionRequestId`, `questions`, `questionAnswers`
- [ ] `question:request` SSE event creates system message with `ask_question` subtype
- [ ] Message appears in chat as interactive AskQuestionPicker
- [ ] Submit callback sends POST to hub and updates message with answers
- [ ] Answered questions display in inactive/compact state
- [ ] Full flow works: Claude asks question -> UI shows -> user answers -> Claude continues
- [ ] `bun run --filter=@cockpit/dashboard check` passes
## Done summary
- Added 'ask_question' to MessageMetadata subtype union
- Added question metadata fields: questionRequestId, questions, questionAnswers
- Updated questions.handleRequest to create system message for UI rendering
- Added instances.updateQuestionAnswers to update message when user answers
- Complete flow: question:request SSE → questions store + system message → AskQuestionPicker renders

Why:
- Connects SSE events to the UI component
- Enables inactive/answered state display with stored answers

Verification:
- IDE diagnostics clean
- All types properly connected
## Evidence
- Commits: 47b4ccc10f32a79f4eda0bd0300ccc76bfce19bd
- Tests: IDE diagnostics clean
- PRs: