/**
 * Transform Message[] into svelte-flow Node[] and Edge[]
 * Handles grouping of consecutive tool messages and subagent spawning
 */

import type { Node, Edge } from '@xyflow/svelte';
import type { Message, SubagentState } from '$lib/stores/types';
import { NODE_TYPES } from '$lib/components/features/flow/nodes';

// Re-export MessageGroup type for use in components
export type MessageGroup =
  | { type: 'single'; message: Message; index: number }
  | { type: 'tool_group'; messages: Message[]; startIndex: number }
  | { type: 'subagent_group'; messages: Message[]; startIndex: number };

export interface FlowData {
  nodes: Node[];
  edges: Edge[];
}

// --- Message type detection helpers ---

/** Check if a message is a Task tool_use (subagent spawn) */
export function isTaskToolUse(msg: Message): boolean {
  return msg.type === 'tool_use' && !!msg.metadata?.subagentType;
}

/** Check if a message is a TaskOutput tool (retrieves subagent results) */
export function isTaskOutputTool(msg: Message): boolean {
  return msg.type === 'tool_use' && msg.metadata?.toolName === 'TaskOutput';
}

/** Check if a message belongs to a subagent (has parentToolUseId) */
export function isSubagentMessage(msg: Message): boolean {
  return !!msg.parentToolUseId;
}

// --- Grouping logic ---

/**
 * Filter messages for main chat flow (excludes subagent messages and TaskOutput)
 */
export function filterChatMessages(messages: Message[]): Message[] {
  return messages.filter(msg => !isTaskOutputTool(msg) && !isSubagentMessage(msg));
}

/**
 * Group consecutive tool messages for compact display
 * Task tools get grouped together for parallel display
 */
export function groupMessages(messages: Message[]): MessageGroup[] {
  const chatMessages = filterChatMessages(messages);
  const groups: MessageGroup[] = [];
  let i = 0;

  while (i < chatMessages.length) {
    const msg = chatMessages[i];

    // Task tool_use messages - group consecutive ones for parallel display
    if (isTaskToolUse(msg)) {
      const subagentMessages: Message[] = [msg];
      const startIndex = i;
      i++;

      // Collect consecutive Task tools (parallel agents)
      while (i < chatMessages.length && isTaskToolUse(chatMessages[i])) {
        subagentMessages.push(chatMessages[i]);
        i++;
      }

      groups.push({ type: 'subagent_group', messages: subagentMessages, startIndex });
    }
    // Regular tool messages get grouped together
    else if (msg.type === 'tool_use' || msg.type === 'tool_result') {
      const toolMessages: Message[] = [msg];
      const startIndex = i;
      i++;

      while (i < chatMessages.length) {
        const nextMsg = chatMessages[i];
        // Don't include Task or TaskOutput tools in regular tool groups
        if (
          (nextMsg.type === 'tool_use' || nextMsg.type === 'tool_result') &&
          !isTaskToolUse(nextMsg) &&
          !isTaskOutputTool(nextMsg)
        ) {
          toolMessages.push(nextMsg);
          i++;
        } else {
          break;
        }
      }

      groups.push({ type: 'tool_group', messages: toolMessages, startIndex });
    } else {
      groups.push({ type: 'single', message: msg, index: i });
      i++;
    }
  }

  return groups;
}

// --- Flow transformation ---

/**
 * Determine node type based on message group
 */
function getNodeType(group: MessageGroup): string {
  if (group.type === 'tool_group') return NODE_TYPES.TOOL;
  if (group.type === 'subagent_group') return NODE_TYPES.SUBAGENT;

  const msg = group.message;

  switch (msg.type) {
    case 'user':
      return NODE_TYPES.USER;
    case 'assistant':
    case 'thinking':
      return NODE_TYPES.ASSISTANT;
    case 'system':
    case 'hook_response':
    case 'command_output':
    case 'help_menu':
    case 'error':
    case 'result_error':
      return NODE_TYPES.SYSTEM;
    default:
      return NODE_TYPES.ASSISTANT;
  }
}

/**
 * Get a stable ID for a message group
 */
function getGroupId(group: MessageGroup): string {
  if (group.type === 'single') {
    return group.message.sdkUuid || group.message.id || `msg-${group.index}`;
  }
  const firstMsg = group.messages[0];
  return firstMsg.sdkUuid || firstMsg.id || firstMsg.metadata?.toolId || `group-${group.startIndex}`;
}

/**
 * Get messages from a group (normalized)
 */
function getGroupMessages(group: MessageGroup): Message[] {
  return group.type === 'single' ? [group.message] : group.messages;
}

/**
 * Estimate node height based on content for layout purposes
 * This helps dagre allocate proper spacing to avoid overlaps
 */
function estimateNodeHeight(group: MessageGroup): number {
  const BASE_HEIGHT = 60;  // Minimum padding + borders
  const LINE_HEIGHT = 20;  // Approximate pixels per line
  const MAX_HEIGHT = 400;  // Cap to prevent huge nodes
  const CHARS_PER_LINE = 45; // Average chars per line at default width

  if (group.type === 'tool_group') {
    // Tool nodes are more compact
    return BASE_HEIGHT + (group.messages.length * 30);
  }

  if (group.type === 'subagent_group') {
    // Subagent nodes have fixed structure
    return BASE_HEIGHT + 60;
  }

  // Single messages - estimate based on content length
  const content = group.message.content || '';
  const contentLength = typeof content === 'string' ? content.length : 0;
  const estimatedLines = Math.ceil(contentLength / CHARS_PER_LINE);
  const contentHeight = estimatedLines * LINE_HEIGHT;

  return Math.min(BASE_HEIGHT + contentHeight, MAX_HEIGHT);
}

/**
 * Transform MessageGroup[] into svelte-flow nodes and edges
 *
 * @param groups - Grouped messages from groupMessages()
 * @param instanceId - Instance ID for context
 * @param options - Optional configuration
 * @returns FlowData with nodes and edges (positions at 0,0 for dagre layout)
 */
export function messagesToFlow(
  groups: MessageGroup[],
  instanceId: string,
  options: {
    subagents?: Map<string, SubagentState>;
    streamingToolId?: string;
  } = {}
): FlowData {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  let prevNodeId: string | null = null;

  for (const group of groups) {
    const nodeId = getGroupId(group);
    const nodeType = getNodeType(group);
    const messages = getGroupMessages(group);
    const firstMsg = messages[0];

    // Estimate height for layout
    const estimatedHeight = estimateNodeHeight(group);

    // Build node data based on type
    const data: Record<string, unknown> = {
      instanceId,
      messages,
      // Include first message content for easy access
      content: firstMsg.content,
      // Height hint for dagre layout
      height: estimatedHeight,
    };

    // Add type-specific data
    if (group.type === 'single') {
      data.message = group.message;
      data.content = group.message.content;
    } else if (group.type === 'tool_group') {
      // Check if any tool in the group is currently streaming
      data.isStreaming = options.streamingToolId
        ? messages.some(m => m.metadata?.toolId === options.streamingToolId)
        : false;
    } else if (group.type === 'subagent_group') {
      // Find subagent state for each Task tool_use
      const subagentStates: SubagentState[] = [];
      for (const msg of messages) {
        const toolId = msg.metadata?.toolId;
        if (toolId && options.subagents?.has(toolId)) {
          subagentStates.push(options.subagents.get(toolId)!);
        }
      }
      data.subagents = subagentStates;
      // For single subagent, also set as primary
      if (subagentStates.length === 1) {
        data.subagent = subagentStates[0];
      }
    }

    nodes.push({
      id: nodeId,
      type: nodeType,
      position: { x: 0, y: 0 }, // dagre will position these
      data,
    });

    // Create edge from previous node
    if (prevNodeId) {
      edges.push({
        id: `e-${prevNodeId}-${nodeId}`,
        source: prevNodeId,
        target: nodeId,
        type: 'smoothstep',
      });
    }

    prevNodeId = nodeId;
  }

  return { nodes, edges };
}

/**
 * Full pipeline: Message[] -> FlowData
 * Convenience function that combines groupMessages + messagesToFlow
 */
export function transformMessagesToFlow(
  messages: Message[],
  instanceId: string,
  options: {
    subagents?: Map<string, SubagentState>;
    streamingToolId?: string;
  } = {}
): FlowData {
  const groups = groupMessages(messages);
  return messagesToFlow(groups, instanceId, options);
}
