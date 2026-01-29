/**
 * Canonical Message Handler Service
 *
 * Processes message:created and message:stream events from the hub.
 *
 * Subagents are derived automatically from messages in instances.svelte.ts.
 * This handler just routes messages to the store - no manual subagent sync needed.
 */

import type { MessageCreatedEvent, MessageStreamEvent } from '@agentdeck/core/dashboard';
import { instances } from './instances.svelte';
import type { Message } from './types';
import { toUiMessage } from '$lib/utils/message-mapper';

/**
 * Handle message:created events.
 */
export function handleMessageCreated(event: MessageCreatedEvent): void {
  const { instanceId, message } = event;
  instances.recordActivityEvent(event);

  if (message.type === 'system.init') {
    const meta = message.metadata as { model?: string } | null;
    if (meta?.model) {
      instances.updateModel(instanceId, meta.model);
    }
    instances.updateStreamingState(instanceId, { isInitializing: true });
    return;
  }

  if (message.type === 'system.status') {
    const meta = message.metadata as { status?: string | null } | null;
    instances.setStatus(instanceId, meta?.status || null);
    return;
  }

  if (message.type.startsWith('result.')) {
    instances.updateStreamingState(instanceId, { isStreaming: false, isInitializing: false });
  }

  if (message.type !== 'user' && message.type !== 'system.init' && message.type !== 'system.status') {
    instances.updateStreamingState(instanceId, { isInitializing: false });
  }

  const uiMessage = toUiMessage(instanceId, message);

  // Handle user messages - try to update existing message with sdkUuid first
  if (uiMessage.type === 'user') {
    const updated = uiMessage.sdkUuid && instances.updateUserMessageUuid(instanceId, uiMessage.content, uiMessage.sdkUuid);
    if (!updated) {
      instances.addMessage(instanceId, uiMessage);
    }
    return;
  }

  // Handle tool results - update the corresponding tool.use message
  if (uiMessage.type === 'tool.result') {
    const toolId = uiMessage.metadata?.toolId as string | undefined;
    if (toolId) {
      const toolResult = uiMessage.metadata?.toolResult;
      const toolStatus = uiMessage.metadata?.toolStatus as 'pending' | 'success' | 'error' | undefined;
      const isError = toolStatus === 'error';

      if (uiMessage.parentToolUseId) {
        // Update tool result within a subagent's messages (will be re-derived)
        instances.updateToolResult(instanceId, toolId, toolResult, isError);
      } else {
        instances.updateToolResult(instanceId, toolId, toolResult, isError);
      }
    }
    return;
  }

  // Skip result.success messages (no-op)
  if (uiMessage.type === 'result.success') {
    return;
  }

  // Handle result.error - only add to main messages if not in a subagent
  if (uiMessage.type === 'result.error') {
    if (!uiMessage.parentToolUseId) {
      instances.addMessage(instanceId, uiMessage);
    }
    return;
  }

  // Skip tool.progress messages
  if (uiMessage.type === 'tool.progress') {
    return;
  }

  // Add all other messages to the store
  // Subagents are derived automatically from Task tool.use messages
  instances.addMessage(instanceId, uiMessage);

  // Clear streaming message if this assistant message matches
  if (uiMessage.type === 'assistant' && uiMessage.sdkUuid) {
    const streaming = instances.getStreamingMessage(instanceId);
    if (streaming?.sdkUuid === uiMessage.sdkUuid) {
      instances.clearStreamingMessage(instanceId);
    }
  }
}

/**
 * Handle message:stream events for incremental text rendering.
 */
export function handleMessageStream(event: MessageStreamEvent): void {
  const { instanceId, sdkUuid, event: stream } = event;
  instances.recordActivityEvent(event);

  switch (stream.type) {
    case 'message_start':
      instances.updateStreamingState(instanceId, { isStreaming: true });
      instances.initStreamingMessage(instanceId, sdkUuid ?? undefined);
      break;

    case 'content_block_start':
      if (typeof stream.index === 'number' && stream.content_block) {
        instances.updateStreamingState(instanceId, { isStreaming: true });
        instances.initStreamingMessage(instanceId, sdkUuid ?? undefined);
        instances.initStreamingBlock(instanceId, stream.index, stream.content_block as { type: string });
      }
      break;

    case 'content_block_delta':
      if (
        typeof stream.index === 'number' &&
        stream.delta &&
        (stream.delta as { type?: string; text?: string }).type === 'text_delta'
      ) {
        const text = (stream.delta as { text?: string }).text;
        if (text) {
          instances.appendStreamingText(instanceId, stream.index, text);
        }
      }
      break;

    case 'content_block_stop':
      if (typeof stream.index === 'number') {
        instances.finalizeStreamingBlock(instanceId, stream.index);
      }
      break;

    case 'message_stop':
      instances.updateStreamingState(instanceId, { isStreaming: false, isInitializing: false });
      break;
  }
}
