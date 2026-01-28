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
  /** Interrupt current operation on an instance */
  INSTANCE_INTERRUPT: 'instance.interrupt',
  /** Get status of a specific instance */
  INSTANCE_STATUS: 'instance.status',
  /** Rewind files to a previous message state */
  INSTANCE_REWIND: 'instance.rewind',
  /** Request agent status */
  AGENT_STATUS: 'agent.status',
  /** Ping the agent */
  AGENT_PING: 'agent.ping',
  /** List filesystem directory */
  FILESYSTEM_LIST: 'filesystem.list',
  /** List available commands for an instance */
  COMMANDS_LIST: 'commands.list',
  /** List available models for an instance */
  MODELS_LIST: 'models.list',
  /** Set model for an instance */
  MODELS_SET: 'models.set',
  /** Get Claude CLI version */
  CLAUDE_VERSION: 'claude.version',
  /** Read a memory file (CLAUDE.md) */
  MEMORY_READ: 'memory.read',
  /** Write a memory file (CLAUDE.md) */
  MEMORY_WRITE: 'memory.write',
  /** Set thinking mode on an instance */
  THINKING_SET: 'thinking.set',
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
  /** Instance ID (assigned by hub for coordination) */
  instanceId?: string;
  /** Session ID for tracking */
  sessionId?: string;
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
  /** Message UUID to resume from (discards subsequent messages) */
  resumeFromMessageId?: string;
  /** Fork to a new session ID when resuming */
  forkSession?: boolean;
  /** Enable file checkpointing for rewind functionality */
  enableFileCheckpointing?: boolean;
  /** MCP servers to connect */
  mcpServers?: Array<{
    name: string;
    command: string;
    args?: string[];
    env?: Record<string, string>;
  }>;
  /** Maximum tokens for response */
  maxTokens?: number;
  /** Whether to allow extended thinking (default: true) */
  allowThinking?: boolean;
  /** Max agentic turns before stopping */
  maxTurns?: number;
  /** Max budget in USD */
  maxBudgetUsd?: number;
  /** Whitelist of allowed tools */
  allowedTools?: string[];
  /** Blacklist of disallowed tools */
  disallowedTools?: string[];
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
 * Parameters for interrupting an instance
 */
export interface InterruptInstanceParams {
  /** ID of the instance to interrupt */
  instanceId: string;
}

/**
 * Parameters for getting instance status
 */
export interface InstanceStatusParams {
  /** ID of the instance to get status for */
  instanceId: string;
}

/**
 * Parameters for rewinding files to a previous message state
 */
export interface RewindFilesParams {
  /** ID of the instance */
  instanceId: string;
  /** UUID of the user message to rewind to */
  userMessageId: string;
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

/**
 * Parameters for listing filesystem directory
 */
export interface FilesystemListParams {
  /** Directory path to list (defaults to home directory) */
  path?: string;
}

/**
 * Parameters for listing available commands
 */
export interface CommandsListParams {
  /** Instance ID to get commands for */
  instanceId: string;
  /** Working directory to discover commands from */
  cwd: string;
}

/**
 * Parameters for listing available models
 */
export interface ModelsListParams {
  /** Instance ID to get models for */
  instanceId: string;
}

/**
 * Parameters for setting the model on an instance
 */
export interface ModelsSetParams {
  /** Instance ID to set model for */
  instanceId: string;
  /** Model identifier to set (e.g., 'claude-sonnet-4-20250514') */
  model: string;
}

/**
 * Parameters for getting Claude CLI version
 */
export type ClaudeVersionParams = Record<string, never>;

/**
 * Parameters for reading a memory file
 */
export interface MemoryReadParams {
  /** Type of memory file to read */
  type: 'project' | 'user';
  /** Working directory (for project memory) */
  cwd?: string;
}

/**
 * Parameters for writing a memory file
 */
export interface MemoryWriteParams {
  /** Type of memory file to write */
  type: 'project' | 'user';
  /** Content to write */
  content: string;
  /** Working directory (for project memory) */
  cwd?: string;
}

/**
 * Thinking mode: off (0 tokens), think (default), ultrathink (max budget)
 */
export type ThinkingMode = 'off' | 'think' | 'ultrathink';

/**
 * Parameters for setting thinking mode on an instance
 */
export interface ThinkingSetParams {
  /** Instance ID to set thinking mode for */
  instanceId: string;
  /** Thinking mode to set */
  mode: ThinkingMode;
}

/**
 * A filesystem entry (file or directory)
 */
export interface FilesystemEntry {
  /** Entry name */
  name: string;
  /** Full path */
  path: string;
  /** Whether this is a directory */
  isDirectory: boolean;
  /** Whether this is a symlink */
  isSymlink?: boolean;
  /** File size in bytes (for files only) */
  size?: number;
  /** Last modified timestamp */
  modifiedAt?: string;
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
 * Result of interrupting an instance
 */
export interface InterruptInstanceResult {
  /** Whether the interrupt was successful */
  success: boolean;
  /** SDK session ID for potential resume */
  sdkSessionId?: string;
}

/**
 * Result of rewinding files
 */
export interface RewindFilesResult {
  /** Whether the rewind was successful */
  success: boolean;
}

/**
 * Result of agent status request
 */
export interface AgentStatusResult {
  /** Machine ID (stable, hardware-derived) */
  machineId: string;
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

/**
 * Result of filesystem list
 */
export interface FilesystemListResult {
  /** Current directory path */
  path: string;
  /** Parent directory path (null if at root) */
  parent: string | null;
  /** List of entries in the directory */
  entries: FilesystemEntry[];
  /** Home directory path */
  home: string;
}

/**
 * An available command
 */
export interface AvailableCommand {
  /** Command name (e.g., '/help', '/my-command') */
  name: string;
  /** Type of command */
  type: 'builtin' | 'custom' | 'skill' | 'mcp';
  /** Description of the command */
  description?: string;
  /** Source file for custom commands */
  source?: string;
}

/**
 * Result of commands list
 */
export interface CommandsListResult {
  /** List of available commands */
  commands: AvailableCommand[];
}

/**
 * Information about an available model
 */
export interface ModelInfo {
  /** Model identifier to use in API calls */
  value: string;
  /** Human-readable display name */
  displayName: string;
  /** Description of the model's capabilities */
  description: string;
}

/**
 * Result of models list
 */
export interface ModelsListResult {
  /** List of available models */
  models: ModelInfo[];
  /** Currently selected model */
  currentModel?: string;
}

/**
 * Result of setting a model
 */
export interface ModelsSetResult {
  /** Whether the model was set successfully */
  success: boolean;
  /** The model that was set */
  model: string;
}

/**
 * Result of getting Claude CLI version
 */
export interface ClaudeVersionResult {
  /** Claude CLI version string (e.g., '2.0.55') */
  version: string;
}

/**
 * Result of reading a memory file
 */
export interface MemoryReadResult {
  /** The memory file content */
  content: string;
  /** The path to the memory file */
  path: string;
  /** Whether the file exists */
  exists: boolean;
}

/**
 * Result of writing a memory file
 */
export interface MemoryWriteResult {
  /** Whether the write was successful */
  success: boolean;
  /** The path to the memory file */
  path: string;
}

/**
 * Result of setting thinking mode
 */
export interface ThinkingSetResult {
  /** Whether the change was successful */
  success: boolean;
  /** The active thinking mode */
  mode: ThinkingMode;
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
  [CommandMethod.INSTANCE_INTERRUPT]: InterruptInstanceParams;
  [CommandMethod.INSTANCE_REWIND]: RewindFilesParams;
  [CommandMethod.AGENT_STATUS]: AgentStatusParams;
  [CommandMethod.AGENT_PING]: AgentPingParams;
  [CommandMethod.FILESYSTEM_LIST]: FilesystemListParams;
  [CommandMethod.COMMANDS_LIST]: CommandsListParams;
  [CommandMethod.MODELS_LIST]: ModelsListParams;
  [CommandMethod.MODELS_SET]: ModelsSetParams;
  [CommandMethod.CLAUDE_VERSION]: ClaudeVersionParams;
  [CommandMethod.MEMORY_READ]: MemoryReadParams;
  [CommandMethod.MEMORY_WRITE]: MemoryWriteParams;
  [CommandMethod.THINKING_SET]: ThinkingSetParams;
}

/**
 * Maps command methods to their result types
 */
export interface CommandResultMap {
  [CommandMethod.INSTANCE_SPAWN]: SpawnInstanceResult;
  [CommandMethod.INSTANCE_STOP]: StopInstanceResult;
  [CommandMethod.INSTANCE_SEND]: SendMessageResult;
  [CommandMethod.INSTANCE_INTERRUPT]: InterruptInstanceResult;
  [CommandMethod.INSTANCE_REWIND]: RewindFilesResult;
  [CommandMethod.AGENT_STATUS]: AgentStatusResult;
  [CommandMethod.AGENT_PING]: AgentPingResult;
  [CommandMethod.FILESYSTEM_LIST]: FilesystemListResult;
  [CommandMethod.COMMANDS_LIST]: CommandsListResult;
  [CommandMethod.MODELS_LIST]: ModelsListResult;
  [CommandMethod.MODELS_SET]: ModelsSetResult;
  [CommandMethod.CLAUDE_VERSION]: ClaudeVersionResult;
  [CommandMethod.MEMORY_READ]: MemoryReadResult;
  [CommandMethod.MEMORY_WRITE]: MemoryWriteResult;
  [CommandMethod.THINKING_SET]: ThinkingSetResult;
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
 * Interrupt instance command
 */
export type InterruptInstanceCommand = CommandRequest<typeof CommandMethod.INSTANCE_INTERRUPT>;

/**
 * Agent status command
 */
export type AgentStatusCommand = CommandRequest<typeof CommandMethod.AGENT_STATUS>;

/**
 * Agent ping command
 */
export type AgentPingCommand = CommandRequest<typeof CommandMethod.AGENT_PING>;

/**
 * Commands list command
 */
export type CommandsListCommand = CommandRequest<typeof CommandMethod.COMMANDS_LIST>;
