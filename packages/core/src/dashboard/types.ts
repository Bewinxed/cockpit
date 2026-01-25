/**
 * Dashboard Event Type Definitions for Cockpit
 *
 * These types are shared between hub-server and dashboard for type-safe
 * real-time communication via WebSocket (using river.ts).
 *
 * NOTE: Import from '@agentdeck/core/events' to avoid naming conflicts with
 * the protocol events in '@agentdeck/core' (which are for agent↔hub JSON-RPC).
 *
 * Wire format: { type: string, data: T, id?: string }
 * - Events (no response): { type, data }
 * - Requests (expect response): { type, data, id }
 * - Responses: { type, data, id }
 */

import type {
  AgentOS,
  AgentStatus,
  InstanceStatus,
  TaskStatus,
  TaskType,
  SdkMessageType,
  ToolInvocationStatus,
  ViewMode,
} from '@agentdeck/db';
import type { Question, QuestionOption } from '../types/question.js';

// Re-export question types for convenience
export type { Question, QuestionOption };

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
  viewMode?: ViewMode | null;
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
  viewMode?: ViewMode | null;
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
  viewMode?: ViewMode | null;
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

export interface InstanceViewModeChangedEvent {
  instanceId: string;
  viewMode: ViewMode;
}

// ============================================================================
// SDK Message Events
// ============================================================================

/**
 * Tool invocation extracted from message content blocks
 */
export interface ExtractedToolInvocation {
  id: string;
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
 */
export interface SdkMessageEvent {
  instanceId: string;
  message: RawSdkMessage;
  sdkUuid?: string;
  sdkType: SdkMessageType;
  sdkSubtype?: string | null;
  parentToolUseId?: string | null;
  role?: 'user' | 'assistant' | null;
  textContent?: string | null;
  model?: string | null;
  toolInvocations: ExtractedToolInvocation[];
  toolResults: ExtractedToolResult[];
}

// ============================================================================
// Task Events
// ============================================================================

export interface TaskEvent {
  id: string;
  instanceId: string;
  projectId?: string | null;
  parentTaskId?: string | null;
  title: string;
  description: string;
  type: TaskType;
  status: TaskStatus;
  progress?: number;
  notes?: string | null;
  metadata?: Record<string, unknown> | null;
  startedAt: string | Date;
  completedAt?: string | Date | null;
  updatedAt: string | Date;
}

export type TaskCreatedEvent = TaskEvent;
export type TaskUpdatedEvent = TaskEvent;

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
// Question Events (AskUserQuestion UI bridge)
// ============================================================================

export interface QuestionRequestEvent {
  requestId: string;
  instanceId: string;
  toolUseId: string;
  questions: Question[];
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
// Connection Events
// ============================================================================

export interface ConnectedEvent {
  clientId: string;
}

// ============================================================================
// Event Map
// ============================================================================

/**
 * Complete map of all dashboard event types
 * Maps event name to its payload type
 */
export interface DashboardEventMap {
  // Connection
  connected: ConnectedEvent;

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
  'instance:viewMode-changed': InstanceViewModeChangedEvent;

  // SDK message event
  'sdk:message': SdkMessageEvent;

  // Task events
  'task:created': TaskCreatedEvent;
  'task:updated': TaskUpdatedEvent;
  'task:completed': TaskCompletedEvent;

  // Permission events
  'permission:request': PermissionRequestEvent;

  // Question events
  'question:request': QuestionRequestEvent;

  // Project events
  'project:created': ProjectCreatedEvent;
  'project:updated': ProjectUpdatedEvent;
  'project:deleted': ProjectDeletedEvent;
}

/**
 * Union type of all event names
 */
export type DashboardEventType = keyof DashboardEventMap;

/**
 * Helper type to get the payload type for a specific event
 */
export type DashboardEventPayload<T extends DashboardEventType> = DashboardEventMap[T];

/**
 * Broadcast event type (for hub-server)
 * Same as DashboardEventType but excludes 'connected' which is connection-specific
 */
export type BroadcastEventType = Exclude<DashboardEventType, 'connected'>;
