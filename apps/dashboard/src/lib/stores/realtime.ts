import { writable, derived, type Writable, type Readable } from 'svelte/store';

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
export const messages: Writable<Message[]> = writable([]);

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
}> = derived([agents, instances, projects, tasks], ([$agents, $instances, $projects, $tasks]) => ({
  totalAgents: $agents.size,
  onlineAgents: Array.from($agents.values()).filter((a) => a.status === 'online').length,
  totalInstances: $instances.size,
  runningInstances: Array.from($instances.values()).filter((i) => i.status === 'running' || i.status === 'starting').length,
  totalProjects: $projects.size,
  activeTasks: Array.from($tasks.values()).filter((t) => t.status === 'in_progress').length,
}));

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
    messages.update((msgs) => [
      ...msgs.slice(-99), // Keep last 100 messages
      {
        instanceId,
        type: messageType || 'assistant',
        content: typeof content === 'string' ? content : JSON.stringify(content),
        timestamp: new Date(),
      },
    ]);
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

// API response type
interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// API helpers
export async function fetchAgents(baseUrl: string = ''): Promise<void> {
  try {
    const response = await fetch(`${baseUrl}/api/agents`);
    const result = (await response.json()) as ApiResponse<Agent[]>;
    if (result.success && result.data) {
      agents.set(new Map(result.data.map((a) => [a.id, { ...a, name: a.name || a.id }])));
    }
  } catch (error) {
    console.error('Failed to fetch agents:', error);
  }
}

export async function fetchInstances(baseUrl: string = ''): Promise<void> {
  try {
    const response = await fetch(`${baseUrl}/api/instances`);
    const result = (await response.json()) as ApiResponse<Instance[]>;
    if (result.success && result.data) {
      instances.set(new Map(result.data.map((i) => [i.id, i])));
    }
  } catch (error) {
    console.error('Failed to fetch instances:', error);
  }
}

export async function fetchProjects(baseUrl: string = ''): Promise<void> {
  try {
    const response = await fetch(`${baseUrl}/api/projects`);
    const result = (await response.json()) as ApiResponse<Project[]>;
    if (result.success && result.data) {
      projects.set(new Map(result.data.map((p) => [p.id, p])));
    }
  } catch (error) {
    console.error('Failed to fetch projects:', error);
  }
}
