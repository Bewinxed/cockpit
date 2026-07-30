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
  ViewMode,
  MessageMetadata,
} from '@agentdeck/db';
import type { Question, QuestionOption } from '../types/question.js';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';

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
  conversationId?: string | null;
  activeThreadId?: string | null;
  activeSpanId?: string | null;
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
  conversationId?: string | null;
  activeThreadId?: string | null;
  activeSpanId?: string | null;
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
  conversationId?: string | null;
  activeThreadId?: string | null;
  activeSpanId?: string | null;
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

export interface InstanceThinkingChangedEvent {
  instanceId: string;
  mode: 'off' | 'think' | 'ultrathink';
}

export interface InstanceTurnEvent {
  instanceId: string;
  phase: 'started' | 'completed';
  isError?: boolean;
  timestamp: string | Date;
}

// ============================================================================
// Canonical Message Events
// ============================================================================

export interface CanonicalMessage {
  id: string;
  threadId: string;
  spanId: string;
  parentMessageId?: string | null;
  parentToolUseId?: string | null;
  type: string;
  contentText?: string | null;
  contentJson?: unknown | null;
  metadata?: MessageMetadata | null;
  sdkUuid?: string | null;
  toolCallId?: string | null;
  status?: string | null;
  seq: number;
  createdAt: string | Date;
}

export interface MessageCreatedEvent {
  instanceId: string;
  message: CanonicalMessage;
}

export interface MessageStreamEvent {
  instanceId: string;
  sdkUuid?: string | null;
  parentToolUseId?: string | null;
  event: {
    type: string;
    [key: string]: unknown;
  };
}

export interface SdkMessageEvent {
  instanceId: string;
  message: SDKMessage;
  receivedAt?: string | Date;
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
  'instance:thinking-changed': InstanceThinkingChangedEvent;
  'instance:turn': InstanceTurnEvent;

  // Canonical message events
  'message:created': MessageCreatedEvent;
  'message:stream': MessageStreamEvent;
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
