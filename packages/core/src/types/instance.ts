/**
 * Possible states of a Claude Code instance
 * - 'disconnected' is a derived status when agent is offline (can't confirm real status)
 * - 'sleeping' is when instance went idle and process was closed (can resume with SDK session)
 */
export type InstanceStatus = 'starting' | 'running' | 'stopping' | 'stopped' | 'error' | 'disconnected' | 'sleeping';

/**
 * Permission modes for Claude Code instances
 * Matches SDK's PermissionMode type
 */
export type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'delegate' | 'dontAsk';

/**
 * Represents a running or stopped Claude Code session.
 * Instances are the actual Claude Code processes managed by machines.
 *
 * An instance is tied to a machine (via machineId) for its entire lifecycle.
 * The machineId is stable and never changes - it's the routing key.
 */
export interface Instance {
  /** Unique identifier for the instance */
  id: string;

  /** Agent service's internal session ID (for tracking) */
  sessionId?: string;

  /** Claude SDK's session ID (for resume) */
  sdkSessionId?: string;

  /** Project this instance belongs to (if any) */
  projectId?: string;

  /**
   * Machine running this instance (stable, hardware-derived).
   * This is the routing key - used to find the WebSocket connection.
   */
  machineId: string;

  /** Current working directory */
  cwd: string;

  /** Current status of the instance */
  status: InstanceStatus;

  /** Model being used (e.g., 'claude-sonnet-4-20250514') */
  model?: string;

  /** Permission mode for the instance */
  permissionMode?: PermissionMode;

  /** Last prompt sent to the instance */
  lastPrompt?: string;

  /** Total cost incurred by this instance (USD) */
  totalCostUsd?: number;

  /** When the instance was created */
  createdAt: Date;

  /** When the instance was stopped (if stopped) */
  stoppedAt?: Date;
}

/**
 * Data required to spawn a new instance
 */
export interface SpawnInstanceData {
  /**
   * Machine to spawn the instance on (stable, hardware-derived).
   * Required - instances must be tied to a machine.
   */
  machineId: string;
  cwd: string;
  projectId?: string;
  model?: string;
  permissionMode?: PermissionMode;
  initialPrompt?: string;
  systemPrompt?: string;
  envVars?: Record<string, string>;
}

/**
 * Data for updating an existing instance
 */
export interface UpdateInstanceData {
  sessionId?: string;
  sdkSessionId?: string;
  status?: InstanceStatus;
  lastPrompt?: string;
  totalCostUsd?: number;
  stoppedAt?: Date;
}

/**
 * Statistics about an instance's usage
 */
export interface InstanceStats {
  /** Total messages sent */
  messageCount: number;

  /** Total tokens used */
  totalTokens: number;

  /** Total cost (USD) */
  totalCostUsd: number;

  /** Duration in milliseconds */
  durationMs: number;
}
