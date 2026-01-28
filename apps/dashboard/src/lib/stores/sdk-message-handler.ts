/**
 * Canonical Message Handler Service
 *
 * Processes message:created and message:stream events from the hub.
 */

import type { MessageCreatedEvent, MessageStreamEvent } from '@agentdeck/core/dashboard';
import { instances } from './instances.svelte';
import type { Message, MessageMetadata } from './types';
import { toUiMessage } from '$lib/utils/message-mapper';

function extractToolResultText(content: unknown): string | undefined {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const parts = content
      .map((block) => {
        if (typeof block === 'string') return block;
        if (block && typeof block === 'object' && 'type' in block) {
          const typed = block as { type: string; text?: string };
          if (typed.type === 'text' && typed.text) return typed.text;
        }
        return '';
      })
      .filter(Boolean);
    return parts.length ? parts.join('\n') : undefined;
  }
  if (content && typeof content === 'object') {
    return JSON.stringify(content);
  }
  return undefined;
}

function findToolUseMessage(instanceId: string, parentToolUseId: string | undefined, toolId: string): Message | undefined {
  if (parentToolUseId) {
    const subagent = instances.getSubagent(parentToolUseId);
    return subagent?.messages.find(
      (m) => m.type === 'tool.use' && m.metadata?.toolId === toolId
    );
  }
  return instances.getMessages(instanceId).find(
    (m) => m.type === 'tool.use' && m.metadata?.toolId === toolId
  );
}

function handleToolResult(instanceId: string, message: ReturnType<typeof toUiMessage>): void {
  const metadata = message.metadata as MessageMetadata | undefined;
  const toolId = metadata?.toolId as string | undefined;
  if (!toolId) return;

  const toolResult = metadata?.toolResult;
  const toolStatus = metadata?.toolStatus as 'pending' | 'success' | 'error' | undefined;
  const isError = toolStatus === 'error';

  if (message.parentToolUseId) {
    instances.updateSubagentToolResult(message.parentToolUseId, toolId, toolResult, isError);
  } else {
    instances.updateToolResult(instanceId, toolId, toolResult, isError);
  }

  const toolUseMessage = findToolUseMessage(instanceId, message.parentToolUseId, toolId);
  const toolName = toolUseMessage?.metadata?.toolName as string | undefined;

  if (toolName === 'Task') {
    const toolInput = toolUseMessage?.metadata?.toolInput as Record<string, unknown> | undefined;
    const resultPayload = toolResult as { isAsync?: boolean; agentId?: string } | undefined;
    const isBackground = toolInput?.run_in_background === true || resultPayload?.isAsync === true;
    const agentId = resultPayload?.agentId;

    if (isBackground && agentId) {
      instances.registerBackgroundAgent(agentId, toolId);
      instances.markSubagentBackground(toolId);
      return;
    }

    const resultText = extractToolResultText(toolResult);
    if (isError) {
      instances.errorSubagent(toolId, resultText || 'Unknown error');
    } else {
      instances.completeSubagent(toolId, resultText || '');
    }
    return;
  }

  if (toolName === 'TaskOutput') {
    const resultText = extractToolResultText(toolResult);
    if (!resultText) return;

    const taskIdMatch = resultText.match(/<task_id>([a-f0-9]+)<\/task_id>/i);
    const outputMatch = resultText.match(/<output>([\s\S]*?)<\/output>/i);
    if (!taskIdMatch || !outputMatch) return;

    const taskId = taskIdMatch[1];
    const output = outputMatch[1].trim();
    const originalToolUseId = instances.getToolUseIdFromAgentId(taskId);
    if (!originalToolUseId) return;

    const isTaskError = resultText.includes('<status>error</status>');
    if (isTaskError) {
      instances.errorSubagent(originalToolUseId, output || 'Unknown error');
    } else {
      instances.completeSubagent(originalToolUseId, output || '');
    }
  }
}

function handleSubagentMessage(instanceId: string, uiMessage: Message): void {
  const parentToolUseId = uiMessage.parentToolUseId as string;
  if (!instances.getSubagent(parentToolUseId)) {
    instances.startSubagent(parentToolUseId, instanceId, 'unknown', 'Subagent');
  }
  instances.setSubagentRunning(parentToolUseId);

  if (uiMessage.type === 'tool.use') {
    const toolId = uiMessage.metadata?.toolId as string | undefined;
    const toolName = uiMessage.metadata?.toolName as string | undefined;
    if (toolName === 'Task' && toolId) {
      const toolInput = uiMessage.metadata?.toolInput as Record<string, unknown> | undefined;
      const subagentType = (uiMessage.metadata?.subagentType as string) || (toolInput?.subagent_type as string) || 'unknown';
      const subagentDescription = (uiMessage.metadata?.subagentDescription as string) || (toolInput?.description as string | undefined);
      instances.startSubagent(toolId, instanceId, subagentType, subagentDescription, parentToolUseId);
    }
    instances.addSubagentMessage(parentToolUseId, uiMessage);
  } else if (uiMessage.type === 'tool.result') {
    handleToolResult(instanceId, uiMessage);
  } else if (uiMessage.type === 'result.success' || uiMessage.type === 'result.error') {
    const resultText = uiMessage.metadata?.result as string | undefined;
    if (uiMessage.type === 'result.error') {
      instances.errorSubagent(parentToolUseId, resultText || 'Unknown error');
    } else {
      instances.completeSubagent(parentToolUseId, resultText || '');
    }
  } else {
    instances.addSubagentMessage(parentToolUseId, uiMessage);
  }
}

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

  if (uiMessage.parentToolUseId) {
    handleSubagentMessage(instanceId, uiMessage);
    return;
  }

  if (uiMessage.type === 'user') {
    const updated = uiMessage.sdkUuid && instances.updateUserMessageUuid(instanceId, uiMessage.content, uiMessage.sdkUuid);
    if (!updated) {
      instances.addMessage(instanceId, uiMessage);
    }
    return;
  }

  if (uiMessage.type === 'tool.use') {
    const toolId = uiMessage.metadata?.toolId as string | undefined;
    const toolName = uiMessage.metadata?.toolName as string | undefined;
    if (toolName === 'Task' && toolId) {
      const toolInput = uiMessage.metadata?.toolInput as Record<string, unknown> | undefined;
      const subagentType = (uiMessage.metadata?.subagentType as string) || (toolInput?.subagent_type as string) || 'unknown';
      const subagentDescription = (uiMessage.metadata?.subagentDescription as string) || (toolInput?.description as string | undefined);
      instances.startSubagent(toolId, instanceId, subagentType, subagentDescription, uiMessage.parentToolUseId);
    }
    instances.addMessage(instanceId, uiMessage);
    return;
  }

  if (uiMessage.type === 'tool.result') {
    handleToolResult(instanceId, uiMessage);
    return;
  }

  if (uiMessage.type === 'result.success') {
    return;
  }

  if (uiMessage.type === 'result.error') {
    if (!uiMessage.parentToolUseId) {
      instances.addMessage(instanceId, uiMessage);
    }
    return;
  }

  if (uiMessage.type === 'tool.progress') {
    return;
  }

  instances.addMessage(instanceId, uiMessage);

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
