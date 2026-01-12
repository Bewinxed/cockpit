import { writable, derived, get, type Writable, type Readable } from 'svelte/store';
import { api } from '$lib/api';

// Types for real-time data
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
  title: string;
  description: string;
  type: 'major' | 'minor';
  status: 'in_progress' | 'completed' | 'blocked' | 'cancelled';
  progress: number;
  startedAt: Date;
  completedAt?: Date;
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
  metadata?: {
    // For tool_use messages
    toolId?: string;
    toolName?: string;
    toolInput?: unknown;
    toolResult?: unknown;
    toolStatus?: 'pending' | 'success' | 'error';
    // For system messages
    subtype?: 'init' | 'compact_boundary' | 'status' | 'hook_response' | 'login_prompt' | 'auth_required' | 'model_picker' | 'memory_info' | 'vim_info' | 'terminal_setup_info' | 'memory_picker';
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
  };
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
}

// Stores
export const agents: Writable<Map<string, Agent>> = writable(new Map());
export const instances: Writable<Map<string, Instance>> = writable(new Map());
export const pendingPermissions: Writable<Map<string, PermissionRequest>> = writable(new Map());
export const projects: Writable<Map<string, Project>> = writable(new Map());
export const tasks: Writable<Map<string, Task>> = writable(new Map());
export const streamingStates: Writable<Map<string, StreamingState>> = writable(new Map());

// Transient instance status (compacting, etc.) - NOT stored in messages
export const instanceStatuses: Writable<Map<string, string | null>> = writable(new Map());

// Messages stored per-instance for better organization
export const instanceMessages: Writable<Map<string, Message[]>> = writable(new Map());

// Streaming messages - partial text being received per instance
export const streamingMessages: Writable<Map<string, StreamingMessage>> = writable(new Map());

// Active subagents - keyed by toolUseId
export const activeSubagents: Writable<Map<string, SubagentState>> = writable(new Map());

// Helper to get messages for a specific instance (for backwards compatibility)
export const messages: Readable<Message[]> = derived(instanceMessages, ($instanceMessages) =>
  Array.from($instanceMessages.values()).flat().sort((a, b) =>
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  )
);

// Get messages for a specific instance
export function getInstanceMessages(instanceId: string): Readable<Message[]> {
  return derived(instanceMessages, ($instanceMessages) => $instanceMessages.get(instanceId) || []);
}

// Add a message to an instance
export function addMessage(instanceId: string, message: Omit<Message, 'instanceId'>): void {
  instanceMessages.update((map) => {
    const msgs = map.get(instanceId) || [];
    // Ensure message has an ID for animations
    const msgWithId = {
      ...message,
      instanceId,
      id: message.id || crypto.randomUUID()
    };
    // Keep last 500 messages per instance
    const newMsgs = [...msgs, msgWithId].slice(-500);
    map.set(instanceId, newMsgs);
    return map;
  });
}

// Remove a message from an instance by index
export function removeMessage(instanceId: string, index: number): void {
  instanceMessages.update((map) => {
    const msgs = map.get(instanceId) || [];
    if (index >= 0 && index < msgs.length) {
      const newMsgs = [...msgs.slice(0, index), ...msgs.slice(index + 1)];
      map.set(instanceId, newMsgs);
    }
    return map;
  });
}

// Update a tool message with its result (by toolId)
export function updateToolResult(instanceId: string, toolId: string, result: unknown, isError = false): void {
  instanceMessages.update((map) => {
    const msgs = map.get(instanceId) || [];
    const updated = msgs.map((msg) => {
      if (msg.type === 'tool_use' && msg.metadata?.toolId === toolId) {
        return {
          ...msg,
          metadata: {
            ...msg.metadata,
            toolResult: result,
            toolStatus: isError ? 'error' as const : 'success' as const,
          },
        };
      }
      return msg;
    });
    map.set(instanceId, updated);
    return map;
  });
}

// Clear messages for an instance
export function clearInstanceMessages(instanceId: string): void {
  instanceMessages.update((map) => {
    map.delete(instanceId);
    return map;
  });
}

// Update metadata on a specific message by index
export function updateMessageMetadata(instanceId: string, index: number, metadata: Record<string, unknown>): void {
  instanceMessages.update((map) => {
    const messages = map.get(instanceId);
    if (messages && messages[index]) {
      const updatedMessages = [...messages];
      updatedMessages[index] = {
        ...messages[index],
        metadata: {
          ...messages[index].metadata,
          ...metadata,
        },
      };
      map.set(instanceId, updatedMessages);
    }
    return map;
  });
}

// Update metadata on a specific message by ID
export function updateMessageMetadataById(instanceId: string, messageId: string, metadata: Record<string, unknown>): void {
  instanceMessages.update((map) => {
    const messages = map.get(instanceId);
    if (messages) {
      const index = messages.findIndex(m => m.id === messageId);
      if (index !== -1) {
        const updatedMessages = [...messages];
        updatedMessages[index] = {
          ...messages[index],
          metadata: {
            ...messages[index].metadata,
            ...metadata,
          },
        };
        map.set(instanceId, updatedMessages);
      }
    }
    return map;
  });
}

// Get a message by ID
export function getMessageById(instanceId: string, messageId: string): Message | undefined {
  const messages = get(instanceMessages).get(instanceId);
  return messages?.find(m => m.id === messageId);
}

// Update sdkUuid on a user message by matching content (for optimistic updates)
// Returns true if a message was updated, false if no matching message found
export function updateUserMessageUuid(instanceId: string, content: string, sdkUuid: string): boolean {
  let found = false;
  instanceMessages.update((map) => {
    const messages = map.get(instanceId);
    if (!messages) return map;

    // Find the most recent user message with matching content that doesn't have a UUID yet
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.type === 'user' && msg.content === content && !msg.sdkUuid) {
        const updatedMessages = [...messages];
        updatedMessages[i] = { ...msg, sdkUuid };
        map.set(instanceId, updatedMessages);
        found = true;
        break;
      }
    }
    return map;
  });
  return found;
}

// Get streaming state for an instance
export function getStreamingState(instanceId: string): Readable<StreamingState | null> {
  return derived(streamingStates, ($states) => $states.get(instanceId) || null);
}

// Update streaming state
export function updateStreamingState(instanceId: string, update: Partial<StreamingState>): void {
  streamingStates.update((map) => {
    const existing = map.get(instanceId) || {
      instanceId,
      isStreaming: false,
      inputTokens: 0,
      outputTokens: 0,
      sessionInputTokens: 0,
      sessionOutputTokens: 0,
      costUsd: 0,
      lastUpdate: new Date(),
    };
    map.set(instanceId, { ...existing, ...update, lastUpdate: new Date() });
    return map;
  });
}

// Clear streaming state for an instance
export function clearStreamingState(instanceId: string): void {
  streamingStates.update((map) => {
    map.delete(instanceId);
    return map;
  });
}

// ========================================
// STREAMING MESSAGE FUNCTIONS
// ========================================

// Get streaming message for an instance
export function getStreamingMessage(instanceId: string): Readable<StreamingMessage | null> {
  return derived(streamingMessages, ($msgs) => $msgs.get(instanceId) || null);
}

// Get the accumulated text from a streaming message
export function getStreamingText(instanceId: string): string {
  const msg = get(streamingMessages).get(instanceId);
  if (!msg) return '';
  // Combine all content blocks in order
  const texts: string[] = [];
  const sortedIndices = Array.from(msg.contentBlocks.keys()).sort((a, b) => a - b);
  for (const idx of sortedIndices) {
    texts.push(msg.contentBlocks.get(idx) || '');
  }
  return texts.join('');
}

// Initialize a streaming message when content_block_start is received
export function initStreamingMessage(instanceId: string, sdkUuid?: string): void {
  streamingMessages.update((map) => {
    // Only create a new streaming message if one doesn't exist
    if (!map.has(instanceId)) {
      map.set(instanceId, {
        instanceId,
        contentBlocks: new Map(),
        isComplete: false,
        sdkUuid,
        startedAt: new Date(),
      });
    } else if (sdkUuid) {
      // Update UUID if provided
      const existing = map.get(instanceId)!;
      map.set(instanceId, { ...existing, sdkUuid });
    }
    return map;
  });
}

// Initialize a content block within a streaming message
export function initStreamingBlock(instanceId: string, index: number, contentBlock: { type: string }): void {
  streamingMessages.update((map) => {
    const msg = map.get(instanceId);
    if (msg && contentBlock.type === 'text') {
      msg.contentBlocks.set(index, '');
    }
    return map;
  });
}

// Append text to a streaming content block
export function appendStreamingText(instanceId: string, index: number, text: string): void {
  streamingMessages.update((map) => {
    const msg = map.get(instanceId);
    if (msg) {
      const existing = msg.contentBlocks.get(index) || '';
      msg.contentBlocks.set(index, existing + text);
    }
    return map;
  });
}

// Finalize a content block (content_block_stop)
export function finalizeStreamingBlock(instanceId: string, index: number): void {
  // Currently a no-op, but could be used for cleanup or marking blocks complete
}

// Finalize streaming message (message_stop) - converts to final message
export function finalizeStreamingMessage(instanceId: string): void {
  const msg = get(streamingMessages).get(instanceId);
  if (msg && msg.contentBlocks.size > 0) {
    // Get the accumulated text
    const text = getStreamingText(instanceId);
    if (text.trim()) {
      // Add as a final assistant message
      addMessage(instanceId, {
        type: 'assistant',
        content: text,
        timestamp: msg.startedAt,
        sdkUuid: msg.sdkUuid,
      });
    }
  }
  // Clear the streaming message
  clearStreamingMessage(instanceId);
}

// Clear streaming message for an instance
export function clearStreamingMessage(instanceId: string): void {
  streamingMessages.update((map) => {
    map.delete(instanceId);
    return map;
  });
}

// ============================================================================
// Subagent Management (Mission Control)
// ============================================================================

/**
 * Start tracking a new subagent (called when Task tool_use is detected).
 */
export function startSubagent(
  toolUseId: string,
  instanceId: string,
  subagentType: string,
  description?: string,
  parentSubagentId?: string
): void {
  activeSubagents.update((map) => {
    map.set(toolUseId, {
      toolUseId,
      instanceId,
      subagentType,
      description,
      status: 'starting',
      startedAt: new Date(),
      parentSubagentId,
      messages: [],
    });
    return map;
  });
}

/**
 * Update subagent status to running.
 */
export function setSubagentRunning(toolUseId: string): void {
  activeSubagents.update((map) => {
    const subagent = map.get(toolUseId);
    if (subagent) {
      subagent.status = 'running';
    }
    return map;
  });
}

/**
 * Complete a subagent with result.
 */
export function completeSubagent(toolUseId: string, result?: string): void {
  activeSubagents.update((map) => {
    const subagent = map.get(toolUseId);
    if (subagent) {
      subagent.status = 'complete';
      subagent.completedAt = new Date();
      subagent.result = result;
    }
    return map;
  });
}

/**
 * Mark subagent as errored.
 */
export function errorSubagent(toolUseId: string, error: string): void {
  activeSubagents.update((map) => {
    const subagent = map.get(toolUseId);
    if (subagent) {
      subagent.status = 'error';
      subagent.completedAt = new Date();
      subagent.error = error;
    }
    return map;
  });
}

/**
 * Add a message to a subagent's message list.
 */
export function addSubagentMessage(toolUseId: string, message: Message): void {
  activeSubagents.update((map) => {
    const subagent = map.get(toolUseId);
    if (subagent) {
      subagent.messages.push(message);
    }
    return map;
  });
}

/**
 * Get all subagents for a specific instance.
 */
export function getInstanceSubagents(instanceId: string): Readable<SubagentState[]> {
  return derived(activeSubagents, ($subagents) =>
    Array.from($subagents.values()).filter((s) => s.instanceId === instanceId)
  );
}

/**
 * Get active (non-complete) subagents for an instance.
 */
export function getActiveInstanceSubagents(instanceId: string): Readable<SubagentState[]> {
  return derived(activeSubagents, ($subagents) =>
    Array.from($subagents.values()).filter(
      (s) => s.instanceId === instanceId && (s.status === 'starting' || s.status === 'running')
    )
  );
}

/**
 * Get a specific subagent by toolUseId.
 */
export function getSubagent(toolUseId: string): Readable<SubagentState | null> {
  return derived(activeSubagents, ($subagents) => $subagents.get(toolUseId) || null);
}

/**
 * Get child subagents (nested subagents spawned by a parent subagent).
 */
export function getChildSubagents(parentToolUseId: string): Readable<SubagentState[]> {
  return derived(activeSubagents, ($subagents) =>
    Array.from($subagents.values()).filter((s) => s.parentSubagentId === parentToolUseId)
  );
}

/**
 * Clear all subagents for an instance (e.g., when conversation is cleared).
 */
export function clearInstanceSubagents(instanceId: string): void {
  activeSubagents.update((map) => {
    for (const [toolUseId, subagent] of map.entries()) {
      if (subagent.instanceId === instanceId) {
        map.delete(toolUseId);
      }
    }
    return map;
  });
}

/**
 * Extract readable text from tool result content.
 * Handles string, array of content blocks, or falls back to JSON.stringify.
 */
function extractResultText(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    // Handle array of content blocks (common for tool results)
    return content
      .map((block: unknown) => {
        if (typeof block === 'string') return block;
        if (block && typeof block === 'object' && 'type' in block) {
          const b = block as { type: string; text?: string };
          if (b.type === 'text' && b.text) return b.text;
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return JSON.stringify(content);
}

/**
 * Reconstruct subagent state from message history.
 * Called when loading messages from database to restore the subagent tree visualization.
 * This scans for Task tool_use messages and rebuilds SubagentState from the stored data.
 */
export function reconstructSubagentsFromHistory(instanceId: string, messages: Message[]): void {
  // Clear existing subagents for this instance to avoid duplicates
  clearInstanceSubagents(instanceId);

  activeSubagents.update((map) => {
    for (const msg of messages) {
      // Only process Task tool_use messages
      if (msg.type === 'tool_use' && msg.metadata?.toolName === 'Task') {
        const toolId = msg.metadata.toolId as string;
        if (!toolId) continue;

        const toolInput = msg.metadata.toolInput as Record<string, unknown> | undefined;
        const subagentType = (toolInput?.subagent_type as string) || 'unknown';
        const description = toolInput?.description as string | undefined;

        // Determine status from toolStatus metadata
        const toolStatus = msg.metadata?.toolStatus as string | undefined;
        const hasResult = toolStatus !== 'pending' && toolStatus !== undefined;
        const isError = toolStatus === 'error';
        const resultContent = msg.metadata?.toolResult;

        // Create subagent state
        const subagentState: SubagentState = {
          toolUseId: toolId,
          instanceId,
          subagentType,
          description,
          status: hasResult ? (isError ? 'error' : 'complete') : 'running',
          startedAt: msg.timestamp,
          // For historical data, we use the same timestamp (exact completion time not stored)
          completedAt: hasResult ? msg.timestamp : undefined,
          messages: [], // SDK doesn't stream intermediate subagent messages
          result: hasResult && !isError ? extractResultText(resultContent) : undefined,
          error: isError ? extractResultText(resultContent) : undefined,
        };

        map.set(toolId, subagentState);
      }
    }
    return map;
  });
}

// Set/clear transient instance status (compacting, etc.)
export function setInstanceStatus(instanceId: string, status: string | null): void {
  instanceStatuses.update((map) => {
    if (status) {
      map.set(instanceId, status);
    } else {
      map.delete(instanceId);
    }
    return map;
  });
}

// Get transient status for a specific instance
export function getInstanceStatus(instanceId: string): Readable<string | null> {
  return derived(instanceStatuses, ($statuses) => $statuses.get(instanceId) || null);
}

// Add a pending permission request
export function addPermissionRequest(request: PermissionRequest): void {
  pendingPermissions.update((map) => {
    map.set(request.requestId, request);
    return map;
  });
}

// Remove a pending permission request (after response)
export function removePermissionRequest(requestId: string): void {
  pendingPermissions.update((map) => {
    map.delete(requestId);
    return map;
  });
}

// Get pending permission requests for an instance
export function getInstancePermissions(instanceId: string): Readable<PermissionRequest[]> {
  return derived(pendingPermissions, ($permissions) =>
    Array.from($permissions.values()).filter((p) => p.instanceId === instanceId)
  );
}

// Connection state
export const connectionStatus: Writable<'connecting' | 'connected' | 'disconnected' | 'error'> = writable('disconnected');

// Populated instances with agent and project info
export const populatedInstances: Readable<Instance[]> = derived(
  [instances, agents, projects],
  ([$instances, $agents, $projects]) => {
    return Array.from($instances.values()).map((instance) => {
      const agent = $agents.get(instance.machineId);
      const project = instance.projectId ? $projects.get(instance.projectId) : null;
      return {
        ...instance,
        agent: agent?.name || 'Unknown Agent',
        project: project?.name || null,
      };
    });
  }
);

// Derived stores
export const onlineAgents: Readable<Agent[]> = derived(agents, ($agents) =>
  Array.from($agents.values()).filter((a) => a.status === 'online')
);

export const runningInstances: Readable<Instance[]> = derived(populatedInstances, ($instances) =>
  $instances.filter((i) => i.status === 'running' || i.status === 'starting')
);

export const recentInstances: Readable<Instance[]> = derived(populatedInstances, ($instances) =>
  [...$instances]
    .sort((a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime())
    .slice(0, 5)
);

// Ad-hoc instances (no project)
export const adhocInstances: Readable<Instance[]> = derived(populatedInstances, ($instances) =>
  $instances
    .filter((i) => !i.projectId)
    .sort((a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime())
);

// Project instances
export const projectInstances: Readable<Instance[]> = derived(populatedInstances, ($instances) =>
  $instances
    .filter((i) => i.projectId)
    .sort((a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime())
);

export const activeTasks: Readable<Task[]> = derived(tasks, ($tasks) =>
  Array.from($tasks.values()).filter((t) => t.status === 'in_progress')
);

// Stats
export const stats: Readable<{
  totalAgents: number;
  onlineAgents: number;
  totalInstances: number;
  runningInstances: number;
  totalProjects: number;
  activeTasks: number;
  totalCostUsd: number;
}> = derived([agents, instances, projects, tasks], ([$agents, $instances, $projects, $tasks]) => {
  const instancesArray = Array.from($instances.values());
  return {
    totalAgents: $agents.size,
    onlineAgents: Array.from($agents.values()).filter((a) => a.status === 'online').length,
    totalInstances: $instances.size,
    runningInstances: instancesArray.filter((i) => i.status === 'running' || i.status === 'starting').length,
    totalProjects: $projects.size,
    activeTasks: Array.from($tasks.values()).filter((t) => t.status === 'in_progress').length,
    totalCostUsd: instancesArray.reduce((sum, i) => sum + (i.totalCostUsd || 0), 0),
  };
});

// SSE connection
let eventSource: EventSource | null = null;
let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;

export function connect(baseUrl: string = '') {
  if (eventSource) {
    eventSource.close();
  }

  connectionStatus.set('connecting');

  const url = `${baseUrl}/api/events`;
  eventSource = new EventSource(url);

  eventSource.onopen = () => {
    connectionStatus.set('connected');
    reconnectAttempts = 0;
    console.log('[SSE] Connected to hub');
  };

  eventSource.onerror = (error) => {
    console.error('[SSE] Connection error:', error);
    connectionStatus.set('error');
    eventSource?.close();
    eventSource = null;

    // Attempt reconnection with exponential backoff
    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
      reconnectTimeout = setTimeout(() => {
        reconnectAttempts++;
        connect(baseUrl);
      }, delay);
    }
  };

  // Event handlers
  eventSource.addEventListener('connected', (event: Event) => {
    const data = JSON.parse((event as MessageEvent).data);
    console.log('[SSE] Client connected:', data.clientId);
  });

  eventSource.addEventListener('agent:connected', (event: Event) => {
    const agent = JSON.parse((event as MessageEvent).data);
    agents.update((map) => {
      map.set(agent.machineId, {
        ...agent,
        name: agent.hostname,
        status: 'online',
        instances: 0,
      });
      return map;
    });
  });

  eventSource.addEventListener('agent:disconnected', (event: Event) => {
    const { machineId } = JSON.parse((event as MessageEvent).data);
    agents.update((map) => {
      const agent = map.get(machineId);
      if (agent) {
        map.set(machineId, { ...agent, status: 'offline' });
      }
      return map;
    });
  });

  eventSource.addEventListener('agent:reconnecting', (event: Event) => {
    const { machineId } = JSON.parse((event as MessageEvent).data);
    agents.update((map) => {
      const agent = map.get(machineId);
      if (agent) {
        map.set(machineId, { ...agent, status: 'reconnecting' });
      }
      return map;
    });
  });

  eventSource.addEventListener('instance:created', (event: Event) => {
    const instance = JSON.parse((event as MessageEvent).data);
    instances.update((map) => {
      map.set(instance.id, {
        ...instance,
        name: instance.lastPrompt?.slice(0, 50) || 'New Instance',
        agent: '', // Will be resolved from agents store
        lastActivity: new Date().toISOString(),
      });
      return map;
    });
  });

  eventSource.addEventListener('instance:started', (event: Event) => {
    const instance = JSON.parse((event as MessageEvent).data);
    instances.update((map) => {
      const existing = map.get(instance.id);
      if (existing) {
        map.set(instance.id, { ...existing, status: 'running' });
      }
      return map;
    });
  });

  eventSource.addEventListener('instance:stopped', (event: Event) => {
    const { instanceId, instance } = JSON.parse((event as MessageEvent).data);
    instances.update((map) => {
      const existing = map.get(instanceId);
      if (existing) {
        map.set(instanceId, { ...existing, ...instance, status: 'stopped' });
      }
      return map;
    });
  });

  eventSource.addEventListener('instance:sleeping', (event: Event) => {
    const { instanceId, instance } = JSON.parse((event as MessageEvent).data);
    instances.update((map) => {
      const existing = map.get(instanceId);
      if (existing) {
        map.set(instanceId, { ...existing, ...instance, status: 'sleeping' });
      }
      return map;
    });
  });

  eventSource.addEventListener('instance:error', (event: Event) => {
    const { instanceId, instance, error } = JSON.parse((event as MessageEvent).data);
    instances.update((map) => {
      const existing = map.get(instanceId);
      if (existing) {
        map.set(instanceId, { ...existing, ...instance, status: 'error' });
      }
      return map;
    });
    // Check for auth-related errors
    const isAuthError = error?.includes('auth') ||
                        error?.includes('401') ||
                        error?.includes('403') ||
                        error?.includes('token') ||
                        error?.includes('credentials') ||
                        error?.includes('login');

    if (isAuthError) {
      // Dispatch custom event for auth errors - page component will handle login flow
      window.dispatchEvent(new CustomEvent('cockpit:auth-required', { detail: { instanceId, error } }));
    } else {
      // Only add error message for non-auth errors
      addMessage(instanceId, {
        type: 'error',
        content: error || 'An error occurred',
        timestamp: new Date(),
      });
    }
  });

  eventSource.addEventListener('instance:resumed', (event: Event) => {
    const instance = JSON.parse((event as MessageEvent).data);
    if (instance) {
      instances.update((map) => {
        const existing = map.get(instance.id);
        if (existing) {
          map.set(instance.id, { ...existing, ...instance, status: 'starting' });
        }
        return map;
      });
    }
  });

  eventSource.addEventListener('task:created', (event: Event) => {
    const task = JSON.parse((event as MessageEvent).data);
    tasks.update((map) => {
      map.set(task.id, task);
      return map;
    });
  });

  eventSource.addEventListener('task:updated', (event: Event) => {
    const task = JSON.parse((event as MessageEvent).data);
    tasks.update((map) => {
      map.set(task.id, { ...map.get(task.id), ...task });
      return map;
    });
  });

  // Handle permission requests from agents
  eventSource.addEventListener('permission:request', (event: Event) => {
    const request = JSON.parse((event as MessageEvent).data) as PermissionRequest;
    addPermissionRequest(request);
  });

  // Handle token usage updates
  eventSource.addEventListener('instance:token_usage', (event: Event) => {
    const { instanceId, inputTokens, outputTokens, costDelta } = JSON.parse((event as MessageEvent).data);
    updateStreamingState(instanceId, {
      inputTokens,
      outputTokens,
      sessionInputTokens: inputTokens,
      sessionOutputTokens: outputTokens,
      costUsd: costDelta,
      isStreaming: false, // Result received = done streaming
    });

    // Also update instance cost
    instances.update((map) => {
      const instance = map.get(instanceId);
      if (instance) {
        map.set(instanceId, {
          ...instance,
          totalCostUsd: (instance.totalCostUsd || 0) + costDelta,
        });
      }
      return map;
    });
  });

  // Handle SDK messages for streaming state and chat display
  eventSource.addEventListener('sdk:message', (event: Event) => {
    const { instanceId, message } = JSON.parse((event as MessageEvent).data);
    const msg = message as {
      type?: string;
      subtype?: string;
      uuid?: string; // SDK message UUID for resumeSessionAt
      message?: { content?: unknown[] | string; role?: string };
      result?: string;
      isSynthetic?: boolean;
      isReplay?: boolean;
      tool_use_result?: unknown;
      event?: { type?: string }; // For stream_event
      session_id?: string;
      cwd?: string;
      model?: string;
      tools?: string[];
    };

    // Debug: Log all user messages
    if (msg.type === 'user') {
      console.log('[SSE] User message received:', { isReplay: msg.isReplay, uuid: msg.uuid, content: msg.message?.content });
    }

    // Handle replay messages specially
    if (msg.isReplay && msg.type === 'user') {
      // Check if this is a local command output (wrapped in <local-command-stdout> tags)
      const content = msg.message?.content;
      if (typeof content === 'string' && content.includes('<local-command-stdout>')) {
        // Extract the content between tags and display as assistant message
        const match = content.match(/<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/);
        if (match && match[1]?.trim()) {
          addMessage(instanceId, {
            type: 'assistant',
            content: match[1].trim(),
            timestamp: new Date(),
          });
        }
      } else if (msg.uuid) {
        // Try to update an optimistic user message with the UUID from replay
        // This enables editing for messages that were just sent
        let textContent = '';
        if (typeof content === 'string') {
          textContent = content;
        } else if (Array.isArray(content)) {
          for (const block of content) {
            if (block && typeof block === 'object' && 'type' in block) {
              if (block.type === 'text' && 'text' in block) {
                textContent += (block.text as string);
              }
            }
          }
        }
        if (textContent.trim()) {
          updateUserMessageUuid(instanceId, textContent.trim(), msg.uuid);
        }
      }
      // Skip adding replay messages to avoid duplicates (they come from SSR)
      return;
    }

    // ========================================
    // STREAMING STATE
    // ========================================

    // Mark as streaming when receiving assistant or stream_event messages
    if (msg.type === 'assistant' || msg.type === 'stream_event') {
      updateStreamingState(instanceId, { isStreaming: true });
    }

    // Mark as not streaming when result received
    if (msg.type === 'result') {
      updateStreamingState(instanceId, { isStreaming: false });
    }

    // ========================================
    // USER MESSAGES
    // ========================================

    if (msg.type === 'user' && msg.message?.content) {
      const content = msg.message.content;

      // First, always check for tool_result blocks and process them
      // Tool results come as user messages with tool_result content blocks from the SDK
      let hasToolResults = false;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block && typeof block === 'object' && 'type' in block && block.type === 'tool_result') {
            hasToolResults = true;
            const toolResult = block as {
              tool_use_id?: string;
              content?: unknown;
              is_error?: boolean;
            };
            if (toolResult.tool_use_id) {
              updateToolResult(
                instanceId,
                toolResult.tool_use_id,
                toolResult.content,
                toolResult.is_error || false
              );

              // Complete subagent if this was a Task tool result
              const resultText = extractResultText(toolResult.content);
              if (toolResult.is_error) {
                errorSubagent(toolResult.tool_use_id, resultText);
              } else {
                completeSubagent(toolResult.tool_use_id, resultText);
              }
            }
          }
        }
      }

      // Handle synthetic messages with tool_use_result (local commands like /cost, /help)
      if (msg.isSynthetic && msg.tool_use_result) {
        const resultText = typeof msg.tool_use_result === 'string'
          ? msg.tool_use_result
          : JSON.stringify(msg.tool_use_result, null, 2);
        if (resultText.trim()) {
          addMessage(instanceId, {
            type: 'assistant',
            content: resultText.trim(),
            timestamp: new Date(),
          });
        }
      }

      // If this is a tool result message, don't also add it as a user message
      if (hasToolResults) {
        // Tool result messages are internal SDK messages, not user-visible
        return;
      }

      // Real user message - extract text content
      let textContent = '';

      if (typeof content === 'string') {
        textContent = content;
      } else if (Array.isArray(content)) {
        for (const block of content) {
          if (block && typeof block === 'object' && 'type' in block) {
            if (block.type === 'text' && 'text' in block) {
              textContent += (block.text as string);
            }
          }
        }
      }

      if (textContent.trim()) {
        // Try to update an existing optimistic message with UUID first
        // This prevents duplicates when we've added the message optimistically
        const updated = msg.uuid && updateUserMessageUuid(instanceId, textContent.trim(), msg.uuid);

        // Only add if no optimistic message was found to update
        if (!updated) {
          addMessage(instanceId, {
            type: 'user',
            content: textContent.trim(),
            timestamp: new Date(),
            sdkUuid: msg.uuid, // Store SDK UUID for resumeSessionAt
          });
        }
      }
    }

    // ========================================
    // ASSISTANT MESSAGES
    // ========================================

    if (msg.type === 'assistant' && msg.message?.content) {
      const content = msg.message.content;

      // Check if we already have a message with this UUID (from streaming)
      // to avoid duplicates when streaming is enabled
      const existingMessages = get(instanceMessages).get(instanceId) || [];
      const hasExistingMessage = msg.uuid && existingMessages.some(m => m.sdkUuid === msg.uuid);

      if (Array.isArray(content)) {
        for (const block of content) {
          if (block && typeof block === 'object' && 'type' in block) {
            // Text blocks -> assistant message (skip if already added via streaming)
            if (block.type === 'text' && 'text' in block && !hasExistingMessage) {
              addMessage(instanceId, {
                type: 'assistant',
                content: block.text as string,
                timestamp: new Date(),
                sdkUuid: msg.uuid, // Store SDK UUID for resumeSessionAt
              });
            }
            // Tool use blocks -> tool_use message with metadata
            else if (block.type === 'tool_use') {
              const toolBlock = block as { id?: string; name?: string; input?: unknown };
              const toolInput = toolBlock.input as Record<string, unknown> | undefined;

              // Check if this is a Task tool (subagent spawn)
              const isTaskTool = toolBlock.name === 'Task';
              const subagentType = isTaskTool ? (toolInput?.subagent_type as string) : undefined;
              const subagentDescription = isTaskTool ? (toolInput?.description as string) : undefined;

              addMessage(instanceId, {
                type: 'tool_use',
                content: toolBlock.name || 'Tool',
                timestamp: new Date(),
                metadata: {
                  toolId: toolBlock.id,
                  toolName: toolBlock.name,
                  toolInput: toolBlock.input,
                  toolStatus: 'pending',
                  // Add subagent metadata for Task tool
                  subagentType,
                  subagentDescription,
                },
              });

              // Start tracking subagent if this is a Task tool
              if (isTaskTool && toolBlock.id && subagentType) {
                startSubagent(toolBlock.id, instanceId, subagentType, subagentDescription);
              }
            }
            // Thinking blocks -> thinking message with metadata
            else if (block.type === 'thinking') {
              const thinkingBlock = block as { thinking?: string; signature?: string };
              addMessage(instanceId, {
                type: 'thinking',
                content: thinkingBlock.thinking || '',
                timestamp: new Date(),
                metadata: {
                  thinking: thinkingBlock.thinking,
                  thinkingSignature: thinkingBlock.signature,
                  isRedactedThinking: false,
                },
              });
            }
            // Redacted thinking blocks
            else if (block.type === 'redacted_thinking') {
              addMessage(instanceId, {
                type: 'thinking',
                content: 'Reasoning redacted',
                timestamp: new Date(),
                metadata: {
                  isRedactedThinking: true,
                },
              });
            }
          }
        }
      }
    }

    // ========================================
    // SYSTEM MESSAGES
    // ========================================

    if (msg.type === 'system') {
      switch (msg.subtype) {
        case 'init': {
          const initMsg = msg as {
            model?: string;
            session_id?: string;
            cwd?: string;
            tools?: string[];
            mcp_servers?: Array<{ name: string; status: string }>;
          };
          addMessage(instanceId, {
            type: 'system',
            content: `Session started with ${initMsg.model || 'Claude'}`,
            timestamp: new Date(),
            metadata: {
              subtype: 'init',
              sessionId: initMsg.session_id,
              model: initMsg.model,
              cwd: initMsg.cwd,
              tools: initMsg.tools,
              mcpServers: initMsg.mcp_servers,
            },
          });
          break;
        }

        case 'compact_boundary':
          addMessage(instanceId, {
            type: 'system',
            content: 'Context compacted',
            timestamp: new Date(),
            metadata: {
              subtype: 'compact_boundary',
              preTokens: (msg as { pre_tokens?: number }).pre_tokens,
              trigger: (msg as { trigger?: 'manual' | 'auto' }).trigger,
            },
          });
          break;

        case 'status':
          // Transient - use status store, not messages
          setInstanceStatus(instanceId, (msg as { status?: string | null }).status || null);
          break;

        case 'hook_response': {
          const hookMsg = msg as {
            hook_name?: string;
            exit_code?: number;
            stdout?: string;
            stderr?: string;
          };
          addMessage(instanceId, {
            type: 'hook_response',
            content: hookMsg.hook_name || 'Hook',
            timestamp: new Date(),
            metadata: {
              subtype: 'hook_response',
              hookName: hookMsg.hook_name,
              exitCode: hookMsg.exit_code,
              stdout: hookMsg.stdout,
              stderr: hookMsg.stderr,
            },
          });
          break;
        }
      }
    }

    // ========================================
    // RESULT MESSAGES (completion stats and errors)
    // ========================================

    // Result messages are handled by instance:token_usage event for cost/tokens
    // Local command outputs are handled via synthetic user messages with tool_use_result
    // Error subtypes need special handling for user-friendly display
    if (msg.type === 'result' && msg.subtype) {
      const resultSubtype = msg.subtype as string;
      const errorSubtypes = ['error_max_turns', 'error_during_execution', 'error_max_budget_usd', 'error_max_structured_output_retries'];

      if (errorSubtypes.includes(resultSubtype)) {
        const resultMsg = msg as {
          subtype: string;
          result?: string;
          errors?: string[];
          total_cost_usd?: number;
          num_turns?: number;
        };

        addMessage(instanceId, {
          type: 'result_error',
          content: resultMsg.result || resultSubtype,
          timestamp: new Date(),
          metadata: {
            resultSubtype: resultSubtype as 'error_max_turns' | 'error_during_execution' | 'error_max_budget_usd' | 'error_max_structured_output_retries',
            resultErrors: resultMsg.errors,
            totalCost: resultMsg.total_cost_usd,
            numTurns: resultMsg.num_turns,
          },
        });
        updateStreamingState(instanceId, { isStreaming: false });
      }
    }

    // ========================================
    // STREAM EVENTS (progressive text streaming)
    // ========================================

    if (msg.type === 'stream_event' && msg.event) {
      const event = msg.event as {
        type?: string;
        index?: number;
        content_block?: { type: string };
        delta?: { type: string; text?: string };
      };

      switch (event.type) {
        case 'message_start':
          // Initialize streaming message
          initStreamingMessage(instanceId, msg.uuid);
          break;

        case 'content_block_start':
          // Initialize a content block
          if (event.index !== undefined && event.content_block) {
            initStreamingMessage(instanceId, msg.uuid);
            initStreamingBlock(instanceId, event.index, event.content_block);
          }
          break;

        case 'content_block_delta':
          // Append text delta to streaming message
          if (event.index !== undefined && event.delta?.type === 'text_delta' && event.delta.text) {
            appendStreamingText(instanceId, event.index, event.delta.text);
          }
          break;

        case 'content_block_stop':
          // Finalize content block
          if (event.index !== undefined) {
            finalizeStreamingBlock(instanceId, event.index);
          }
          break;

        case 'message_stop':
          // Finalize the streaming message - convert to final message
          finalizeStreamingMessage(instanceId);
          updateStreamingState(instanceId, { isStreaming: false });
          break;
      }
    }
  });
}

export function disconnect() {
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }

  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }

  connectionStatus.set('disconnected');
}

// Initialize stores from SSR-loaded data
export function initializeFromSSR(
  agentsData: Array<{
    machineId: string;
    hostname?: string;
    os?: string;
    status: 'online' | 'offline' | 'reconnecting';
    tailscaleIp?: string;
    connectedAt?: string;
    lastPing?: string;
  }>,
  instancesData: Array<{
    id: string;
    lastPrompt?: string;
    status: string;
    machineId: string;
    projectId?: string;
    createdAt?: string;
    cwd: string;
    model?: string;
    totalCostUsd?: number;
  }>,
  projectsData: Array<{
    id: string;
    name: string;
    description?: string;
    rootPath?: string;
    machineId?: string;
    createdAt: string;
    updatedAt: string;
  }>
): void {
  agents.set(new Map(agentsData.map((a) => [a.machineId, {
    machineId: a.machineId,
    name: a.hostname || a.machineId,
    os: (a.os as 'darwin' | 'linux' | 'windows') || 'linux',
    status: a.status,
    instances: 0,
    ip: a.tailscaleIp || '',
    connectedAt: a.connectedAt ? new Date(a.connectedAt) : undefined,
    lastPing: a.lastPing ? new Date(a.lastPing) : undefined,
  }])));

  instances.set(new Map(instancesData.map((i) => [i.id, {
    id: i.id,
    name: i.lastPrompt?.slice(0, 50) || 'Instance',
    status: i.status as Instance['status'],
    agent: '',
    machineId: i.machineId,
    project: null,
    projectId: i.projectId || null,
    lastActivity: i.createdAt ? new Date(i.createdAt).toISOString() : new Date().toISOString(),
    cwd: i.cwd,
    model: i.model,
    totalCostUsd: i.totalCostUsd,
  }])));

  projects.set(new Map(projectsData.map((p) => [p.id, {
    id: p.id,
    name: p.name,
    description: p.description,
    rootPath: p.rootPath,
    machineId: p.machineId,
    instanceCount: 0,
    createdAt: new Date(p.createdAt),
    updatedAt: new Date(p.updatedAt),
  }])));
}

// API helpers using Eden Treaty through the proxy (kept for client-side refresh)
export async function fetchAgents(): Promise<void> {
  try {
    const { data, error } = await api.api.agents.get();
    if (error) {
      console.error('Failed to fetch agents:', error);
      return;
    }
    if (data?.success && data.data) {
      agents.set(new Map(data.data.map((a) => [a.machineId, {
        machineId: a.machineId,
        name: a.hostname || a.machineId,
        os: (a.os as 'darwin' | 'linux' | 'windows') || 'linux',
        status: a.status,
        instances: 0, // Will be updated with instance count
        ip: a.tailscaleIp || '',
        connectedAt: a.connectedAt ? new Date(a.connectedAt) : undefined,
        lastPing: a.lastPing ? new Date(a.lastPing) : undefined,
      }])));
    }
  } catch (error) {
    console.error('Failed to fetch agents:', error);
  }
}

export async function fetchInstances(): Promise<void> {
  try {
    const { data, error } = await api.api.instances.get();
    if (error) {
      console.error('Failed to fetch instances:', error);
      return;
    }
    if (data?.success && data.data) {
      instances.set(new Map(data.data.map((i) => [i.id, {
        id: i.id,
        name: i.lastPrompt?.slice(0, 50) || 'Instance',
        status: i.status as Instance['status'],
        agent: '', // Will be resolved from agents
        machineId: i.machineId,
        project: null, // Will be resolved from projects
        projectId: i.projectId || null,
        lastActivity: i.createdAt ? new Date(i.createdAt).toISOString() : new Date().toISOString(),
        cwd: i.cwd,
        model: i.model,
        totalCostUsd: i.totalCostUsd,
      }])));
    }
  } catch (error) {
    console.error('Failed to fetch instances:', error);
  }
}

