/**
 * SSE Event Type Definitions for Cockpit Dashboard
 *
 * These types match the BroadcastService events from packages/hub-server/src/services/broadcast.ts
 * Used with river.ts for type-safe SSE handling.
 */

import type { SdkMessageType, ToolInvocationStatus, InstanceStatus, AgentStatus, AgentOS } from '@cockpit/db';

// ============================================================================
// Agent Events
// ============================================================================

export interface AgentConnectedEvent {
  machineId: string;
  hostname: string;
  tailscaleIp?: string;
  os?: AgentOS;
}

export interface AgentDisconnectedEvent {
  machineId: string;
}

export interface AgentReconnectingEvent {
  machineId: string;
}

export interface AgentUpdatedEvent {
  machineId: string;
  hostname?: string;
  tailscaleIp?: string;
  os?: AgentOS;
  status?: AgentStatus;
}

// ============================================================================
// Instance Lifecycle Events
// ============================================================================

export interface InstanceCreatedEvent {
  id: string;
  machineId: string;
  projectId?: string | null;
  cwd: string;
  status: InstanceStatus;
  model?: string | null;
  permissionMode?: string | null;
  lastPrompt?: string | null;
  createdAt: string | Date;
}

export interface InstanceStartedEvent {
  id: string;
  sessionId?: string | null;
  sdkSessionId?: string | null;
  machineId: string;
  projectId?: string | null;
  cwd: string;
  status: InstanceStatus;
  model?: string | null;
  permissionMode?: string | null;
  lastPrompt?: string | null;
  totalCostUsd?: number;
  createdAt: string | Date;
  stoppedAt?: string | Date | null;
}

export interface InstanceStoppedEvent {
  instanceId: string;
  instance?: {
    id: string;
    status: InstanceStatus;
    totalCostUsd?: number;
    stoppedAt?: string | Date | null;
  };
}

export interface InstanceSleepingEvent {
  instanceId: string;
  instance?: {
    id: string;
    status: InstanceStatus;
    sdkSessionId?: string | null;
  };
  sdkSessionId?: string;
  reason?: string;
}

export interface InstanceErrorEvent {
  instanceId: string;
  instance?: {
    id: string;
    status: InstanceStatus;
  };
  error?: string;
}

export interface InstanceResumedEvent {
  id: string;
  sessionId?: string | null;
  sdkSessionId?: string | null;
  machineId: string;
  projectId?: string | null;
  cwd: string;
  status: InstanceStatus;
  model?: string | null;
  permissionMode?: string | null;
  lastPrompt?: string | null;
  totalCostUsd?: number;
  createdAt: string | Date;
  stoppedAt?: string | Date | null;
}

export interface InstanceTokenUsageEvent {
  instanceId: string;
  inputTokens: number;
  outputTokens: number;
  costDelta?: number;
}

export interface InstanceModelChangedEvent {
  instanceId: string;
  model: string;
}

// ============================================================================
// SDK Message Events (most complex)
// ============================================================================

/**
 * Tool invocation extracted from message content blocks
 */
export interface ExtractedToolInvocation {
  id: string;  // SDK's tool_use_id
  toolName: string;
  toolInput: Record<string, unknown> | null;
  subagentType?: string | null;
  subagentDescription?: string | null;
}

/**
 * Tool result update from user message content blocks
 */
export interface ExtractedToolResult {
  toolUseId: string;
  toolResult: Record<string, unknown> | null;
  toolResultContent: string | null;
  status: ToolInvocationStatus;
  isError: boolean;
  durationMs: number | null;
  isBackgroundAgent?: boolean;
  backgroundAgentId?: string;
}

/**
 * Raw SDK message structure (from Claude SDK via agent)
 */
