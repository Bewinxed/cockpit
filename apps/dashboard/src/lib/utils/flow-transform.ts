/**
 * Transform Message[] into svelte-flow Node[] and Edge[]
 * Handles grouping of consecutive tool messages and subagent spawning
 */

import type { Edge, Node } from "@xyflow/svelte";
import { NODE_TYPES } from "$lib/components/features/flow/nodes";
import type { Message } from "$lib/whiffle/types";
import { COMPACT_CONFIG } from "./flow-constants";
import type {
  AssistantNodeData,
  FlowData,
  FlowTransformOptions,
  MessageGroup,
  SubagentNodeData,
  SystemNodeData,
  ToolNodeData,
  UserNodeData,
} from "./flow-types";

// Re-export types for external use
export type {
  FlowData,
  FlowTransformOptions,
  MessageGroup,
} from "./flow-types";

// ============================================================
// Message Type Detection Helpers
// ============================================================

/** Check if a message is a Task tool.use (subagent spawn) */
export function isTaskToolUse(msg: Message): boolean {
  return msg.type === "tool.use" && !!msg.metadata?.subagentType;
}

/** Check if a message is a TaskOutput tool (retrieves subagent results) */
export function isTaskOutputTool(msg: Message): boolean {
  return msg.type === "tool.use" && msg.metadata?.toolName === "TaskOutput";
}

/** Check if a message belongs to a subagent (has parentToolUseId) */
export function isSubagentMessage(msg: Message): boolean {
  return !!msg.parentToolUseId;
}

// ============================================================
// Grouping Logic
// ============================================================

/**
 * Filter messages for main chat flow (excludes subagent messages and TaskOutput)
 */
export function filterChatMessages(messages: Message[]): Message[] {
  return messages.filter(
    (msg) => !(isTaskOutputTool(msg) || isSubagentMessage(msg))
  );
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

    // Task tool.use messages - group consecutive ones for parallel display
    if (isTaskToolUse(msg)) {
      const subagentMessages: Message[] = [msg];
      const startIndex = i;
      i++;

      // Collect consecutive Task tools (parallel agents)
      while (i < chatMessages.length && isTaskToolUse(chatMessages[i])) {
        subagentMessages.push(chatMessages[i]);
        i++;
      }

      groups.push({
        type: "subagent_group",
        messages: subagentMessages,
        startIndex,
      });
    }
    // Regular tool messages get grouped together
    else if (msg.type === "tool.use" || msg.type === "tool.result") {
      const toolMessages: Message[] = [msg];
      const startIndex = i;
      i++;

      while (i < chatMessages.length) {
        const nextMsg = chatMessages[i];
        if (
          (nextMsg.type === "tool.use" || nextMsg.type === "tool.result") &&
          !isTaskToolUse(nextMsg) &&
          !isTaskOutputTool(nextMsg)
        ) {
          toolMessages.push(nextMsg);
          i++;
        } else {
          break;
        }
      }

      groups.push({ type: "tool_group", messages: toolMessages, startIndex });
    } else {
      groups.push({ type: "single", message: msg, index: i });
      i++;
    }
  }

  return groups;
}

// ============================================================
// Flow Transformation Helpers
// ============================================================

/**
 * Determine node type based on message group
 */
function getNodeType(group: MessageGroup): string {
  if (group.type === "tool_group") {
    return NODE_TYPES.TOOL;
  }
  if (group.type === "subagent_group") {
    return NODE_TYPES.SUBAGENT;
  }

  const msg = group.message;

  switch (msg.type) {
    case "user":
      return NODE_TYPES.USER;
    case "assistant":
    case "thinking":
      return NODE_TYPES.ASSISTANT;
    default:
      if (
        msg.type.startsWith("system.") ||
        msg.type.startsWith("result.") ||
        msg.type.startsWith("ui.")
      ) {
        return NODE_TYPES.SYSTEM;
      }
      return NODE_TYPES.ASSISTANT;
  }
}

/**
 * Get a stable ID for a message group
 */
function getGroupId(group: MessageGroup): string {
  if (group.type === "single") {
    return group.message.sdkUuid || group.message.id || `msg-${group.index}`;
  }
  const firstMsg = group.messages[0];
  return (
    firstMsg.sdkUuid ||
    firstMsg.id ||
    firstMsg.metadata?.toolId ||
    `group-${group.startIndex}`
  );
}

/**
 * Get messages from a group (normalized)
 */
function getGroupMessages(group: MessageGroup): Message[] {
  return group.type === "single" ? [group.message] : group.messages;
}

/**
 * Group subagent messages (tool calls) into groups
 */
function groupSubagentMessages(messages: Message[]): MessageGroup[] {
  const groups: MessageGroup[] = [];
  let i = 0;

  while (i < messages.length) {
    const msg = messages[i];

    if (msg.type === "tool.use" || msg.type === "tool.result") {
      const toolMessages: Message[] = [msg];
      const startIndex = i;
      i++;

      while (i < messages.length) {
        const nextMsg = messages[i];
        if (nextMsg.type === "tool.use" || nextMsg.type === "tool.result") {
          toolMessages.push(nextMsg);
          i++;
        } else {
          break;
        }
      }

      groups.push({ type: "tool_group", messages: toolMessages, startIndex });
    } else {
      groups.push({ type: "single", message: msg, index: i });
      i++;
    }
  }

  return groups;
}

// ============================================================
// Main Transformation
// ============================================================

/**
 * Transform MessageGroup[] into svelte-flow nodes and edges
 *
 * For subagent_groups with multiple subagents, creates a fork/merge pattern:
 * - Fork: previous node connects to ALL subagent nodes
 * - Each subagent has its own branch of tool call nodes
 * - Merge: ALL branches connect back to the next node
 */
export function messagesToFlow(
  groups: MessageGroup[],
  instanceId: string,
  options: FlowTransformOptions = {}
): FlowData {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  let prevNodeIds: string[] = [];

  for (let groupIdx = 0; groupIdx < groups.length; groupIdx++) {
    const group = groups[groupIdx];

    // Handle subagent_group specially - create individual nodes with branches
    if (group.type === "subagent_group" && group.messages.length > 0) {
      const branchEndNodeIds: string[] = [];

      for (let subIdx = 0; subIdx < group.messages.length; subIdx++) {
        const msg = group.messages[subIdx];
        const toolId = msg.metadata?.toolId;
        const subagentNodeId =
          toolId || msg.sdkUuid || msg.id || `subagent-${groupIdx}-${subIdx}`;

        const subagentState = toolId
          ? options.subagents?.get(toolId)
          : undefined;

        const subagentData: SubagentNodeData = {
          instanceId,
          messages: [msg],
          content: msg.content as string,
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

        // Fork edges
        for (const prevId of prevNodeIds) {
          edges.push({
            id: `e-${prevId}-${subagentNodeId}`,
            source: prevId,
            target: subagentNodeId,
            type: "smoothstep",
          });
        }

        // Create nodes for subagent's tool calls
        let branchPrevId = subagentNodeId;

        if (subagentState?.messages && subagentState.messages.length > 0) {
          const subagentGroups = groupSubagentMessages(subagentState.messages);

          for (let sgIdx = 0; sgIdx < subagentGroups.length; sgIdx++) {
            const sg = subagentGroups[sgIdx];

            if (sg.type === "tool_group") {
              const toolNodeId = `${subagentNodeId}-tools-${sgIdx}`;
              const toolData: ToolNodeData = {
                instanceId,
                messages: sg.messages,
                content: sg.messages[0].content as string,
                height: 60 + sg.messages.length * 25,
                isStreaming: options.streamingToolId
                  ? sg.messages.some(
                      (m) => m.metadata?.toolId === options.streamingToolId
                    )
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
                type: "smoothstep",
              });

              branchPrevId = toolNodeId;
            } else if (sg.type === "single") {
              const singleNodeId = `${subagentNodeId}-msg-${sgIdx}`;
              const singleMsg = sg.message;

              let nodeType: string = NODE_TYPES.ASSISTANT;
              if (singleMsg.type === "user") {
                nodeType = NODE_TYPES.USER;
              } else if (
                singleMsg.type.startsWith("system.") ||
                singleMsg.type.startsWith("result.") ||
                singleMsg.type.startsWith("ui.")
              ) {
                nodeType = NODE_TYPES.SYSTEM;
              }

              const singleData:
                | AssistantNodeData
                | UserNodeData
                | SystemNodeData = {
                instanceId,
                message: singleMsg,
                content: singleMsg.content as string,
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
                type: "smoothstep",
              });

              branchPrevId = singleNodeId;
            }
          }
        }

        branchEndNodeIds.push(branchPrevId);
      }

      prevNodeIds = branchEndNodeIds;
      continue;
    }

    // Regular node handling
    const nodeId = getGroupId(group);
    const nodeType = getNodeType(group);
    const messages = getGroupMessages(group);
    const firstMsg = messages[0];

    // Build typed node data
    let data: UserNodeData | AssistantNodeData | ToolNodeData | SystemNodeData;

    if (group.type === "single") {
      if (nodeType === NODE_TYPES.USER) {
        data = {
          instanceId,
          message: group.message,
          content: group.message.content as string,
          height: COMPACT_CONFIG.nodeHeightMin,
        } satisfies UserNodeData;
      } else if (nodeType === NODE_TYPES.SYSTEM) {
        data = {
          instanceId,
          message: group.message,
          content: group.message.content as string,
          height: COMPACT_CONFIG.nodeHeightMin,
        } satisfies SystemNodeData;
      } else {
        data = {
          instanceId,
          message: group.message,
          messages: [group.message],
          content: group.message.content as string,
          height: COMPACT_CONFIG.nodeHeightMin,
        } satisfies AssistantNodeData;
      }
    } else {
      data = {
        instanceId,
        messages,
        content: firstMsg.content as string,
        height: COMPACT_CONFIG.nodeHeightMin,
        isStreaming: options.streamingToolId
          ? messages.some((m) => m.metadata?.toolId === options.streamingToolId)
          : false,
      } satisfies ToolNodeData;
    }

    nodes.push({
      id: nodeId,
      type: nodeType,
      position: { x: 0, y: 0 },
      data,
    });

    // Merge edges
    for (const prevId of prevNodeIds) {
      edges.push({
        id: `e-${prevId}-${nodeId}`,
        source: prevId,
        target: nodeId,
        type: "smoothstep",
      });
    }

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
  options: FlowTransformOptions = {}
): FlowData {
  const groups = groupMessages(messages);
  return messagesToFlow(groups, instanceId, options);
}