export async function fetchProjects(): Promise<void> {
  try {
    const { data, error } = await api.api.projects.get();
    if (error) {
      console.error('Failed to fetch projects:', error);
      return;
    }
    if (data?.success && data.data) {
      projects.set(new Map(data.data.map((p) => [p.id, {
        id: p.id,
        name: p.name,
        description: p.description,
        rootPath: p.rootPath,
        machineId: p.machineId,
        instanceCount: 0, // Will be calculated
        createdAt: new Date(p.createdAt),
        updatedAt: new Date(p.updatedAt),
      }])));
    }
  } catch (error) {
    console.error('Failed to fetch projects:', error);
  }
}

// ============================================
// UI STATE STORES
// ============================================

// Currently selected instance ID (null = no selection, show welcome)
export const selectedInstanceId: Writable<string | null> = writable(null);

// Split view state
export interface SplitViewState {
  enabled: boolean;
  secondInstanceId: string | null;
  splitRatio: number; // 0.5 = 50/50, 0.3 = 30/70, etc.
}
export const splitViewState: Writable<SplitViewState> = writable({
  enabled: false,
  secondInstanceId: null,
  splitRatio: 0.5,
});

// Notification center open state
export const notificationCenterOpen: Writable<boolean> = writable(false);

// Command palette open state
export const commandPaletteOpen: Writable<boolean> = writable(false);