export interface RawSdkMessage {
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
 * sdk:message event - the most complex event type
 * Contains both raw message and pre-extracted normalized fields
 */
export interface SdkMessageEvent {
  instanceId: string;
  /** Raw SDK message (for backwards compat / debugging) */
  message: RawSdkMessage;
  /** SDK's message UUID for resumeSessionAt */
  sdkUuid?: string;
  /** Normalized message type */
  sdkType: SdkMessageType;
  /** Message subtype (init, compact_boundary, etc.) */
  sdkSubtype?: string | null;
  /** Parent Task tool ID for subagent messages */
  parentToolUseId?: string | null;
  /** Message role (user/assistant) */
  role?: 'user' | 'assistant' | null;
  /** Extracted text content */
  textContent?: string | null;
  /** Model used for this message */
  model?: string | null;
  /** Tool invocations from content blocks */
  toolInvocations: ExtractedToolInvocation[];
  /** Tool results from content blocks */
  toolResults: ExtractedToolResult[];
}

// ============================================================================
// Task Events
// ============================================================================

export interface TaskCreatedEvent {
  id: string;
  instanceId: string;
  projectId?: string | null;
  parentTaskId?: string | null;
  title: string;
  description: string;
  type: 'major' | 'minor';
  status: 'in_progress' | 'completed' | 'blocked' | 'cancelled';
  progress?: number;
  notes?: string | null;
  metadata?: Record<string, unknown> | null;
  startedAt: string | Date;
  completedAt?: string | Date | null;
  updatedAt: string | Date;
}

export interface TaskUpdatedEvent {
  id: string;
  instanceId: string;
  projectId?: string | null;
  parentTaskId?: string | null;
  title: string;
  description: string;
  type: 'major' | 'minor';
  status: 'in_progress' | 'completed' | 'blocked' | 'cancelled';
  progress?: number;
  notes?: string | null;
  metadata?: Record<string, unknown> | null;
  startedAt: string | Date;
  completedAt?: string | Date | null;
  updatedAt: string | Date;
}

export interface TaskCompletedEvent {
  id: string;
  instanceId: string;
  status: 'completed';
  completedAt: string | Date;
}

// ============================================================================
// Permission Events
// ============================================================================

export interface PermissionRequestEvent {
  requestId: string;
  instanceId: string;
  machineId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  toolUseID: string;
  decisionReason?: string;
  blockedPath?: string;
  subAgentID?: string;
  suggestions?: unknown[];
  createdAt: number;
}

// ============================================================================
// Project Events
// ============================================================================

export interface ProjectCreatedEvent {
  id: string;
  name: string;
  description?: string | null;
  rootPath?: string | null;
  machineId?: string | null;
  settings?: Record<string, unknown> | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}

export interface ProjectUpdatedEvent {
  id: string;
  name: string;
  description?: string | null;
  rootPath?: string | null;
  machineId?: string | null;
  settings?: Record<string, unknown> | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}

export interface ProjectDeletedEvent {
  id: string;
}

// ============================================================================
// Event Map for river.ts
// ============================================================================

/**
 * Complete map of all SSE event types for river.ts
 * Maps event name to its payload type
 */
export interface CockpitEventMap {
  // Agent events
  'agent:connected': AgentConnectedEvent;
  'agent:disconnected': AgentDisconnectedEvent;
  'agent:reconnecting': AgentReconnectingEvent;
  'agent:updated': AgentUpdatedEvent;

  // Instance lifecycle events
  'instance:created': InstanceCreatedEvent;
  'instance:started': InstanceStartedEvent;
  'instance:stopped': InstanceStoppedEvent;
  'instance:sleeping': InstanceSleepingEvent;
  'instance:error': InstanceErrorEvent;
  'instance:resumed': InstanceResumedEvent;
  'instance:token_usage': InstanceTokenUsageEvent;
  'instance:model-changed': InstanceModelChangedEvent;

  // SDK message event
  'sdk:message': SdkMessageEvent;

  // Task events
  'task:created': TaskCreatedEvent;
  'task:updated': TaskUpdatedEvent;
  'task:completed': TaskCompletedEvent;

  // Permission events
  'permission:request': PermissionRequestEvent;

  // Project events
  'project:created': ProjectCreatedEvent;
  'project:updated': ProjectUpdatedEvent;
  'project:deleted': ProjectDeletedEvent;
}

/**
 * Union type of all event names
 */
export type CockpitEventType = keyof CockpitEventMap;

/**
 * Helper type to get the payload type for a specific event
 */
export type CockpitEventPayload<T extends CockpitEventType> = CockpitEventMap[T];
