/**
 * Message field extractor for normalizing SDK messages into relational columns.
 * Extracts nested fields from SDK message JSON for efficient database queries.
 */

import type { SdkMessageType, ToolInvocationStatus } from '@agentdeck/db';

/**
 * Raw SDK message structure (from Claude SDK)
 */
export interface SdkMessage {
  type?: string;
  uuid?: string;
  session_id?: string;
  parent_tool_use_id?: string | null;
  message?: {
    role?: 'user' | 'assistant';
    model?: string;
    content?: unknown[];
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
    };
  };
  tool_use_result?: {
    filenames?: string[];
    durationMs?: number;
    numFiles?: number;
    truncated?: boolean;
    // Background agent fields
    isAsync?: boolean;
    status?: string;
    agentId?: string;
    description?: string;
  };
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
  total_cost_usd?: number;
}

/**
 * Content block types from SDK
 */
interface TextBlock {
  type: 'text';
  text: string;
}

interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string | unknown[];
  is_error?: boolean;
}

type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock | { type: string };

/**
 * Extracted normalized fields for messages table
 */
export interface ExtractedMessageFields {
  sdkUuid: string | null;
  sdkType: SdkMessageType;
  sdkSubtype: string | null;
  parentToolUseId: string | null;
  role: 'user' | 'assistant' | null;
  textContent: string | null;
  rawContent: unknown;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
}

/**
 * Extracted fields for tool_invocations table
 */
export interface ExtractedToolInvocation {
  id: string;  // SDK's tool_use_id
  toolName: string;
  toolInput: Record<string, unknown> | null;
  subagentType: string | null;
  subagentDescription: string | null;
}

/**
 * Update data for tool_invocations when result arrives
 */
export interface ToolResultUpdate {
  toolUseId: string;
  toolResult: Record<string, unknown> | null;
  toolResultContent: string | null;
  status: ToolInvocationStatus;
  isError: boolean;
  durationMs: number | null;
  // Background agent fields (for Task tool with run_in_background: true)
  isBackgroundAgent?: boolean;
  backgroundAgentId?: string;
}

/**
 * Map SDK message type to our normalized type
 */
function mapSdkType(type: string | undefined): SdkMessageType {
  switch (type) {
    case 'user':
      return 'user';
    case 'assistant':
      return 'assistant';
    case 'system':
      return 'system';
    case 'result':
      return 'result';
    default:
      // For streaming events, map based on content
      return 'assistant';
  }
}

/**
 * Extract text content from message content blocks
 * Handles both array of content blocks and plain string content (for user messages)
 */
function extractTextContent(content: unknown): string | null {
  // Handle plain string content (common for user messages)
  if (typeof content === 'string') {
    return content || null;
  }

  // Handle array of content blocks
  if (!content || !Array.isArray(content)) return null;

  const textParts: string[] = [];
  for (const block of content) {
    // Handle string blocks in array
    if (typeof block === 'string') {
      textParts.push(block);
      continue;
    }
    if (typeof block === 'object' && block !== null && 'type' in block) {
      const typedBlock = block as ContentBlock;
      if (typedBlock.type === 'text' && 'text' in typedBlock) {
        textParts.push((typedBlock as TextBlock).text);
      }
    }
  }

  return textParts.length > 0 ? textParts.join('\n') : null;
}

/**
 * Extract normalized fields from an SDK message
 */
export function extractMessageFields(rawMessage: unknown): ExtractedMessageFields {
  const msg = rawMessage as SdkMessage;

  // Get usage from either top-level or nested message
  const usage = msg.usage || msg.message?.usage;
  const content = msg.message?.content as unknown[] | undefined;

  return {
    sdkUuid: msg.uuid || null,
    sdkType: mapSdkType(msg.type),
    sdkSubtype: null, // Could be 'init', 'compact_boundary', etc. - extract if needed
    parentToolUseId: msg.parent_tool_use_id || null,
    role: msg.message?.role || null,
    textContent: extractTextContent(content),
    rawContent: rawMessage,
    model: msg.message?.model || null,
    inputTokens: usage?.input_tokens || null,
    outputTokens: usage?.output_tokens || null,
    costUsd: msg.total_cost_usd || null,
  };
}

/**
 * Extract tool_use blocks from message content
 * Returns tool invocations to be inserted into tool_invocations table
 */
export function extractToolInvocations(rawMessage: unknown): ExtractedToolInvocation[] {
  const msg = rawMessage as SdkMessage;
  const content = msg.message?.content;

  if (!content || !Array.isArray(content)) return [];

  const invocations: ExtractedToolInvocation[] = [];

  for (const block of content) {
    if (typeof block !== 'object' || block === null || !('type' in block)) continue;

    const typedBlock = block as ContentBlock;
    if (typedBlock.type === 'tool_use') {
      const toolUse = typedBlock as ToolUseBlock;
      const input = toolUse.input || {};

      // Extract subagent info for Task tools
      let subagentType: string | null = null;
      let subagentDescription: string | null = null;

      if (toolUse.name === 'Task') {
        subagentType = (input.subagent_type as string) || null;
        subagentDescription = (input.description as string) || null;
      }

      invocations.push({
        id: toolUse.id,
        toolName: toolUse.name,
        toolInput: input,
        subagentType,
        subagentDescription,
      });
    }
  }

  return invocations;
}

/**
 * Extract tool_result updates from user messages
 * Returns updates to apply to existing tool_invocations
 */
export function extractToolResults(rawMessage: unknown): ToolResultUpdate[] {
  const msg = rawMessage as SdkMessage;
  const content = msg.message?.content;

  if (!content || !Array.isArray(content)) return [];

  const updates: ToolResultUpdate[] = [];
  const toolUseResult = msg.tool_use_result;

  for (const block of content) {
    if (typeof block !== 'object' || block === null || !('type' in block)) continue;

    const typedBlock = block as ContentBlock;
    if (typedBlock.type === 'tool_result') {
      const result = typedBlock as ToolResultBlock;

      // Extract result content as string
      let resultContent: string | null = null;
      if (typeof result.content === 'string') {
        resultContent = result.content;
      } else if (Array.isArray(result.content)) {
        // Handle array of content blocks
        const textParts: string[] = [];
        for (const item of result.content) {
          if (typeof item === 'string') {
            textParts.push(item);
          } else if (typeof item === 'object' && item !== null && 'text' in item) {
            textParts.push((item as { text: string }).text);
          }
        }
        resultContent = textParts.join('\n') || null;
      }

      updates.push({
        toolUseId: result.tool_use_id,
        toolResult: toolUseResult || null,
        toolResultContent: resultContent,
        status: result.is_error ? 'error' : 'success',
        isError: result.is_error || false,
        durationMs: toolUseResult?.durationMs || null,
        // Background agent fields from tool_use_result
        isBackgroundAgent: toolUseResult?.isAsync || false,
        backgroundAgentId: toolUseResult?.agentId,
      });
    }
  }

  return updates;
}

/**
 * Check if a message is a subagent message (belongs to a parent Task tool)
 */
export function isSubagentMessage(rawMessage: unknown): boolean {
  const msg = rawMessage as SdkMessage;
  return !!msg.parent_tool_use_id;
}
