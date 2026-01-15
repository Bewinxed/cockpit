# fn-9.3 AskQuestionPicker renderer component

## Description

Create the interactive AskQuestionPicker Svelte component following the ModelPicker pattern.

1. **Component structure** (`apps/dashboard/src/lib/components/features/message-renderers/AskQuestionPicker.svelte`):
   - Props: `MessageRendererProps` with `message`, `isActive`, `onQuestionSubmit`, `onQuestionCancel`
   - Active state: Full picker UI with question text, option buttons, "Other" input
   - Inactive state: Compact summary showing answered questions

2. **Features**:
   - Single-select: Radio-style buttons (only one selected at a time)
   - Multi-select: Checkbox-style buttons (toggle multiple)
   - "Other" option: Expandable text input for custom answer
   - Keyboard nav: Arrow keys to navigate, Enter to submit, Escape to cancel
   - Multiple questions: Render each question in sequence with headers

3. **Styling**:
   - Match existing picker styling (border-dotted, rounded-lg, bg-card)
   - Use bits-ui or native buttons with Tailwind
   - Icons: HelpCircle for header, Check for selected

4. **Register in registry** (`registry.ts`):
   ```typescript
   {
     component: AskQuestionPicker,
     match: (m: Message) => m.type === 'system' && m.metadata?.subtype === 'ask_question',
     priority: 100,
     name: 'AskQuestionPicker'
   }
   ```

5. **Add callbacks to types** (`types.ts`):
   ```typescript
   onQuestionSubmit?: (answers: Record<string, string>) => Promise<void>;
   onQuestionCancel?: () => void;
   ```

## Files to Modify

- `apps/dashboard/src/lib/components/features/message-renderers/AskQuestionPicker.svelte` (create)
- `apps/dashboard/src/lib/components/features/message-renderers/registry.ts` (register)
- `apps/dashboard/src/lib/components/features/message-renderers/types.ts` (add callbacks)

## References

- ModelPicker: `apps/dashboard/src/lib/components/features/message-renderers/ModelPicker.svelte`
- PermissionRequest: `apps/dashboard/src/lib/components/features/PermissionRequest.svelte`
## Acceptance
- [ ] Component renders question text and options as clickable buttons
- [ ] Single-select questions allow only one option selected
- [ ] Multi-select questions allow multiple options toggled
- [ ] "Other" option shows text input when selected
- [ ] Keyboard navigation works (Arrow keys, Enter, Escape)
- [ ] Inactive state shows compact summary of answers
- [ ] Component registered in renderer registry
- [ ] Props interface extended with question callbacks
- [ ] `bun run --filter=@cockpit/dashboard check` passes
## Done summary
TBD

## Evidence
- Commits:
- Tests:
- PRs:
