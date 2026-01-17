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
 * Estimate node height for layout purposes
 * Uses COMPACT sizes since zoomed-out view shows abbreviated nodes
 * The actual rendered height varies with zoom level (semantic zoom)
 */
function estimateNodeHeight(group: MessageGroup): number {
  // Use compact heights for layout - nodes expand visually when zoomed in
  // but layout should be based on the zoomed-out compact view
  const COMPACT_HEIGHT = 40;  // Height of a compact/abbreviated node

  if (group.type === 'tool_group') {
    // Tool groups might show count badge, still compact
    return COMPACT_HEIGHT;
  }

  if (group.type === 'subagent_group') {
    // Subagent nodes in compact view
    return COMPACT_HEIGHT;
  }

  // All single message nodes use compact height for layout
  return COMPACT_HEIGHT;
}

/**
 * Group subagent messages (tool calls) into groups
 * Same logic as groupMessages but for a subagent's internal messages
 */
function groupSubagentMessages(messages: Message[]): MessageGroup[] {
  const groups: MessageGroup[] = [];
  let i = 0;

  while (i < messages.length) {
    const msg = messages[i];

    // Group consecutive tool messages
    if (msg.type === 'tool_use' || msg.type === 'tool_result') {
      const toolMessages: Message[] = [msg];
      const startIndex = i;
      i++;

      while (i < messages.length) {
        const nextMsg = messages[i];
        if (nextMsg.type === 'tool_use' || nextMsg.type === 'tool_result') {
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

/**
 * Transform MessageGroup[] into svelte-flow nodes and edges
 *
 * For subagent_groups with multiple subagents, creates a fork/merge pattern:
 * - Fork: previous node connects to ALL subagent nodes
 * - Each subagent has its own branch of tool call nodes
 * - Merge: ALL branches connect back to the next node
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

  let prevNodeIds: string[] = []; // Track multiple previous nodes for merge patterns

  for (let groupIdx = 0; groupIdx < groups.length; groupIdx++) {
    const group = groups[groupIdx];

    // Handle subagent_group specially - create individual nodes with branches for each
    if (group.type === 'subagent_group' && group.messages.length > 0) {
      const branchEndNodeIds: string[] = []; // Track the end of each subagent's branch

      // Create a branch for EACH subagent
      for (let subIdx = 0; subIdx < group.messages.length; subIdx++) {
        const msg = group.messages[subIdx];
        const toolId = msg.metadata?.toolId;
        const subagentNodeId = toolId || msg.sdkUuid || msg.id || `subagent-${groupIdx}-${subIdx}`;

        // Get subagent state if available
        const subagentState = toolId ? options.subagents?.get(toolId) : undefined;

        // Create the subagent header node
        const subagentData: Record<string, unknown> = {
          instanceId,
          messages: [msg],
          content: msg.content,
          height: 100,
          subagent: subagentState,
          subagents: subagentState ? [subagentState] : [],
        };

        nodes.push({
          id: subagentNodeId,
          type: NODE_TYPES.SUBAGENT,
          position: { x: 0, y: 0 },
          data: subagentData,
        });

        // Fork: connect from ALL previous nodes to this subagent
        for (const prevId of prevNodeIds) {
          edges.push({
            id: `e-${prevId}-${subagentNodeId}`,
            source: prevId,
            target: subagentNodeId,
            type: 'smoothstep',
          });
        }

        // Now create nodes for this subagent's tool calls
        let branchPrevId = subagentNodeId;

        if (subagentState?.messages && subagentState.messages.length > 0) {
          // Group the subagent's messages (tool calls)
          const subagentGroups = groupSubagentMessages(subagentState.messages);

          for (let sgIdx = 0; sgIdx < subagentGroups.length; sgIdx++) {
            const sg = subagentGroups[sgIdx];

            if (sg.type === 'tool_group') {
              const toolNodeId = `${subagentNodeId}-tools-${sgIdx}`;
              const toolData: Record<string, unknown> = {
                instanceId,
                messages: sg.messages,
                content: sg.messages[0].content,
                height: 60 + sg.messages.length * 25,
                isStreaming: options.streamingToolId
                  ? sg.messages.some(m => m.metadata?.toolId === options.streamingToolId)
                  : false,
              };

              nodes.push({
                id: toolNodeId,
                type: NODE_TYPES.TOOL,
                position: { x: 0, y: 0 },
                data: toolData,
              });

              edges.push({
                id: `e-${branchPrevId}-${toolNodeId}`,
                source: branchPrevId,
                target: toolNodeId,
                type: 'smoothstep',
              });

              branchPrevId = toolNodeId;
            } else if (sg.type === 'single') {
              // Handle non-tool messages (assistant responses within subagent)
              const singleNodeId = `${subagentNodeId}-msg-${sgIdx}`;
              const singleMsg = sg.message;

              // Determine node type
              let nodeType: string = NODE_TYPES.ASSISTANT;
              if (singleMsg.type === 'user') nodeType = NODE_TYPES.USER;
              else if (singleMsg.type === 'system' || singleMsg.type === 'error') nodeType = NODE_TYPES.SYSTEM;

              const singleData: Record<string, unknown> = {
                instanceId,
                message: singleMsg,
                content: singleMsg.content,
                height: 80,
              };

              nodes.push({
                id: singleNodeId,
                type: nodeType,
                position: { x: 0, y: 0 },
                data: singleData,
              });

              edges.push({
                id: `e-${branchPrevId}-${singleNodeId}`,
                source: branchPrevId,
                target: singleNodeId,
                type: 'smoothstep',
              });

              branchPrevId = singleNodeId;
            }
          }
        }

        // Track the end of this branch for merging
        branchEndNodeIds.push(branchPrevId);
      }

      // Set up for merge: next node will connect from ALL branch ends
      prevNodeIds = branchEndNodeIds;
      continue;
    }

    // Regular node handling (single messages, tool groups)
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
      content: firstMsg.content,
      height: estimatedHeight,
    };

    // Add type-specific data
    if (group.type === 'single') {
      data.message = group.message;
      data.content = group.message.content;
    } else if (group.type === 'tool_group') {
      data.isStreaming = options.streamingToolId
        ? messages.some(m => m.metadata?.toolId === options.streamingToolId)
        : false;
    }

    nodes.push({
      id: nodeId,
      type: nodeType,
      position: { x: 0, y: 0 },
      data,
    });

    // Merge: connect from ALL previous nodes to this node
    for (const prevId of prevNodeIds) {
      edges.push({
        id: `e-${prevId}-${nodeId}`,
        source: prevId,
        target: nodeId,
        type: 'smoothstep',
      });
    }

    // This node becomes the single previous for the next iteration
    prevNodeIds = [nodeId];
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
