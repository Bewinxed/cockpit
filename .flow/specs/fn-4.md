# Epic: Restore & Extend Custom Message Types for Claude SDK

## Overview

Restore lost interactive message functionality and extend the chat system to handle ALL Claude SDK message types with proper UX/UI for each. The current implementation has most functionality in `WorkspaceInstance.svelte` and `ChatMessage.svelte`, but several SDK message types are not fully rendered, streaming is not progressive, and some interactive patterns are missing.

## Scope

### In Scope
- Progressive text streaming (character-by-character using `content_block_delta`)
- ThinkingBlock rendering (collapsible Claude reasoning)
- Result error subtypes with specific UX (`error_max_turns`, `error_during_execution`, `error_max_budget_usd`, `error_max_structured_output_retries`)
- MCP server status display from init message
- Permission denial history display
- Synthetic message visual distinction
- Message type registry for extensible rendering

### Out of Scope
- Multi-model usage breakdown display (nice-to-have)
- Hook event grouping (nice-to-have)
- `/terminal-setup` and `/vim` actual functionality (these just show info messages)
- **Subagent tree visualization** (separate epic fn-5, but architecture MUST support it)

## ⚠️ CRITICAL: Design for Subagent Support

**fn-5 depends on this epic.** The message renderer registry and data model MUST support:

1. **`parentToolUseId` tracking** - Messages from subagents have this field linking to the Task tool_use
2. **Nested message trees** - Registry should allow grouping messages by parent
3. **Live updates** - Streaming architecture must handle messages from multiple concurrent subagents
4. **Extensible renderers** - SubagentBranch component will be added in fn-5

When implementing fn-4.1 (registry), ensure:
```typescript
interface Message {
  // Add these fields
  parentToolUseId?: string;  // Links to Task tool_use that spawned this
  subagentType?: string;     // 'Explore', 'Plan', 'Bash', etc.
}
```

## Architecture

### Message Type Registry Pattern

Create a registry that maps SDK message types/subtypes to renderer components:

```typescript
// apps/dashboard/src/lib/components/features/message-renderers/index.ts
type MessageRenderer = {
  component: typeof SvelteComponent;
  match: (message: Message) => boolean;
  priority: number; // Higher = checked first
};

const messageRenderers: MessageRenderer[] = [
  { component: LoginPrompt, match: (m) => m.metadata?.subtype === 'login_prompt', priority: 100 },
  { component: ModelPicker, match: (m) => m.metadata?.subtype === 'model_picker', priority: 100 },
  { component: MemoryPicker, match: (m) => m.metadata?.subtype === 'memory_picker', priority: 100 },
  { component: ThinkingBlock, match: (m) => m.metadata?.hasThinking, priority: 90 },
  { component: ResultError, match: (m) => m.type === 'system' && m.metadata?.resultError, priority: 90 },
  { component: CompactBoundary, match: (m) => m.metadata?.subtype === 'compact_boundary', priority: 80 },
  // ... fallback to default ChatMessage
];
```

### Streaming Text Architecture

Update SSE handler in `realtime.svelte.ts` to accumulate `content_block_delta` text:

```typescript
// In sdk:message handler
if (sdkMessage.type === 'stream_event') {
  const event = sdkMessage.event;
  if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
    // Accumulate text into streaming message
    appendStreamingText(instanceId, event.index, event.delta.text);
  }
}
```

## Reference Implementation (Commit 78a93e9)

The reference commit added:
- `ChatMessage.svelte:602-711` - Login prompt interactive component
- `ChatMessage.svelte:712-829` - Model picker with keyboard navigation
- `ChatMessage.svelte:830-1012` - Memory picker with selection + editor phases
- `ChatMessage.svelte:226-244` - Derived checks for special message types
- `WorkspaceInstance.svelte:365-504` - Client command handling

These exist in current code but need:
1. **Progressive streaming** - Currently text appears all at once
2. **New message types** - ThinkingBlock, ResultError subtypes, MCP status
3. **Better architecture** - Extract renderers into separate components

## Reusable Code

**DO NOT DUPLICATE - use existing:**
- `addMessage()` - `realtime.svelte.ts:157-171`
- `updateMessageMetadata()` - `realtime.svelte.ts:216-232`
- `DiffView` - `features/DiffView.svelte`
- `ToolGroup` - `features/ToolGroup.svelte`
- `CommandPalette` - `features/CommandPalette.svelte`
- `HelpMenu` - `features/HelpMenu.svelte`

## Quick Commands

```bash
# Smoke test after implementation
bun run dev:dashboard
# Open browser, create instance, test:
# 1. Send a message - should see streaming text
# 2. /model - should show model picker
# 3. /memory - should show memory picker
# 4. /login - should show OAuth flow
# 5. /help - should show help menu
```

## Acceptance Criteria

- [ ] Text streams progressively (character-by-character) instead of appearing all at once
- [ ] ThinkingBlock renders collapsible when present in assistant messages
- [ ] Error result subtypes show specific error UI with recovery options
- [ ] MCP server status visible in system init message
- [ ] All existing interactive messages (login, model, memory picker) work in tab-based workspace
- [ ] Message type registry allows adding new renderers without modifying ChatMessage.svelte
- [ ] No TypeScript errors (`bun run build` succeeds)

## References

- Current ChatMessage: `apps/dashboard/src/lib/components/features/ChatMessage.svelte` (1129 lines)
- Current WorkspaceInstance: `apps/dashboard/src/lib/components/workspace/WorkspaceInstance.svelte` (1034 lines)
- Message types: `apps/dashboard/src/lib/stores/realtime.svelte.ts:53-103`
- SSE handler: `apps/dashboard/src/lib/stores/realtime.svelte.ts:647-920`
- SDK types: `@anthropic-ai/claude-code` SDK at version 1.0.128
- Reference commit: `78a93e9616b7e5924d35a4cffbc0d6fae83d13a7`
