# fn-4.2 Implement Progressive Text Streaming

## Description

Implement progressive text streaming so assistant messages appear character-by-character instead of all at once.

### Current State
- SSE handler in `realtime.svelte.ts:647-920` receives `stream_event` messages
- These contain `RawMessageStreamEvent` with `content_block_delta` events
- Currently only sets `isStreaming: true` but doesn't accumulate/render partial text

### Target State
- Text streams progressively as deltas arrive
- Streaming message shows partial content with cursor/typing indicator
- When streaming completes, final message replaces streaming message

### Implementation Details

```typescript
// In realtime.svelte.ts, add streaming message state
export interface StreamingMessage {
  instanceId: string;
  contentBlocks: Map<number, string>; // index -> accumulated text
  isComplete: boolean;
}

// Update SSE handler for stream_event
if (sdkMessage.type === 'stream_event') {
  const event = sdkMessage.event;

  if (event.type === 'content_block_start') {
    // Initialize new content block
    initStreamingBlock(instanceId, event.index, event.content_block);
  }

  if (event.type === 'content_block_delta') {
    if (event.delta.type === 'text_delta') {
      // Append text to streaming message
      appendStreamingText(instanceId, event.index, event.delta.text);
    }
  }

  if (event.type === 'content_block_stop') {
    // Finalize content block
    finalizeStreamingBlock(instanceId, event.index);
  }

  if (event.type === 'message_stop') {
    // Complete streaming, convert to final message
    finalizeStreamingMessage(instanceId);
  }
}
```

### Files to Modify
- `apps/dashboard/src/lib/stores/realtime.svelte.ts` - Add streaming message state and handlers
- `apps/dashboard/src/lib/components/workspace/WorkspaceInstance.svelte` - Render streaming message

### UX Considerations
- Show typing cursor at end of streaming text
- Smooth transition when streaming completes
- Handle rapid updates efficiently (batch if needed)
- Don't flicker on fast connections
## Acceptance

- [ ] `content_block_delta` events accumulate text progressively
- [ ] Streaming text visible in UI as it arrives (not all at once)
- [ ] Typing indicator (cursor or dots) shown during streaming
- [ ] Smooth transition when streaming completes to final message
- [ ] No duplicate messages when streaming finishes
- [ ] Performance acceptable (no jank on rapid updates)
- [ ] Works correctly when user scrolls during streaming
## Done summary
TBD

## Evidence
- Commits:
- Tests:
- PRs:
