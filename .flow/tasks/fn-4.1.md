# fn-4.1 Create Message Renderer Registry Architecture

## Description

Create a message renderer registry that maps SDK message types/subtypes to dedicated renderer components. This refactors the monolithic `ChatMessage.svelte` (1129 lines) into smaller, focused components.

### Current State
- `ChatMessage.svelte` handles ALL message types in one file with conditional blocks
- Adding new message types requires modifying this large file
- Login, model picker, memory picker logic embedded inline

### Target State
- Create `apps/dashboard/src/lib/components/features/message-renderers/` directory
- Extract interactive renderers: `LoginPrompt.svelte`, `ModelPicker.svelte`, `MemoryPicker.svelte`
- Create registry in `index.ts` that matches messages to renderers by type/subtype
- `ChatMessage.svelte` becomes a router that delegates to registry

### Implementation Details

```typescript
// apps/dashboard/src/lib/components/features/message-renderers/types.ts
export interface MessageRendererProps {
  message: Message;
  instanceId: string;
  isActive?: boolean;
  // Callbacks passed through
  onLoginSubmit?: (code: string) => Promise<void>;
  onModelSelect?: (model: string) => Promise<void>;
  // ... etc
}

// apps/dashboard/src/lib/components/features/message-renderers/registry.ts
export function getRenderer(message: Message): typeof SvelteComponent | null {
  if (message.metadata?.subtype === 'login_prompt') return LoginPrompt;
  if (message.metadata?.subtype === 'model_picker') return ModelPicker;
  if (message.metadata?.subtype === 'memory_picker') return MemoryPicker;
  if (message.metadata?.subtype === 'compact_boundary') return CompactBoundary;
  if (message.type === 'help_menu') return HelpMenu;
  return null; // Fall back to default rendering in ChatMessage
}
```

### Files to Create
- `apps/dashboard/src/lib/components/features/message-renderers/types.ts`
- `apps/dashboard/src/lib/components/features/message-renderers/registry.ts`
- `apps/dashboard/src/lib/components/features/message-renderers/LoginPrompt.svelte`
- `apps/dashboard/src/lib/components/features/message-renderers/ModelPicker.svelte`
- `apps/dashboard/src/lib/components/features/message-renderers/MemoryPicker.svelte`
- `apps/dashboard/src/lib/components/features/message-renderers/CompactBoundary.svelte`
- `apps/dashboard/src/lib/components/features/message-renderers/index.ts`

### Files to Modify
- `apps/dashboard/src/lib/components/features/ChatMessage.svelte` - Use registry instead of inline rendering
- `apps/dashboard/src/lib/components/features/index.ts` - Export new components

### Reference
- Current login prompt: `ChatMessage.svelte:602-711`
- Current model picker: `ChatMessage.svelte:712-829`
- Current memory picker: `ChatMessage.svelte:830-1012`
## Acceptance

- [ ] `message-renderers/` directory created with registry pattern
- [ ] LoginPrompt, ModelPicker, MemoryPicker extracted as separate components
- [ ] Registry correctly routes messages to appropriate renderers
- [ ] ChatMessage.svelte uses registry for special message types
- [ ] All existing functionality preserved (login, model switch, memory edit still work)
- [ ] TypeScript compiles without errors
- [ ] File size of ChatMessage.svelte reduced by at least 400 lines
## Done summary
## Done Summary

- Created `message-renderers/` directory with registry pattern architecture
- Extracted LoginPrompt, ModelPicker, MemoryPicker, CompactBoundary as separate Svelte components
- Added types.ts (MessageRendererProps) and registry.ts (getRenderer function)
- Refactored ChatMessage.svelte to use registry - reduced from 1129 to 672 lines (457 line reduction)

### Why
- Enables adding new message type renderers without modifying ChatMessage.svelte
- Architecture supports future subagent visualization (fn-5) via parentToolUseId field
- Improves code maintainability and separation of concerns

### Verification
- `bun run build` succeeds with no TypeScript errors
- All existing message types still render correctly

### Follow-ups
- Add ThinkingBlock renderer (fn-4.3)
- Add ResultError subtype renderers (fn-4.4)
## Evidence
- Commits: 478773b248f9e2292c4c973f5514b7b46a6d2685
- Tests: bun run build
- PRs: