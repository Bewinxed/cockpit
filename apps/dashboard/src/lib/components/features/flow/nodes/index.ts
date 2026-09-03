import type { NodeTypes } from "@xyflow/svelte";
import { BRANCH_COLORS_FALLBACK } from "$lib/utils/flow-constants";
import AssistantMessageNode from "./AssistantMessageNode.svelte";
import SubagentNode from "./SubagentNode.svelte";
import SystemMessageNode from "./SystemMessageNode.svelte";
import ToolNode from "./ToolNode.svelte";
import UserMessageNode from "./UserMessageNode.svelte";

// biome-ignore lint/performance/noBarrelFile: public entry point for the flow node component group, consumed as a unit alongside the nodeTypes map above
export { default as AssistantMessageNode } from "./AssistantMessageNode.svelte";
export { default as SubagentNode } from "./SubagentNode.svelte";
export { default as SystemMessageNode } from "./SystemMessageNode.svelte";
export { default as ToolNode } from "./ToolNode.svelte";
export { default as UserMessageNode } from "./UserMessageNode.svelte";

// Node type identifiers
export const NODE_TYPES = {
  USER: "user",
  ASSISTANT: "assistant",
  TOOL: "tool",
  SUBAGENT: "subagent",
  SYSTEM: "system",
} as const;

export type FlowNodeType = (typeof NODE_TYPES)[keyof typeof NODE_TYPES];

// Re-export branch colors from constants
export const BRANCH_COLORS = BRANCH_COLORS_FALLBACK;

// NodeTypes map for SvelteFlow
export const nodeTypes: NodeTypes = {
  [NODE_TYPES.USER]: UserMessageNode,
  [NODE_TYPES.ASSISTANT]: AssistantMessageNode,
  [NODE_TYPES.TOOL]: ToolNode,
  [NODE_TYPES.SUBAGENT]: SubagentNode,
  [NODE_TYPES.SYSTEM]: SystemMessageNode,
};
