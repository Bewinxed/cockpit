# fn-9.5 Agent-side question interception and resolution

## Description

Implement the agent-side logic to intercept AskUserQuestion tool calls and handle responses.

1. **Pending questions map** (`packages/agent-service/src/instance-manager.ts`):
   ```typescript
   private pendingQuestions = new Map<string, {
     resolve: (answers: Record<string, string>) => void;
     reject: (error: Error) => void;
     toolUseId: string;
   }>();
   ```

2. **Intercept AskUserQuestion** in SDK wrapper or tool handler:
   - Detect `AskUserQuestion` tool invocation
   - Generate `requestId` (UUID)
   - Create pending promise
   - Send `question.request` notification to hub
   - Return promise (blocks until resolved)

3. **Handle response notification** (`question.response`):
   - Look up requestId in pendingQuestions
   - Resolve promise with answers
   - Remove from map

4. **Timeout handling**:
   - Optional: reject pending questions on instance stop
   - Clear pendingQuestions map on instance cleanup

## Files to Modify

- `packages/agent-service/src/instance-manager.ts` (add pendingQuestions, resolution)
- `packages/agent-service/src/sdk-wrapper.ts` or tool handler (intercept AskUserQuestion)

## References

- Permission resolution: `packages/agent-service/src/instance-manager.ts` (resolvePermission pattern)
- SDK wrapper: `packages/agent-service/src/sdk-wrapper.ts`
## Acceptance
- [ ] `pendingQuestions` map tracks active question requests
- [ ] AskUserQuestion tool invocations are intercepted before reaching SDK
- [ ] `question.request` notification sent to hub with question data
- [ ] `question.response` notification resolves pending promise
- [ ] Answers are returned to Claude as tool result
- [ ] Pending questions cleaned up on instance stop
## Done summary
TBD

## Evidence
- Commits:
- Tests:
- PRs:
