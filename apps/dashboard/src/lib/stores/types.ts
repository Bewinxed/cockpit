// Shared types for real-time stores
// Extracted from realtime.svelte.ts for use across entity stores

export interface Agent {
  machineId: string;
  name: string;
  os: 'darwin' | 'linux' | 'windows';
  status: 'online' | 'reconnecting' | 'offline';
  instances: number;
  ip: string;
  connectedAt?: Date;
  lastPing?: Date;
}

export interface Instance {
  id: string;
  name: string;
  status: 'starting' | 'running' | 'stopping' | 'stopped' | 'sleeping' | 'error' | 'disconnected';
  agent: string;
  machineId: string;
  project: string | null;
  projectId: string | null;
  lastActivity: string;
  cwd: string;
  model?: string;
  totalCostUsd?: number;
}

export interface Project {
  id: string;
  name: string;
  description?: string;
  rootPath?: string;
  machineId?: string;
  instanceCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface Task {
  id: string;
  instanceId: string;
  projectId?: string;
  parentTaskId?: string;
  title: string;
  description: string;
  type: 'major' | 'minor';
  status: 'in_progress' | 'completed' | 'blocked' | 'cancelled';
  progress: number;
  startedAt: Date;
  completedAt?: Date;
  updatedAt?: Date;
}

export interface Message {
  id?: string;
  instanceId: string;
  type: 'assistant' | 'user' | 'system' | 'tool_use' | 'tool_result' | 'error' | 'hook_response' | 'command_output' | 'help_menu' | 'thinking' | 'result_error';
  content: string;
  timestamp: Date;
  /** SDK message UUID - used for resumeSessionAt when editing */
  sdkUuid?: string;
  /** Links to the Task tool_use that spawned this message (for subagent messages) */
  parentToolUseId?: string;
  // Metadata for richer rendering
  metadata?: MessageMetadata;
}

export interface MessageMetadata {
  // For tool_use messages
  toolId?: string;
  toolName?: string;
  toolInput?: unknown;
  toolResult?: unknown;
  toolStatus?: 'pending' | 'success' | 'error';
  // For system messages
  subtype?: 'init' | 'compact_boundary' | 'status' | 'hook_response' | 'login_prompt' | 'auth_required' | 'model_picker' | 'memory_info' | 'vim_info' | 'terminal_setup_info' | 'memory_picker' | 'ask_question';
  // For command_output messages
  command?: string;
  model?: string;
  cwd?: string;
  tools?: string[];
  sessionId?: string;
  // For compact_boundary
  preTokens?: number;
  trigger?: 'manual' | 'auto';
  // For hook_response
  hookName?: string;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  // For login_prompt
  authUrl?: string;
  oauthState?: string;
  // For model_picker
  loading?: boolean;
  error?: string;
  models?: Array<{ value: string; displayName: string; description: string }>;
  currentModel?: string;
  selectedModel?: string;
  // For memory_picker
  memoryPhase?: 'selection' | 'editing';
  selectedMemoryType?: 'project' | 'user';
  memoryContent?: string;
  memoryPath?: string;
  // For ask_question (AskUserQuestion tool)
  questionRequestId?: string;
  questions?: Array<{
    question: string;
    header: string;
    options: Array<{ label: string; description: string }>;
    multiSelect: boolean;
  }>;
  questionAnswers?: Record<string, string>;
  // For help_menu
  version?: string;
  commands?: Array<{ name: string; description?: string; type: 'builtin' | 'custom' | 'skill' | 'mcp' }>;
  // For thinking blocks
  thinking?: string;
  thinkingSignature?: string;
  isRedactedThinking?: boolean;
  // For result error messages
  resultSubtype?: 'error_max_turns' | 'error_during_execution' | 'error_max_budget_usd' | 'error_max_structured_output_retries';
  resultErrors?: string[];
  totalCost?: number;
  numTurns?: number;
  // For system init messages - MCP server status
  mcpServers?: Array<{ name: string; status: string }>;
  // For Task tool_use messages (subagent spawning)
  subagentType?: string;
  subagentDescription?: string;
}

export interface StreamingState {
  instanceId: string;
  isStreaming: boolean;
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

export interface PermissionRequest {
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

/**
 * State for tracking active subagents (spawned via Task tool).
 * Used for the Mission Control tree visualization.
 */
export interface SubagentState {
  /** The Task tool_use ID that spawned this subagent */
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
