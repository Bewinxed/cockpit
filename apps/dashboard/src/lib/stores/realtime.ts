import { writable, derived, type Writable, type Readable } from 'svelte/store';
import { api } from '$lib/api';

// Types for real-time data
export interface Agent {
  id: string;
  name: string;
  os: 'darwin' | 'linux' | 'windows';
  status: 'online' | 'offline';
  instances: number;
  ip: string;
  connectedAt?: Date;
  lastPing?: Date;
}

export interface Instance {
  id: string;
  name: string;
  status: 'starting' | 'running' | 'stopping' | 'stopped' | 'error' | 'disconnected';
  agent: string;
  agentId: string;
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
  agentId?: string;
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
  instanceId: string;
  type: 'assistant' | 'user' | 'system' | 'tool_use' | 'tool_result' | 'error';
  content: string;
  timestamp: Date;
  // Metadata for richer rendering
  metadata?: {
    // For tool_use messages
    toolId?: string;
    toolName?: string;
    toolInput?: unknown;
    toolResult?: unknown;
    toolStatus?: 'pending' | 'success' | 'error';
    // For system messages
    model?: string;
    cwd?: string;
    tools?: string[];
    sessionId?: string;
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

// Stores
export const agents: Writable<Map<string, Agent>> = writable(new Map());
export const instances: Writable<Map<string, Instance>> = writable(new Map());
export const projects: Writable<Map<string, Project>> = writable(new Map());
export const tasks: Writable<Map<string, Task>> = writable(new Map());
export const streamingStates: Writable<Map<string, StreamingState>> = writable(new Map());

// Messages stored per-instance for better organization
export const instanceMessages: Writable<Map<string, Message[]>> = writable(new Map());

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
    // Keep last 500 messages per instance
    const newMsgs = [...msgs, { ...message, instanceId }].slice(-500);
    map.set(instanceId, newMsgs);
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

// Connection state
export const connectionStatus: Writable<'connecting' | 'connected' | 'disconnected' | 'error'> = writable('disconnected');

// Derived stores
export const onlineAgents: Readable<Agent[]> = derived(agents, ($agents) =>
  Array.from($agents.values()).filter((a) => a.status === 'online')
);

export const runningInstances: Readable<Instance[]> = derived(instances, ($instances) =>
  Array.from($instances.values()).filter((i) => i.status === 'running' || i.status === 'starting')
);

export const recentInstances: Readable<Instance[]> = derived(instances, ($instances) =>
  Array.from($instances.values())
    .sort((a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime())
    .slice(0, 5)
);

// Ad-hoc instances (no project)
export const adhocInstances: Readable<Instance[]> = derived(instances, ($instances) =>
  Array.from($instances.values())
    .filter((i) => !i.projectId)
    .sort((a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime())
);

// Project instances
export const projectInstances: Readable<Instance[]> = derived(instances, ($instances) =>
  Array.from($instances.values())
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
      map.set(agent.id, {
        ...agent,
        name: agent.hostname,
        status: 'online',
        instances: 0,
      });
      return map;
    });
  });

  eventSource.addEventListener('agent:disconnected', (event: Event) => {
    const { agentId } = JSON.parse((event as MessageEvent).data);
    agents.update((map) => {
      const agent = map.get(agentId);
      if (agent) {
        map.set(agentId, { ...agent, status: 'offline' });
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
      message?: { content?: unknown[] | string; role?: string };
      result?: string;
      isSynthetic?: boolean;
      event?: { type?: string }; // For stream_event
      session_id?: string;
      cwd?: string;
      model?: string;
      tools?: string[];
    };

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

      // Check if this is a synthetic message (tool result wrapper)
      // Synthetic messages have isSynthetic=true OR contain only tool_result blocks
      const isSynthetic = msg.isSynthetic;

      if (!isSynthetic) {
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
          addMessage(instanceId, {
            type: 'user',
            content: textContent.trim(),
            timestamp: new Date(),
          });
        }
      }

      // Process tool_result blocks (from synthetic user messages)
      // These update existing tool_use messages with their results
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block && typeof block === 'object' && 'type' in block && block.type === 'tool_result') {
            const toolResult = block as {
              tool_use_id?: string;
              content?: unknown;
              is_error?: boolean;
            };
            if (toolResult.tool_use_id) {
              // Update the matching tool_use message with this result
              updateToolResult(
                instanceId,
                toolResult.tool_use_id,
                toolResult.content,
                toolResult.is_error || false
              );
            }
          }
        }
      }
    }

    // ========================================
    // ASSISTANT MESSAGES
    // ========================================

    if (msg.type === 'assistant' && msg.message?.content) {
      const content = msg.message.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block && typeof block === 'object' && 'type' in block) {
            // Text blocks -> assistant message
            if (block.type === 'text' && 'text' in block) {
              addMessage(instanceId, {
                type: 'assistant',
                content: block.text as string,
                timestamp: new Date(),
              });
            }
            // Tool use blocks -> tool_use message with metadata
            else if (block.type === 'tool_use') {
              const toolBlock = block as { id?: string; name?: string; input?: unknown };
              addMessage(instanceId, {
                type: 'tool_use',
                content: toolBlock.name || 'Tool',
                timestamp: new Date(),
                metadata: {
                  toolId: toolBlock.id,
                  toolName: toolBlock.name,
                  toolInput: toolBlock.input,
                  toolStatus: 'pending',
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

    if (msg.type === 'system' && msg.subtype === 'init') {
      addMessage(instanceId, {
        type: 'system',
        content: `Session started with ${msg.model || 'Claude'}`,
        timestamp: new Date(),
        metadata: {
          sessionId: msg.session_id,
          model: msg.model,
          cwd: msg.cwd,
          tools: msg.tools,
        },
      });
    }

    // ========================================
    // RESULT MESSAGES (completion stats)
    // ========================================

    // Result messages are handled by instance:token_usage event for cost/tokens
    // The result.result field contains the final answer but we already have it from assistant messages

    // ========================================
    // STREAM EVENTS (for real-time updates)
    // ========================================

    // Stream events can be used for:
    // 1. Typing indicator (already handled via isStreaming)
    // 2. Partial text updates (future enhancement)
    // Currently we just use them to set streaming state
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

// API helpers using Eden Treaty through the proxy
export async function fetchAgents(): Promise<void> {
  try {
    const { data, error } = await api.api.agents.get();
    if (error) {
      console.error('Failed to fetch agents:', error);
      return;
    }
    if (data?.success && data.data) {
      agents.set(new Map(data.data.map((a) => [a.id, {
        id: a.id,
        name: a.hostname || a.id,
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
        agentId: i.agentId,
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
        agentId: p.agentId,
        instanceCount: 0, // Will be calculated
        createdAt: new Date(p.createdAt),
        updatedAt: new Date(p.updatedAt),
      }])));
    }
  } catch (error) {
    console.error('Failed to fetch projects:', error);
  }
}
