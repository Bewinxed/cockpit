# AskUserQuestion UI Bridge

## Overview

Implement a custom message renderer and response flow for Claude Code's `AskUserQuestion` tool. This enables the dashboard to display interactive question dialogs when Claude needs user input during plan mode or other decision points, instead of showing raw tool_use blocks.

## Scope

### In Scope
- New `AskUserQuestion` message renderer component (following ModelPicker pattern)
- Type definitions for question data (header, question, options, multiSelect)
- SDK message handler extension to detect `AskUserQuestion` tool_use
- Store layer for pending questions (similar to permissions store)
- API endpoint for submitting question responses
- Agent-side handler for receiving responses
- Hub routing for question request/response flow
- Active/inactive state handling for answered questions
- Keyboard navigation (1-4 for options, Enter to submit, Escape to cancel)

### Out of Scope
- Complex validation beyond option selection
- Batch questions (multiple simultaneous questions)
- Question persistence across instance restart
- Subagent question routing (questions in subagents show in main chat)

## Approach

### Architecture Decision: Permission-like Flow

Use the proven Permission Request pattern rather than simple message-based response:

```
Agent detects AskUserQuestion tool_use
  → Creates pending question with requestId
  → Sends 'question.request' notification to hub
  → Hub broadcasts 'question:request' SSE event
  → Dashboard shows AskQuestionPicker component
  → User selects option(s) or enters "Other" text
  → Dashboard POSTs to /api/instances/:id/question
  → Hub forwards 'question.response' notification to agent
  → Agent resolves pending promise, continues execution
```

This matches how `canUseTool` blocks execution and waits for user response.

### Key Files to Modify/Create

| File | Action | Purpose |
|------|--------|---------|
| `packages/core/src/types/question.ts` | Create | QuestionRequest/Response types |
| `packages/core/src/protocol/index.ts` | Modify | Add QUESTION_REQUEST/RESPONSE methods |
| `apps/dashboard/src/lib/stores/types.ts` | Modify | Add question metadata to MessageMetadata |
| `apps/dashboard/src/lib/stores/questions.svelte.ts` | Create | Pending questions store (like permissions) |
| `apps/dashboard/src/lib/stores/sse-events.ts` | Modify | Add QuestionRequestEvent type |
| `apps/dashboard/src/lib/components/features/message-renderers/AskQuestionPicker.svelte` | Create | Interactive question UI component |
| `apps/dashboard/src/lib/components/features/message-renderers/registry.ts` | Modify | Register AskQuestionPicker renderer |
| `apps/dashboard/src/lib/components/features/message-renderers/types.ts` | Modify | Add question callbacks to props |
| `packages/hub-server/src/api/instances.ts` | Modify | Add POST /:id/question endpoint |
| `packages/hub-server/src/services/broadcast.ts` | Modify | Add question:request event emission |
| `packages/agent-service/src/instance-manager.ts` | Modify | Add pendingQuestions Map, resolution |
| `packages/agent-service/src/sdk-wrapper.ts` | Modify | Intercept AskUserQuestion tool, create request |

### AskUserQuestion Tool Structure (from Claude Code SDK)

```typescript
interface AskUserQuestionInput {
  questions: Array<{
    question: string;      // "Which library should we use?"
    header: string;        // "Library" (short label)
    options: Array<{
      label: string;       // "React Query"
      description: string; // "Handles caching, refetching..."
    }>;
    multiSelect: boolean;  // true = checkboxes, false = radio
  }>;
}
```

### Response Format

```typescript
interface QuestionResponse {
  requestId: string;
  instanceId: string;
  answers: Record<string, string>;  // { "0": "option_label" } or { "0": "Custom text" }
}
```

## Quick Commands

```bash
# Run type check after changes
bun run --filter=@cockpit/dashboard check

# Test SSE event flow
curl -N http://localhost:4000/api/events

# Run integration tests
bun test packages/hub-server
```

## Acceptance Criteria

- [ ] AskUserQuestion tool_use messages display as interactive picker (not raw JSON)
- [ ] Single-select questions show radio-style options with keyboard nav (Arrow keys, Enter)
- [ ] Multi-select questions show checkbox-style options with toggle behavior
- [ ] "Other" option allows free-text input when user needs custom answer
- [ ] Answered questions collapse to compact inactive state (like ModelPicker)
- [ ] Response is sent back to agent and execution continues
- [ ] Works in both plan mode and regular conversation
- [ ] No console errors or type errors

## References

- ModelPicker pattern: `apps/dashboard/src/lib/components/features/message-renderers/ModelPicker.svelte`
- Permission flow: `packages/core/src/types/permission.ts`, `apps/dashboard/src/lib/stores/permissions.svelte.ts`
- Message types: `apps/dashboard/src/lib/stores/types.ts:54-113`
- Renderer registry: `apps/dashboard/src/lib/components/features/message-renderers/registry.ts`
- SDK message handler: `apps/dashboard/src/lib/stores/sdk-message-handler.ts`
- Hub instance API: `packages/hub-server/src/api/instances.ts:1058-1110` (permission endpoint pattern)

## Open Questions

1. **Does AskUserQuestion arrive as tool_use or special message type?** - Need to verify actual SDK behavior with a test instance. Assuming tool_use based on other tools.

2. **Timeout handling** - Should questions have a timeout? What happens if user doesn't respond for 60 minutes (instance sleep)?

3. **Question cancellation** - Should users be able to cancel/skip a question? What response format indicates cancellation?