// Sidebar collapsed state (for desktop - minimizes to icons)
export const sidebarCollapsed: Writable<boolean> = writable(false);

// Sidebar open state (for mobile - shows/hides overlay)
export const sidebarOpen: Writable<boolean> = writable(false);

// Toggle sidebar - on mobile toggles open/close, on desktop toggles collapsed
export function toggleSidebar(): void {
  if (typeof window !== 'undefined' && window.innerWidth < 1024) {
    sidebarOpen.update(v => !v);
  } else {
    sidebarCollapsed.update(v => !v);
  }
}

// Sidebar filter state
export type SidebarFilter = 'all' | 'running' | 'stopped' | 'agent';
export interface SidebarFilterState {
  type: SidebarFilter;
  agentId?: string; // Only used when type === 'agent'
}
export const sidebarFilter: Writable<SidebarFilterState> = writable({ type: 'all' });

// Toggle sidebar filter (clicking again returns to 'all')
export function toggleSidebarFilter(filter: SidebarFilter): void {
  sidebarFilter.update(current => {
    if (current.type === filter) {
      return { type: 'all' };
    }
    return { type: filter };
  });
}

// Set sidebar filter by agent
export function filterByAgent(agentId: string): void {
  sidebarFilter.set({ type: 'agent', agentId });
}

// Project collapse state (which projects are expanded in sidebar)
export const collapsedProjects: Writable<Set<string>> = writable(new Set());

// ============================================
// DERIVED STORES FOR SIDEBAR
// ============================================

// Instances grouped by project for sidebar display
export interface ProjectGroup {
  project: Project | null; // null = "Unassigned"
  instances: Instance[];
  isCollapsed: boolean;
}

export const instancesByProject: Readable<ProjectGroup[]> = derived(
  [populatedInstances, projects, collapsedProjects, sidebarFilter],
  ([$instances, $projects, $collapsed, $filter]) => {
    // Apply filter first
    let filtered = $instances;
    if ($filter.type === 'running') {
      filtered = $instances.filter(i => i.status === 'running' || i.status === 'starting');
    } else if ($filter.type === 'stopped') {
      filtered = $instances.filter(i => i.status === 'stopped' || i.status === 'sleeping');
    } else if ($filter.type === 'agent' && $filter.agentId) {
      filtered = $instances.filter(i => i.machineId === $filter.agentId);
    }

    // Group by project
    const groups = new Map<string | null, Instance[]>();

    for (const instance of filtered) {
      const key = instance.projectId || null;
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(instance);
    }

    // Convert to array and sort
    const result: ProjectGroup[] = [];

    // Projects first (sorted by name)
    const sortedProjects = Array.from($projects.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );

    for (const project of sortedProjects) {
      const projectInstances = groups.get(project.id) || [];
      if (projectInstances.length > 0) {
        result.push({
          project,
          instances: projectInstances.sort((a, b) =>
            new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime()
          ),
          isCollapsed: $collapsed.has(project.id),
        });
      }
    }

    // Unassigned last
    const unassigned = groups.get(null) || [];
    if (unassigned.length > 0) {
      result.push({
        project: null,
        instances: unassigned.sort((a, b) =>
          new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime()
        ),
        isCollapsed: $collapsed.has('__unassigned__'),
      });
    }

    return result;
  }
);

// Selected instance object (resolved from ID)
export const selectedInstance: Readable<Instance | null> = derived(
  [selectedInstanceId, instances],
  ([$id, $instances]) => $id ? $instances.get($id) || null : null
);

// All pending permissions across all instances
export const allPendingPermissions: Readable<PermissionRequest[]> = derived(
  pendingPermissions,
  ($permissions) => Array.from($permissions.values())
    .sort((a, b) => b.createdAt - a.createdAt) // Newest first
);

// Count of pending permissions (for badge)
export const pendingPermissionCount: Readable<number> = derived(
  pendingPermissions,
  ($permissions) => $permissions.size
);

// ============================================
// UI STATE ACTIONS
// ============================================

// Select an instance (and optionally navigate)
export function selectInstance(instanceId: string | null): void {
  selectedInstanceId.set(instanceId);
  // Close split view if selecting null
  if (!instanceId) {
    splitViewState.update(s => ({ ...s, enabled: false, secondInstanceId: null }));
  }
}

// Toggle project collapse in sidebar
export function toggleProjectCollapse(projectId: string | null): void {
  const key = projectId || '__unassigned__';
  collapsedProjects.update(set => {
    const newSet = new Set(set);
    if (newSet.has(key)) {
      newSet.delete(key);
    } else {
      newSet.add(key);
    }
    return newSet;
  });
}

// Enable split view with second instance
export function enableSplitView(secondInstanceId: string): void {
  splitViewState.set({
    enabled: true,
    secondInstanceId,
    splitRatio: 0.5,
  });
}

// Disable split view
export function disableSplitView(): void {
  splitViewState.set({
    enabled: false,
    secondInstanceId: null,
    splitRatio: 0.5,
  });
}

// Toggle notification center
export function toggleNotificationCenter(): void {
  notificationCenterOpen.update(v => !v);
}

// Toggle command palette
export function toggleCommandPalette(): void {
  commandPaletteOpen.update(v => !v);
}
