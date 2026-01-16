/**
 * SDK Message Handler Service
 *
 * Modular service for processing sdk:message WebSocket events.
 * Extracts the 296-line monolithic handler from realtime.svelte.ts
 * into a clean, testable service that works with entity stores.
 */

import type { SdkMessageEvent, ExtractedToolInvocation, ExtractedToolResult } from '@cockpit/core/dashboard';
import { instances } from './instances.svelte';
import type { Message } from './types';

/**
 * Handle a subagent message (message with parent_tool_use_id).
 * Routes the message to the appropriate SubagentState for display.
 */
function handleSubagentMessage(
  instanceId: string,
  parentToolUseId: string,
  msg: {
    type?: string;
    message?: { content?: unknown[] | string };
  }
): void {
  // Ensure subagent exists (may arrive before Task tool_use message due to race condition)
  if (!instances.getSubagent(parentToolUseId)) {
    instances.startSubagent(parentToolUseId, instanceId, 'unknown', 'Subagent');
  }
  // Mark subagent as running
  instances.setSubagentRunning(parentToolUseId);

  // Create message to add to subagent
  if (msg.type === 'assistant' && msg.message?.content) {
    const content = msg.message.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block && typeof block === 'object' && 'type' in block) {
          // Tool use within subagent
          if (block.type === 'tool_use') {
            const toolBlock = block as { id?: string; name?: string; input?: unknown };
            const subagentMessage: Message = {
              id: `subagent-${parentToolUseId}-${toolBlock.id}`,
              instanceId,
              type: 'tool_use',
              content: toolBlock.name || 'Tool',
              timestamp: new Date(),
              parentToolUseId,
              metadata: {
                toolId: toolBlock.id,
                toolName: toolBlock.name,
                toolInput: toolBlock.input,
                toolStatus: 'pending',
              },
            };
            instances.addSubagentMessage(parentToolUseId, subagentMessage);
          }
          // Text response within subagent (less common, usually just tool use)
          else if (block.type === 'text' && 'text' in block) {
            const subagentMessage: Message = {
              id: `subagent-${parentToolUseId}-text-${Date.now()}`,
              instanceId,
              type: 'assistant',
              content: block.text as string,
              timestamp: new Date(),
              parentToolUseId,
            };
            instances.addSubagentMessage(parentToolUseId, subagentMessage);
          }
        }
      }
    }
  }

  // Handle tool results within subagent (update the tool_use message status)
  if (msg.type === 'user' && msg.message?.content) {
    const content = msg.message.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block && typeof block === 'object' && 'type' in block && block.type === 'tool_result') {
          const toolResult = block as {
            tool_use_id?: string;
            content?: unknown;
            is_error?: boolean;
          };
          if (toolResult.tool_use_id) {
            // Update the tool_use message in the subagent with its result
            instances.updateSubagentToolResult(
              parentToolUseId,
              toolResult.tool_use_id,
              toolResult.content,
              toolResult.is_error ?? false
            );
          }
        }
      }
    }
  }

  // Handle result messages (subagent completion)
  // When a subagent finishes, Claude sends a 'result' type message with parent_tool_use_id
  if (msg.type === 'result') {
    const resultMsg = msg as { result?: string; is_error?: boolean };
    if (resultMsg.is_error) {
      instances.errorSubagent(parentToolUseId, resultMsg.result || 'Unknown error');
    } else {
      instances.completeSubagent(parentToolUseId, resultMsg.result || '');
    }
  }
}

/**
 * Background agent ID mapping - maps SDK internal agentId to toolUseId
 * Used to link TaskOutput results back to their parent Task tool
 */
const backgroundAgentIdMap = new Map<string, string>();

/**
 * Process tool results from pre-extracted data.
 * Handles completing subagents, background agents, and TaskOutput results.
 */
function processToolResults(
  instanceId: string,
  toolResults: ExtractedToolResult[]
): void {
  for (const result of toolResults) {
    instances.updateToolResult(
      instanceId,
      result.toolUseId,
      result.toolResultContent,
      result.isError
    );

    const resultContent = result.toolResultContent || '';

    // Check if this is a background Task spawn (has isBackgroundAgent and backgroundAgentId)
    if (result.isBackgroundAgent && result.backgroundAgentId) {
      const agentId = result.backgroundAgentId;
      backgroundAgentIdMap.set(agentId, result.toolUseId);
      // Mark this subagent as background so completeSubagent knows to parse its output
      instances.markSubagentBackground(result.toolUseId);
      // Don't complete the subagent yet - wait for TaskOutput result
      continue;
    }

    // Check if this is a TaskOutput result (contains <task_id> and <output> XML tags)
    const taskIdMatch = resultContent.match(/<task_id>([a-f0-9]+)<\/task_id>/i);
    const outputMatch = resultContent.match(/<output>([\s\S]*?)<\/output>/i);
    if (taskIdMatch && outputMatch) {
      const taskId = taskIdMatch[1];
      const output = outputMatch[1].trim();
      const originalToolUseId = backgroundAgentIdMap.get(taskId);
      if (originalToolUseId) {
        const subagent = instances.getSubagent(originalToolUseId);
        if (subagent) {
          const isError = resultContent.includes('<status>error</status>');
          if (isError) {
            instances.errorSubagent(originalToolUseId, output);
          } else {
            instances.completeSubagent(originalToolUseId, output);
          }
        }
        backgroundAgentIdMap.delete(taskId);
      }
      continue;
    }

    // Complete subagent if this toolUseId has a registered subagent (blocking agent)
    const subagent = instances.getSubagent(result.toolUseId);
    if (subagent) {
      if (result.isError) {
        instances.errorSubagent(result.toolUseId, resultContent);
      } else {
        instances.completeSubagent(result.toolUseId, resultContent);
      }
    }
  }
}

/**
 * Process assistant message content - text and tool invocations.
 */
function processAssistantMessage(
  instanceId: string,
  sdkUuid: string | undefined,
  textContent: string | null | undefined,
  toolInvocations: ExtractedToolInvocation[] | undefined,
  rawContent: unknown[] | undefined
): void {
  // Check if we already have a message with this UUID (from streaming)
  // to avoid duplicates when streaming is enabled
  const existingMessages = instances.getMessages(instanceId);
  const hasExistingMessage = sdkUuid && existingMessages.some(m => m.sdkUuid === sdkUuid);

  // Add text content as assistant message
  if (textContent && !hasExistingMessage) {
    instances.addMessage(instanceId, {
      type: 'assistant',
      content: textContent,
      timestamp: new Date(),
      sdkUuid,
    });
  }

  // Process tool invocations
  if (toolInvocations && toolInvocations.length > 0) {
    for (const tool of toolInvocations) {
      instances.addMessage(instanceId, {
        type: 'tool_use',
        content: tool.toolName || 'Tool',
        timestamp: new Date(),
        metadata: {
          toolId: tool.id,
          toolName: tool.toolName,
          toolInput: tool.toolInput,
          toolStatus: 'pending',
          subagentType: tool.subagentType ?? undefined,
          subagentDescription: tool.subagentDescription ?? undefined,
        },
      });

      // Start or update subagent tracking for Task tools
      if (tool.toolName === 'Task' && tool.id && tool.subagentType) {
        const existing = instances.getSubagent(tool.id);
        if (existing) {
          // Update existing subagent with proper type/description (may have been created early due to race)
          instances.updateSubagentInfo(tool.id, tool.subagentType, tool.subagentDescription ?? undefined);
        } else {
          instances.startSubagent(tool.id, instanceId, tool.subagentType, tool.subagentDescription ?? undefined);
        }
      }
    }
  }

  // Handle thinking blocks from raw content (not yet pre-extracted)
  if (rawContent && Array.isArray(rawContent)) {
    for (const block of rawContent) {
      if (block && typeof block === 'object' && 'type' in block) {
        // Thinking blocks -> thinking message with metadata
        if (block.type === 'thinking') {
          const thinkingBlock = block as { thinking?: string; signature?: string };
          instances.addMessage(instanceId, {
            type: 'thinking',
            content: thinkingBlock.thinking || '',
            timestamp: new Date(),
            metadata: {
              thinking: thinkingBlock.thinking,
              thinkingSignature: thinkingBlock.signature,
              isRedactedThinking: false,
            },
          });
        }
        // Redacted thinking blocks
        else if (block.type === 'redacted_thinking') {
          instances.addMessage(instanceId, {
            type: 'thinking',
            content: 'Reasoning redacted',
            timestamp: new Date(),
            metadata: {
              isRedactedThinking: true,
            },
          });
        }
      }
    }
  }
}

/**
 * Process user message content.
 */
function processUserMessage(
  instanceId: string,
  sdkUuid: string | undefined,
  textContent: string | null | undefined,
  rawMsg: { isSynthetic?: boolean; tool_use_result?: unknown; message?: { content?: unknown } }
): void {
  // Handle synthetic messages with tool_use_result (local commands like /cost, /help)
  if (rawMsg.isSynthetic && rawMsg.tool_use_result) {
    const resultText = typeof rawMsg.tool_use_result === 'string'
      ? rawMsg.tool_use_result
      : JSON.stringify(rawMsg.tool_use_result, null, 2);
    if (resultText.trim()) {
      instances.addMessage(instanceId, {
        type: 'assistant',
        content: resultText.trim(),
        timestamp: new Date(),
      });
    }
    return;
  }

  // Use pre-extracted textContent, or fallback to parsing
  let effectiveTextContent = textContent;
  if (!effectiveTextContent && rawMsg.message?.content) {
    const content = rawMsg.message.content;
    if (typeof content === 'string') {
      effectiveTextContent = content;
    } else if (Array.isArray(content)) {
      const parts: string[] = [];
      for (const block of content) {
        if (block && typeof block === 'object' && 'type' in block) {
          if (block.type === 'text' && 'text' in block) {
            parts.push(block.text as string);
          }
        }
      }
      effectiveTextContent = parts.join('');
    }
  }

  if (effectiveTextContent?.trim()) {
    // Try to update an existing optimistic message with UUID first
    // This prevents duplicates when we've added the message optimistically
    const updated = sdkUuid && instances.updateUserMessageUuid(instanceId, effectiveTextContent.trim(), sdkUuid);

    // Only add if no optimistic message was found to update
    if (!updated) {
      instances.addMessage(instanceId, {
        type: 'user',
        content: effectiveTextContent.trim(),
        timestamp: new Date(),
        sdkUuid, // Store SDK UUID for resumeSessionAt
      });
    }
  }
}

/**
 * Process system message content.
 */
function processSystemMessage(
  instanceId: string,
  subtype: string | undefined,
  rawMsg: Record<string, unknown>
): void {
  switch (subtype) {
    case 'init': {
      // No chat message needed - ActivityGrid provides visual feedback
      // Set initializing state for ActivityGrid 'thinking' animation
      const initMsg = rawMsg as {
        model?: string;
        session_id?: string;
        cwd?: string;
        tools?: string[];
        mcp_servers?: Array<{ name: string; status: string }>;
      };
      // Update instance model if provided
      if (initMsg.model) {
        instances.updateModel(instanceId, initMsg.model);
      }
      // Trigger 'thinking' state in ActivityGrid - Claude is ready, about to respond
      instances.updateStreamingState(instanceId, { isInitializing: true });
      break;
    }

    case 'compact_boundary':
      instances.addMessage(instanceId, {
        type: 'system',
        content: 'Context compacted',
        timestamp: new Date(),
        metadata: {
          subtype: 'compact_boundary',
          preTokens: (rawMsg as { pre_tokens?: number }).pre_tokens,
          trigger: (rawMsg as { trigger?: 'manual' | 'auto' }).trigger,
        },
      });
      break;

    case 'status':
      // Transient - use status store, not messages
      instances.setStatus(instanceId, (rawMsg as { status?: string | null }).status || null);
      break;

    case 'hook_response': {
      const hookMsg = rawMsg as {
        hook_name?: string;
        exit_code?: number;
        stdout?: string;
        stderr?: string;
      };
      instances.addMessage(instanceId, {
        type: 'hook_response',
        content: hookMsg.hook_name || 'Hook',
        timestamp: new Date(),
        metadata: {
          subtype: 'hook_response',
          hookName: hookMsg.hook_name,
          exitCode: hookMsg.exit_code,
          stdout: hookMsg.stdout,
          stderr: hookMsg.stderr,
        },
      });
      break;
    }
  }
}

/**
 * Process result error messages.
 */
function processResultError(
  instanceId: string,
  subtype: string,
  rawMsg: Record<string, unknown>
): void {
  const errorSubtypes = ['error_max_turns', 'error_during_execution', 'error_max_budget_usd', 'error_max_structured_output_retries'];

  if (errorSubtypes.includes(subtype)) {
    const resultMsg = rawMsg as {
      subtype: string;
      result?: string;
      errors?: string[];
      total_cost_usd?: number;
      num_turns?: number;
    };

    instances.addMessage(instanceId, {
      type: 'result_error',
      content: resultMsg.result || subtype,
      timestamp: new Date(),
      metadata: {
        resultSubtype: subtype as 'error_max_turns' | 'error_during_execution' | 'error_max_budget_usd' | 'error_max_structured_output_retries',
        resultErrors: resultMsg.errors,
        totalCost: resultMsg.total_cost_usd,
        numTurns: resultMsg.num_turns,
      },
    });
    instances.updateStreamingState(instanceId, { isStreaming: false });
  }
}

/**
 * Process stream events (progressive text streaming).
 */
function processStreamEvent(
  instanceId: string,
  sdkUuid: string | undefined,
  event: {
    type?: string;
    index?: number;
    content_block?: { type: string };
    delta?: { type: string; text?: string };
  }
): void {
  switch (event.type) {
    case 'message_start':
      instances.initStreamingMessage(instanceId, sdkUuid);
      break;

    case 'content_block_start':
      if (event.index !== undefined && event.content_block) {
        instances.initStreamingMessage(instanceId, sdkUuid);
        instances.initStreamingBlock(instanceId, event.index, event.content_block);
      }
      break;

    case 'content_block_delta':
      if (event.index !== undefined && event.delta?.type === 'text_delta' && event.delta.text) {
        instances.appendStreamingText(instanceId, event.index, event.delta.text);
      }
      break;

    case 'content_block_stop':
      if (event.index !== undefined) {
        instances.finalizeStreamingBlock(instanceId, event.index);
      }
      break;

    case 'message_stop':
      instances.finalizeStreamingMessage(instanceId);
      instances.updateStreamingState(instanceId, { isStreaming: false });
      break;
  }
}

/**
 * Main SDK message handler.
 * Processes sdk:message WebSocket events and routes to appropriate entity stores.
 *
 * @param event - The typed SdkMessageEvent from WebSocket
 */
