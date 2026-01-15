# fn-9.1 Core types and protocol definitions

## Description

Create the foundational type definitions for the AskUserQuestion feature. This includes:

1. **QuestionRequest interface** (`packages/core/src/types/question.ts`):
   ```typescript
   interface QuestionRequest {
     requestId: string;
     instanceId: string;
     toolUseId: string;
     questions: Array<{
       question: string;
       header: string;
       options: Array<{ label: string; description: string }>;
       multiSelect: boolean;
     }>;
     createdAt: number;
   }
   ```

2. **QuestionResponse interface**:
   ```typescript
   interface QuestionResponse {
     requestId: string;
     instanceId: string;
     answers: Record<string, string>;  // questionIndex -> selected label or custom text
   }
   ```

3. **Protocol methods** (`packages/core/src/protocol/index.ts`):
   - Add `QUESTION_REQUEST = 'question.request'`
   - Add `QUESTION_RESPONSE = 'question.response'`

4. **Export from core package** (`packages/core/src/index.ts`)

## Files to Modify

- `packages/core/src/types/question.ts` (create)
- `packages/core/src/types/index.ts` (export)
- `packages/core/src/protocol/index.ts` (add methods)
- `packages/core/src/index.ts` (re-export)

## References

- Permission types pattern: `packages/core/src/types/permission.ts`
- Protocol definitions: `packages/core/src/protocol/index.ts`
## Acceptance
- [ ] `QuestionRequest` and `QuestionResponse` interfaces exported from `@cockpit/core`
- [ ] `QUESTION_REQUEST` and `QUESTION_RESPONSE` protocol methods defined
- [ ] Types match AskUserQuestion tool schema (questions array, header, options, multiSelect)
- [ ] `bun run --filter=@cockpit/core check` passes with no type errors
## Done summary
- Created `packages/core/src/types/question.ts` with QuestionOption, Question, QuestionRequest, QuestionResponse interfaces
- Added QUESTION_REQUEST and QUESTION_RESPONSE protocol methods to PROTOCOL_METHODS
- Exported all question types from @cockpit/core package

Why:
- Foundation types needed for AskUserQuestion UI bridge
- Follows existing PermissionRequest/Response pattern

Verification:
- `bun run typecheck` passes in packages/core
- Types match Claude Code SDK's AskUserQuestion tool structure
## Evidence
- Commits: 5cee1ed36f1789956d9f47a0ed41f5c820b239f4
- Tests: bun run typecheck (packages/core)
- PRs: