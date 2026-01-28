// Shared types for real-time stores
// Extracted from realtime.svelte.ts for use across entity stores
import type { MessageMetadata as DbMessageMetadata } from '@agentdeck/db';
import type { ViewMode as CoreViewMode, Task as CoreTask, Project as CoreProject } from '@agentdeck/core/types';
import type { PermissionRequestEvent } from '@agentdeck/core/dashboard';

export interface Agent {
  machineId: string;
  name: string;
  os: 'darwin' | 'linux' | 'windows';
  status: 'online' | 'reconnecting' | 'offline';
  instances: number;
  ip: string;
  connectedAt?: Date;
  lastPing?: Date;
  /** Default working directory for new instances on this agent */
  defaultCwd?: string | null;
}

export type ViewMode = CoreViewMode;

export interface Instance {
  id: string;
  name: string;
  status: 'starting' | 'running' | 'stopping' | 'stopped' | 'sleeping' | 'error' | 'disconnected';
  agent: string;
  machineId: string;
  project: string | null;
  projectId: string | null;
  conversationId?: string | null;
  activeThreadId?: string | null;
  activeSpanId?: string | null;
  lastActivity: string;
  cwd: string;
  model?: string;
  totalCostUsd?: number;
  viewMode?: ViewMode;
  thinkingMode?: 'off' | 'think' | 'ultrathink';
}

export type Project = CoreProject & {
  instanceCount: number;
};

export type Task = Omit<CoreTask, 'notes' | 'metadata' | 'updatedAt' | 'completedAt'> & {
  completedAt?: Date;
  updatedAt?: Date;
};

export type MessageType =
  | 'user'
  | 'assistant'
  | 'thinking'
  | 'tool.use'
  | 'tool.result'
  | 'tool.progress'
  | 'result.success'
  | 'result.error'
  | `system.${string}`
  | `ui.${string}`;

export interface Message {
  id?: string;
  instanceId: string;
  threadId?: string;
  spanId?: string;
  parentMessageId?: string | null;
  /** Links to the Task tool.use that spawned this message (for subagent messages) */
  parentToolUseId?: string;
  type: MessageType;
  content: string;
  contentJson?: unknown;
  timestamp: Date;
  /** SDK message UUID - used for resumeSessionAt when editing */
  sdkUuid?: string;
  toolCallId?: string | null;
  status?: string | null;
  seq?: number;
  // Metadata for richer rendering
  metadata?: MessageMetadata;
}

export type MessageMetadata = DbMessageMetadata;

export interface StreamingState {
  instanceId: string;
  isStreaming: boolean;
  /** SDK init received, Claude is about to respond */
  isInitializing: boolean;
  /** Timestamp of the last streaming chunk */
  lastChunkAt?: Date;
  inputTokens: number;
  outputTokens: number;
  sessionInputTokens: number;
  sessionOutputTokens: number;
  costUsd: number;
  lastUpdate: Date;
}

/**
 * Streaming message state for progressive text rendering.
 * Accumulates content_block_delta events until message_stop.
 */
export interface StreamingMessage {
  instanceId: string;
  /** Map of content block index to accumulated text */
  contentBlocks: Map<number, string>;
  /** Whether the message is complete (message_stop received) */
  isComplete: boolean;
  /** Current SDK message UUID (for linking to final message) */
  sdkUuid?: string;
  /** Timestamp when streaming started */
  startedAt: Date;
}

export type PermissionRequest = PermissionRequestEvent;


/**
 * State for tracking active subagents (spawned via Task tool).
 * Used for the Mission Control tree visualization.
 */
export interface SubagentState {
  /** The Task tool.use ID that spawned this subagent */
  toolUseId: string;
  /** Instance this subagent belongs to */
  instanceId: string;
  /** Type of subagent (Explore, Plan, Bash, etc.) */
  subagentType: string;
  /** Short description from Task tool input */
  description?: string;
  /** Current status */
  status: 'starting' | 'running' | 'complete' | 'error';
  /** When the subagent started */
  startedAt: Date;
  /** When the subagent completed */
  completedAt?: Date;
  /** Parent subagent's toolUseId (for nested subagents) */
  parentSubagentId?: string;
  /** Accumulated messages within this subagent */
  messages: Message[];
  /** Final result when complete */
  result?: string;
  /** Error message if status is 'error' */
  error?: string;
  /** Whether this is a background agent (not streamed live) */
  isBackground?: boolean;
}

// UI State types
export interface SplitViewState {
  enabled: boolean;
  secondInstanceId: string | null;
  splitRatio: number; // 0.5 = 50/50, 0.3 = 30/70, etc.
}

export type SidebarFilter = 'all' | 'running' | 'stopped' | 'agent';

export interface SidebarFilterState {
  type: SidebarFilter;
  agentId?: string; // Only used when type === 'agent'
}

export interface ProjectGroup {
  project: Project | null; // null = "Unassigned"
  instances: Instance[];
  isCollapsed: boolean;
}
