# fn-7.3 Extract sdk:message handler into modular service

## Description

Extract the 296-line `sdk:message` handler from `realtime.svelte.ts` into a dedicated, modular service. This is the most complex SSE event and needs careful extraction.

## Current Location

`apps/dashboard/src/lib/stores/realtime.svelte.ts` lines 1385-1681

## Responsibilities of sdk:message Handler

1. **Message Type Detection** - Determine if user, assistant, system, tool_use, tool_result, result/error, etc.
2. **Streaming State** - Update `isStreaming`, manage progressive text accumulation
3. **Tool Invocation Tracking** - Handle tool_use and tool_result correlation
4. **Subagent Routing** - Route messages with `parentToolUseId` to SubagentBranch
5. **Message Storage** - Add parsed messages to instance message store
6. **User UUID Tracking** - Match user messages to their SDK UUIDs

## Steps

### 1. Create Message Handler Service

Create `apps/dashboard/src/lib/stores/message-handler.svelte.ts`:

```typescript
import { instances } from './instances.svelte';
import type { SdkMessageEvent } from './sse-events';

class MessageHandler {
  /**
   * Process an sdk:message event and route to appropriate stores
   */
  process(data: SdkMessageEvent): void {
    const { instanceId, sdkType, sdkSubtype, parentToolUseId, textContent, toolInvocations, toolResults, message } = data;

    // Route subagent messages
    if (parentToolUseId) {
      this.#handleSubagentMessage(instanceId, parentToolUseId, data);
      return;
    }

    // Handle by SDK message type
    switch (sdkType) {
      case 'user':
        this.#handleUserMessage(instanceId, data);
        break;
      case 'assistant':
        this.#handleAssistantMessage(instanceId, data);
        break;
      case 'system':
        this.#handleSystemMessage(instanceId, sdkSubtype, data);
        break;
      case 'result':
        this.#handleResultMessage(instanceId, sdkSubtype, data);
        break;
    }
  }

  #handleUserMessage(instanceId: string, data: SdkMessageEvent): void {
    // Update UUID on existing optimistic message or add new
  }

  #handleAssistantMessage(instanceId: string, data: SdkMessageEvent): void {
    // Handle text content and tool invocations
  }

  #handleSystemMessage(instanceId: string, subtype: string | undefined, data: SdkMessageEvent): void {
    // Handle init, mcp_status, thinking, etc.
  }

  #handleResultMessage(instanceId: string, subtype: string | undefined, data: SdkMessageEvent): void {
    // Handle success, error with various subtypes
  }

  #handleSubagentMessage(instanceId: string, parentToolUseId: string, data: SdkMessageEvent): void {
    // Route to subagent state
  }

  #handleStreamEvent(instanceId: string, data: SdkMessageEvent): void {
    // Handle content_block_start, content_block_delta, message_stop
  }
}

export const messageHandler = new MessageHandler();
```

### 2. Handle Tool Invocations

Extract tool invocation logic:
- Parse `toolInvocations` array from pre-extracted data
- Track pending tool results
- Match tool_result to tool_use by ID

### 3. Handle Streaming Events

Extract streaming logic:
- `content_block_start` - Initialize streaming message
- `content_block_delta` - Append text to block
- `content_block_stop` - Finalize block
- `message_stop` - Finalize message, move to store

### 4. Handle Subagent Messages

Extract subagent routing:
- Check for `parentToolUseId`
- Route to `instances.addSubagentMessage()`
- Handle Task tool completion

## Acceptance

- [ ] `message-handler.svelte.ts` created with `process()` method
- [ ] All message types handled (user, assistant, system, result)
- [ ] Streaming events handled correctly
- [ ] Tool invocations tracked and correlated with results
- [ ] Subagent messages routed to SubagentBranch
- [ ] No changes to external behavior
- [ ] `bunx svelte-check` passes

## Done summary
## fn-7.3: Extract sdk:message handler into modular service

### Completed
Extracted the monolithic 296-line sdk:message handler from realtime.svelte.ts into a clean, modular service.

### New File Created
- `apps/dashboard/src/lib/stores/sdk-message-handler.ts` (~450 lines)

### Functions Extracted
1. `handleSdkMessage(event: SdkMessageEvent)` - Main entry point
2. `handleSubagentMessage()` - Routes subagent messages
3. `processToolResults()` - Handles tool result completion
4. `processAssistantMessage()` - Assistant text & tool invocations  
5. `processUserMessage()` - User message handling
6. `processSystemMessage()` - System message (init, compact, hook)
7. `processResultError()` - Error result messages
8. `processStreamEvent()` - Progressive text streaming

### Key Changes
- Works with new entity stores (instances.svelte.ts) instead of Svelte 4 writable stores
- Maintains backgroundAgentIdMap for linking TaskOutput results
- Fully typed with SdkMessageEvent from sse-events.ts
- Exported from store facade (index.svelte.ts)

### Files Modified
- `apps/dashboard/src/lib/stores/index.svelte.ts` (added export)
## Evidence
- Commits:
- Tests:
- PRs: