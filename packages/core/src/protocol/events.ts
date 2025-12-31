import type { Instance, InstanceStatus } from '../types/instance.js';
import type { Task, TaskStatus } from '../types/task.js';
import type { Agent, AgentOS } from '../types/agent.js';
import type { JsonRpcNotification } from './messages.js';

/**
 * All available event method names (Agent -> Hub)
 */
export const EventMethod = {
  /** A new instance was created */
  INSTANCE_CREATED: 'instance.created',
  /** An instance sent a message/output */
  INSTANCE_MESSAGE: 'instance.message',
  /** An instance was stopped */
  INSTANCE_STOPPED: 'instance.stopped',
  /** An instance's status changed */
  INSTANCE_STATUS_CHANGED: 'instance.statusChanged',
  /** A task was created or updated */
  TASK_UPDATED: 'task.updated',
  /** Agent connected to hub */
  AGENT_CONNECTED: 'agent.connected',
  /** Agent disconnected from hub */
  AGENT_DISCONNECTED: 'agent.disconnected',
  /** Agent heartbeat */
  AGENT_HEARTBEAT: 'agent.heartbeat',
} as const;

export type EventMethodValue = (typeof EventMethod)[keyof typeof EventMethod];

// ============================================================================
// Event Parameters
// ============================================================================

/**
 * Event data for instance creation
 */
export interface InstanceCreatedEvent {
  /** The created instance */
  instance: Instance;
  /** Agent that created it */
  agentId: string;
}

/**
 * Message type from Claude Code
 */
export type InstanceMessageType =
  | 'assistant' // Claude's response
  | 'user' // User input echo
  | 'system' // System message
  | 'tool_use' // Tool invocation
  | 'tool_result' // Tool result
  | 'error'; // Error message

/**
 * Event data for instance messages
 */
export interface InstanceMessageEvent {
  /** Instance that sent the message */
  instanceId: string;
  /** Type of message */
  type: InstanceMessageType;
  /** Message content */
  content: string;
  /** Structured data (for tool use/results) */
  data?: unknown;
  /** Token usage for this message */
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
  };
  /** Cost for this message (USD) */
  costUsd?: number;
  /** Timestamp of the message */
  timestamp: string;
}

/**
 * Event data for instance stop
 */
export interface InstanceStoppedEvent {
  /** Instance that was stopped */
  instanceId: string;
  /** Final status */
  status: InstanceStatus;
  /** Exit code if available */
  exitCode?: number;
  /** Error message if stopped due to error */
  error?: string;
  /** Final statistics */
  stats?: {
    totalTokens: number;
    totalCostUsd: number;
    durationMs: number;
  };
}

/**
 * Event data for instance status change
 */
export interface InstanceStatusChangedEvent {
  /** Instance whose status changed */
  instanceId: string;
  /** Previous status */
  previousStatus: InstanceStatus;
  /** New status */
  newStatus: InstanceStatus;
  /** Reason for change */
  reason?: string;
}

/**
 * Event data for task updates
 */
export interface TaskUpdatedEvent {
  /** The updated task */
  task: Task;
  /** Type of update */
  updateType: 'created' | 'updated' | 'completed' | 'cancelled';
  /** Previous status (if status changed) */
  previousStatus?: TaskStatus;
}

/**
 * Event data for agent connection
 */
export interface AgentConnectedEvent {
  /** Agent that connected */
  agent: Pick<Agent, 'id' | 'machineId' | 'hostname' | 'tailscaleIp' | 'os'>;
  /** Whether this is a reconnection */
  isReconnect: boolean;
  /** Agent version */
  version?: string;
}

/**
 * Event data for agent disconnection
 */
export interface AgentDisconnectedEvent {
  /** Agent that disconnected */
  agentId: string;
  /** Reason for disconnection */
  reason: 'graceful' | 'timeout' | 'error';
  /** Error message if applicable */
  error?: string;
}

/**
 * Event data for agent heartbeat
 */
export interface AgentHeartbeatEvent {
  /** Agent ID */
  agentId: string;
  /** Number of running instances */
  instanceCount: number;
  /** System load (0-1) */
  load?: number;
  /** Available memory in bytes */
  availableMemory?: number;
  /** Timestamp */
  timestamp: string;
}

// ============================================================================
// Event Type Mapping
// ============================================================================

/**
 * Maps event methods to their parameter types
 */
export interface EventParamsMap {
  [EventMethod.INSTANCE_CREATED]: InstanceCreatedEvent;
  [EventMethod.INSTANCE_MESSAGE]: InstanceMessageEvent;
  [EventMethod.INSTANCE_STOPPED]: InstanceStoppedEvent;
  [EventMethod.INSTANCE_STATUS_CHANGED]: InstanceStatusChangedEvent;
  [EventMethod.TASK_UPDATED]: TaskUpdatedEvent;
  [EventMethod.AGENT_CONNECTED]: AgentConnectedEvent;
  [EventMethod.AGENT_DISCONNECTED]: AgentDisconnectedEvent;
  [EventMethod.AGENT_HEARTBEAT]: AgentHeartbeatEvent;
}

// ============================================================================
// Typed Event Notifications
// ============================================================================

/**
 * Typed event notification
 */
export type EventNotification<M extends EventMethodValue = EventMethodValue> = JsonRpcNotification<
  M extends keyof EventParamsMap ? EventParamsMap[M] : unknown
> & {
  method: M;
};

/**
 * Instance created notification
 */
export type InstanceCreatedNotification = EventNotification<typeof EventMethod.INSTANCE_CREATED>;

/**
 * Instance message notification
 */
export type InstanceMessageNotification = EventNotification<typeof EventMethod.INSTANCE_MESSAGE>;

/**
 * Instance stopped notification
 */
export type InstanceStoppedNotification = EventNotification<typeof EventMethod.INSTANCE_STOPPED>;

/**
 * Instance status changed notification
 */
export type InstanceStatusChangedNotification = EventNotification<
  typeof EventMethod.INSTANCE_STATUS_CHANGED
>;

/**
 * Task updated notification
 */
export type TaskUpdatedNotification = EventNotification<typeof EventMethod.TASK_UPDATED>;

/**
 * Agent connected notification
 */
export type AgentConnectedNotification = EventNotification<typeof EventMethod.AGENT_CONNECTED>;

/**
 * Agent disconnected notification
 */
export type AgentDisconnectedNotification = EventNotification<
  typeof EventMethod.AGENT_DISCONNECTED
>;

/**
 * Agent heartbeat notification
 */
export type AgentHeartbeatNotification = EventNotification<typeof EventMethod.AGENT_HEARTBEAT>;
