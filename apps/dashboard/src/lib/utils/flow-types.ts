/**
 * Type definitions for flow visualization
 * Provides type safety for node data across all flow components
 */

import type { Node, Edge } from '@xyflow/svelte';
import type { Message } from '$lib/cockpit/types';

/**
 * A subagent branch, as both the chat view's branch card and the flow view draw
 * it. Produced by `frames.ts` from the `parent_tool_use_id` that forwarded
 * subagent messages carry, and moved by the `task_*` system messages.
 */
export interface SubagentState {
  /** The Task tool.use id that spawned this subagent. */
  toolUseId: string;
  instanceId: string;
  subagentType: string;
  description?: string;
  status: 'starting' | 'running' | 'complete' | 'error';
  startedAt: Date;
  completedAt?: Date;
  /** Parent subagent's toolUseId, for nested branches. */
  parentSubagentId?: string;
  messages: Message[];
  result?: string;
  error?: string;
  isBackground?: boolean;
  /** The task the `task_*` progress messages report under. */
  taskId?: string;
  /** `agentProgressSummaries`' present-tense line, when enabled. */
  summary?: string;
  lastToolName?: string;
  /** Model that answered (wire id from assistant frames), or the requested alias until the first frame arrives. */
  model?: string;
}

// ============================================================
// Node Data Types
// ============================================================

/** Base data all flow nodes share */
export interface BaseNodeData {
  /** Instance ID for context */
  instanceId: string;
  /** Estimated height for layout */
  height?: number;
  /** Primary content to display */
  content?: string;
  /** Index signature for svelte-flow compatibility */
  [key: string]: unknown;
}

/** Data for user message nodes */
export interface UserNodeData extends BaseNodeData {
  message: Message;
}

/** Data for assistant message nodes */
export interface AssistantNodeData extends BaseNodeData {
  message?: Message;
  messages?: Message[];
  model?: string;
  isStreaming?: boolean;
}

/** Data for tool nodes */
export interface ToolNodeData extends BaseNodeData {
  messages: Message[];
  isStreaming?: boolean;
  expanded?: boolean;
}

/** Data for subagent nodes */
export interface SubagentNodeData extends BaseNodeData {
  subagent?: SubagentState;
  subagents?: SubagentState[];
  messages?: Message[];
  depth?: number;
  branchColor?: string;
}

/** Data for system message nodes */
export interface SystemNodeData extends BaseNodeData {
  message?: Message;
}

/** Union type for all node data */
export type FlowNodeData =
  | UserNodeData
  | AssistantNodeData
  | ToolNodeData
  | SubagentNodeData
  | SystemNodeData;

// ============================================================
// Typed Node Definitions
// ============================================================

export type UserNode = Node<UserNodeData, 'user'>;
export type AssistantNode = Node<AssistantNodeData, 'assistant'>;
export type ToolNode = Node<ToolNodeData, 'tool'>;
export type SubagentNode = Node<SubagentNodeData, 'subagent'>;
export type SystemNode = Node<SystemNodeData, 'system'>;

export type FlowNode = UserNode | AssistantNode | ToolNode | SubagentNode | SystemNode;

// ============================================================
// Message Grouping Types
// ============================================================

/** A single message that stands alone */
export interface SingleMessageGroup {
  type: 'single';
  message: Message;
  index: number;
}

/** A group of consecutive tool messages */
export interface ToolMessageGroup {
  type: 'tool_group';
  messages: Message[];
  startIndex: number;
}

/** A group of subagent spawn messages */
export interface SubagentMessageGroup {
  type: 'subagent_group';
  messages: Message[];
  startIndex: number;
}

/** Union type for message groups */
export type MessageGroup = SingleMessageGroup | ToolMessageGroup | SubagentMessageGroup;

// ============================================================
// Flow Data Types
// ============================================================

/** Complete flow data with nodes and edges */
export interface FlowData {
  nodes: Node[];
  edges: Edge[];
}

/** Options for flow transformation */
export interface FlowTransformOptions {
  /** Map of tool use IDs to subagent states */
  subagents?: Map<string, SubagentState>;
  /** ID of currently streaming tool */
  streamingToolId?: string;
}

// ============================================================
// Layout Types
// ============================================================

export type ZoomMode = 'compact' | 'expanded';
export type ZoomLevel = 'overview' | 'summary' | 'detail';

/** Options for dagre layout */
export interface LayoutOptions {
  /** Layout direction: TB (top-bottom) or LR (left-right) */
  direction?: 'TB' | 'LR';
  /** Horizontal spacing between nodes */
  nodeSep?: number;
  /** Vertical spacing between ranks (rows) */
  rankSep?: number;
  /** Default node width */
  nodeWidth?: number;
  /** Zoom mode affects spacing */
  zoomMode?: ZoomMode;
}

// ============================================================
// Component Props Types
// ============================================================

/** Props for FlowAutoFit component */
export interface FlowAutoFitProps {
  nodeCount: number;
  nodes: Node[];
}

/** Props for FlowZoomTracker component */
export interface FlowZoomTrackerProps {
  onZoomChange: (zoom: number) => void;
  nodes: Node[];
}

/** Props for FlowContextMenu component */
export interface FlowContextMenuProps {
  x: number;
  y: number;
  onAction: (action: string) => void;
  onClose: () => void;
}

/** Props for FlowView component */
export interface FlowViewProps {
  instanceId: string;
}

// ============================================================
// Context Menu Types
// ============================================================

export type ContextMenuAction = 'copy' | 'rewind' | 'branch' | 'jump';

export interface ContextMenuState {
  x: number;
  y: number;
  nodeId: string;
}

// ============================================================
// Viewport Types
// ============================================================

export interface ViewportBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface PendingCompensation {
  nodeId: string;
  oldPosition: Point;
}