export function handleSdkMessage(event: SdkMessageEvent): void {
  const {
    instanceId,
    message,
    sdkUuid,
    sdkType,
    sdkSubtype,
    parentToolUseId,
    textContent,
    toolInvocations,
    toolResults,
  } = event;

  // For backwards compat, also parse raw message for fields not yet extracted
  const rawMsg = message as {
    type?: string;
    subtype?: string;
    uuid?: string;
    message?: { content?: unknown[] | string; role?: string };
    result?: string;
    isSynthetic?: boolean;
    isReplay?: boolean;
    tool_use_result?: unknown;
    event?: { type?: string; index?: number; content_block?: { type: string }; delta?: { type: string; text?: string } };
    session_id?: string;
    cwd?: string;
    model?: string;
    tools?: string[];
    parent_tool_use_id?: string | null;
  };

  // Use pre-extracted parentToolUseId (falls back to msg.parent_tool_use_id)
  const effectiveParentToolUseId = parentToolUseId ?? rawMsg.parent_tool_use_id;

  // ========================================
  // SUBAGENT MESSAGE ROUTING
  // ========================================
  // Messages with parent_tool_use_id belong to a subagent, not main chat
  if (effectiveParentToolUseId) {
    handleSubagentMessage(instanceId, effectiveParentToolUseId, rawMsg);
    return;
  }

  // Handle replay messages specially
  if (rawMsg.isReplay && rawMsg.type === 'user') {
    // Check if this is a local command output (wrapped in <local-command-stdout> tags)
    const content = rawMsg.message?.content;
    if (typeof content === 'string' && content.includes('<local-command-stdout>')) {
      const match = content.match(/<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/);
      if (match && match[1]?.trim()) {
        instances.addMessage(instanceId, {
          type: 'assistant',
          content: match[1].trim(),
          timestamp: new Date(),
        });
      }
    } else if (rawMsg.uuid) {
      // Try to update an optimistic user message with the UUID from replay
      let replayTextContent = '';
      if (typeof content === 'string') {
        replayTextContent = content;
      } else if (Array.isArray(content)) {
        for (const block of content) {
          if (block && typeof block === 'object' && 'type' in block) {
            if (block.type === 'text' && 'text' in block) {
              replayTextContent += (block.text as string);
            }
          }
        }
      }
      if (replayTextContent.trim()) {
        instances.updateUserMessageUuid(instanceId, replayTextContent.trim(), rawMsg.uuid);
      }
    }
    // Skip adding replay messages to avoid duplicates (they come from SSR)
    return;
  }

  // Use pre-extracted sdkType where available, fallback to msg.type
  // Note: sdkType is normalized to 'user'|'assistant'|'system'|'result'
  // but raw msg.type can also be 'stream_event' which isn't in the normalized types
  const effectiveSdkType: string | undefined = sdkType ?? rawMsg.type;

  // ========================================
  // STREAMING STATE
  // ========================================

  // Mark as streaming when receiving assistant or stream_event messages
  if (effectiveSdkType === 'assistant' || effectiveSdkType === 'stream_event') {
    instances.updateStreamingState(instanceId, { isStreaming: true });
  }

  // Mark as not streaming when result received
  if (effectiveSdkType === 'result') {
    instances.updateStreamingState(instanceId, { isStreaming: false });
  }

  // ========================================
  // TOOL RESULTS (from pre-extracted data)
  // ========================================

  if (toolResults && toolResults.length > 0) {
    processToolResults(instanceId, toolResults);
    // Tool result messages are internal SDK messages, not user-visible
    return;
  }

  // ========================================
  // USER MESSAGES
  // ========================================

  if (effectiveSdkType === 'user') {
    processUserMessage(instanceId, sdkUuid, textContent, rawMsg);
    return;
  }

  // ========================================
  // ASSISTANT MESSAGES
  // ========================================

  if (effectiveSdkType === 'assistant') {
    const rawContent = rawMsg.message?.content;
    processAssistantMessage(
      instanceId,
      sdkUuid,
      textContent,
      toolInvocations,
      Array.isArray(rawContent) ? rawContent : undefined
    );
    return;
  }

  // ========================================
  // SYSTEM MESSAGES
  // ========================================

  if (effectiveSdkType === 'system') {
    processSystemMessage(instanceId, sdkSubtype ?? rawMsg.subtype, rawMsg);
    return;
  }

  // ========================================
  // RESULT MESSAGES (completion stats and errors)
  // ========================================

  if (effectiveSdkType === 'result' && (sdkSubtype || rawMsg.subtype)) {
    processResultError(instanceId, (sdkSubtype ?? rawMsg.subtype)!, rawMsg);
    return;
  }

  // ========================================
  // STREAM EVENTS (progressive text streaming)
  // ========================================

  if (effectiveSdkType === 'stream_event' && rawMsg.event) {
    processStreamEvent(instanceId, sdkUuid ?? rawMsg.uuid, rawMsg.event);
    return;
  }
}
