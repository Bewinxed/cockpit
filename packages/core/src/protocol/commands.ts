import type { PermissionMode } from '../types/instance.js';
import type { JsonRpcRequest } from './messages.js';

/**
 * All available command method names (Hub -> Agent)
 */
export const CommandMethod = {
  /** Spawn a new Claude Code instance */
  INSTANCE_SPAWN: 'instance.spawn',
  /** Stop a running instance */
  INSTANCE_STOP: 'instance.stop',
  /** Send a message to an instance */
  INSTANCE_SEND: 'instance.send',
  /** Request agent status */
  AGENT_STATUS: 'agent.status',
  /** Ping the agent */
  AGENT_PING: 'agent.ping',
} as const;

export type CommandMethodValue = (typeof CommandMethod)[keyof typeof CommandMethod];

// ============================================================================
// Command Parameters
// ============================================================================

/**
 * Parameters for spawning a new Claude Code instance
 */
export interface SpawnInstanceParams {
  /** Working directory for the instance */
  cwd: string;
  /** Project to associate with (optional) */
  projectId?: string;
  /** Model to use (e.g., 'claude-sonnet-4-20250514') */
  model?: string;
  /** Permission mode */
  permissionMode?: PermissionMode;
  /** Initial prompt to send on startup */
  initialPrompt?: string;
  /** Custom system prompt additions */
  systemPrompt?: string;
  /** Environment variables to set */
  envVars?: Record<string, string>;
  /** Resume a previous session by ID */
  resumeSessionId?: string;
}

/**
 * Parameters for stopping an instance
 */
export interface StopInstanceParams {
  /** ID of the instance to stop */
  instanceId: string;
  /** Whether to force stop (SIGKILL vs SIGTERM) */
  force?: boolean;
}

/**
 * Parameters for sending a message to an instance
 */
export interface SendMessageParams {
  /** ID of the instance to send to */
  instanceId: string;
  /** Message content to send */
  message: string;
  /** Optional images to include (base64 encoded) */
  images?: string[];
}

/**
 * Parameters for agent status request (empty)
 */
export interface AgentStatusParams {
  /** Request detailed status info */
  detailed?: boolean;
}

/**
 * Parameters for agent ping (empty)
 */
export interface AgentPingParams {
  /** Optional timestamp for latency measurement */
  timestamp?: number;
}

// ============================================================================
// Command Results
// ============================================================================

/**
 * Result of spawning an instance
 */
export interface SpawnInstanceResult {
  /** ID of the created instance */
  instanceId: string;
  /** Session ID from Claude Code */
  sessionId?: string;
}

/**
 * Result of stopping an instance
 */
export interface StopInstanceResult {
  /** Whether the stop was successful */
  success: boolean;
  /** Final status of the instance */
  finalStatus: string;
}

/**
 * Result of sending a message
 */
export interface SendMessageResult {
  /** Whether the message was sent */
  success: boolean;
  /** Any immediate response or acknowledgment */
  acknowledgment?: string;
}

/**
 * Result of agent status request
 */
export interface AgentStatusResult {
  /** Agent ID */
  agentId: string;
  /** Current status */
  status: 'online' | 'offline';
  /** Number of running instances */
  instanceCount: number;
  /** System load (0-1) */
  load?: number;
  /** Available memory in bytes */
  availableMemory?: number;
  /** Uptime in milliseconds */
  uptimeMs?: number;
}

/**
 * Result of agent ping
 */
export interface AgentPingResult {
  /** Pong response */
  pong: true;
  /** Echo back timestamp if provided */
  timestamp?: number;
  /** Server timestamp */
  serverTimestamp: number;
}

// ============================================================================
// Command Type Mapping
// ============================================================================

/**
 * Maps command methods to their parameter types
 */
export interface CommandParamsMap {
  [CommandMethod.INSTANCE_SPAWN]: SpawnInstanceParams;
  [CommandMethod.INSTANCE_STOP]: StopInstanceParams;
  [CommandMethod.INSTANCE_SEND]: SendMessageParams;
  [CommandMethod.AGENT_STATUS]: AgentStatusParams;
  [CommandMethod.AGENT_PING]: AgentPingParams;
}

/**
 * Maps command methods to their result types
 */
export interface CommandResultMap {
  [CommandMethod.INSTANCE_SPAWN]: SpawnInstanceResult;
  [CommandMethod.INSTANCE_STOP]: StopInstanceResult;
  [CommandMethod.INSTANCE_SEND]: SendMessageResult;
  [CommandMethod.AGENT_STATUS]: AgentStatusResult;
  [CommandMethod.AGENT_PING]: AgentPingResult;
}

// ============================================================================
// Typed Command Requests
// ============================================================================

/**
 * Typed command request
 */
export type CommandRequest<M extends CommandMethodValue = CommandMethodValue> = JsonRpcRequest<
  M extends keyof CommandParamsMap ? CommandParamsMap[M] : unknown
> & {
  method: M;
};

/**
 * Spawn instance command
 */
export type SpawnInstanceCommand = CommandRequest<typeof CommandMethod.INSTANCE_SPAWN>;

/**
 * Stop instance command
 */
export type StopInstanceCommand = CommandRequest<typeof CommandMethod.INSTANCE_STOP>;

/**
 * Send message command
 */
export type SendMessageCommand = CommandRequest<typeof CommandMethod.INSTANCE_SEND>;

/**
 * Agent status command
 */
export type AgentStatusCommand = CommandRequest<typeof CommandMethod.AGENT_STATUS>;

/**
 * Agent ping command
 */
export type AgentPingCommand = CommandRequest<typeof CommandMethod.AGENT_PING>;
