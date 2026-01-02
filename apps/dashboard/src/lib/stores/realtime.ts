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
  status: 'starting' | 'running' | 'stopping' | 'stopped' | 'error';
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
}

// Stores
export const agents: Writable<Map<string, Agent>> = writable(new Map());
export const instances: Writable<Map<string, Instance>> = writable(new Map());
export const projects: Writable<Map<string, Project>> = writable(new Map());
export const tasks: Writable<Map<string, Task>> = writable(new Map());

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

// Clear messages for an instance
export function clearInstanceMessages(instanceId: string): void {
  instanceMessages.update((map) => {
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

  eventSource.addEventListener('instance:message', (event: Event) => {
    const { instanceId, messageType, content } = JSON.parse((event as MessageEvent).data);
    addMessage(instanceId, {
      type: messageType || 'assistant',
      content: typeof content === 'string' ? content : JSON.stringify(content),
      timestamp: new Date(),
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

// API helpers using Eden Treaty for type safety
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
        lastActivity: i.createdAt instanceof Date ? i.createdAt.toISOString() : new Date().toISOString(),
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
