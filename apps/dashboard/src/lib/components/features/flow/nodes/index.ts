import type { NodeTypes } from '@xyflow/svelte';
import UserMessageNode from './UserMessageNode.svelte';
import AssistantMessageNode from './AssistantMessageNode.svelte';
import ToolNode from './ToolNode.svelte';
import SubagentNode from './SubagentNode.svelte';
import SystemMessageNode from './SystemMessageNode.svelte';

// Node type identifiers
export const NODE_TYPES = {
  USER: 'user',
  ASSISTANT: 'assistant',
  TOOL: 'tool',
  SUBAGENT: 'subagent',
  SYSTEM: 'system',
} as const;

export type FlowNodeType = typeof NODE_TYPES[keyof typeof NODE_TYPES];

// Branch colors for subagents (3-4 from theme)
export const BRANCH_COLORS = [
  '#3b82f6', // blue
  '#22c55e', // green
  '#a855f7', // purple
  '#f59e0b', // amber
] as const;

// NodeTypes map for SvelteFlow
export const nodeTypes: NodeTypes = {
  [NODE_TYPES.USER]: UserMessageNode,
  [NODE_TYPES.ASSISTANT]: AssistantMessageNode,
  [NODE_TYPES.TOOL]: ToolNode,
  [NODE_TYPES.SUBAGENT]: SubagentNode,
  [NODE_TYPES.SYSTEM]: SystemMessageNode,
};

// Re-export individual components
export {
  UserMessageNode,
  AssistantMessageNode,
  ToolNode,
  SubagentNode,
  SystemMessageNode,
};
