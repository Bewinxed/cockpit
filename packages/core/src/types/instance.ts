/**
 * Possible states of a Claude Code instance
 */
export type InstanceStatus = 'starting' | 'running' | 'stopping' | 'stopped' | 'error';

/**
 * Permission modes for Claude Code instances
 */
export type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions';

/**
 * Represents a running or stopped Claude Code session.
 * Instances are the actual Claude Code processes managed by agents.
 */
export interface Instance {
  /** Unique identifier for the instance */
  id: string;

  /** Claude Code's internal session ID (if available) */
  sessionId?: string;

  /** Project this instance belongs to (if any) */
  projectId?: string;

  /** Agent running this instance */
  agentId: string;

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
  agentId: string;
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
