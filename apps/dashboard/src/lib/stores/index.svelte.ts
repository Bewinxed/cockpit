/**
 * Store facade - re-exports entity stores and provides cross-store derivations.
 *
 * This is the main entry point for store access. Import from here, not individual files.
 *
 * Usage:
 *   import { agents, instances, ui, stores } from '$lib/stores';
 *   // For cross-store derivations:
 *   const populated = stores.populatedInstances; // reactive
 */

// Re-export types
export type {
  Agent,
  Instance, Message,
  MessageMetadata, PermissionRequest, Project, ProjectGroup, SidebarFilter,
  SidebarFilterState, SplitViewState, StreamingMessage, StreamingState, SubagentState, Task
} from './types';

// Re-export dashboard event types from core
export type {
  AgentConnectedEvent,
  AgentDisconnectedEvent,
  AgentReconnectingEvent,
  AgentUpdatedEvent,
  DashboardEventMap,
  DashboardEventPayload,
  DashboardEventType,
  ExtractedToolInvocation,
  ExtractedToolResult,
  InstanceCreatedEvent,
  InstanceErrorEvent,
  InstanceModelChangedEvent,
  InstanceResumedEvent,
  InstanceSleepingEvent,
  InstanceStartedEvent,
  InstanceStoppedEvent,
  InstanceTokenUsageEvent,
  PermissionRequestEvent,
  ProjectCreatedEvent,
  ProjectDeletedEvent,
  ProjectUpdatedEvent,
  QuestionRequestEvent,
  SdkMessageEvent,
  TaskCompletedEvent,
  TaskCreatedEvent,
  TaskUpdatedEvent,
} from '@cockpit/core/dashboard';

// Re-export entity stores
export { agents } from './agents.svelte';
export { instances, type ToolInvocationData } from './instances.svelte';
export { permissions } from './permissions.svelte';
export { projects } from './projects.svelte';
export { questions } from './questions.svelte';
export { tasks } from './tasks.svelte';
export { ui } from './ui.svelte';

// Re-export SDK message handler
export { handleSdkMessage } from './sdk-message-handler';

// Import stores for cross-store derivations and initialization
import { agents } from './agents.svelte';
import { instances } from './instances.svelte';
import { permissions } from './permissions.svelte';
import { projects } from './projects.svelte';
import { questions } from './questions.svelte';
import { handleSdkMessage } from './sdk-message-handler';
import { tasks } from './tasks.svelte';
import type { Instance, ProjectGroup } from './types';
import { ui } from './ui.svelte';

// river.ts - use pre-built schema and WebSocket adapter from core
import { RiverSocketAdapter } from 'river.ts/websocket';
import { dashboardEvents } from '@cockpit/core/dashboard';

// ============================================
// WEBSOCKET CONNECTION (river.ts with shared schema from core)
// ============================================

// Connection state (reactive) - wrapped in object to allow mutation without reassignment
export const connection = $state({
  status: 'disconnected' as 'connecting' | 'connected' | 'disconnected' | 'error'
});

// HMR-persistent client references
declare global {
  var __wsSocket: WebSocket | null;
  var __wsAdapter: RiverSocketAdapter<typeof dashboardEvents> | null;
  var __wsReconnectTimeout: ReturnType<typeof setTimeout> | null;
  var __wsReconnectAttempts: number;
  var __wsBaseUrl: string;
}
globalThis.__wsSocket ??= null;
globalThis.__wsAdapter ??= null;
globalThis.__wsReconnectTimeout ??= null;
globalThis.__wsReconnectAttempts ??= 0;
globalThis.__wsBaseUrl ??= '';

// ============================================
// SSR INITIALIZATION
// ============================================

/**
 * Initialize all stores from SSR-loaded data.
 * Called in +layout.svelte after fetching initial data.
 */
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
  agents.initializeFromSSR(agentsData);
  instances.initializeFromSSR(instancesData);
  projects.initializeFromSSR(projectsData);
}

// ============================================
// WEBSOCKET CONNECTION FUNCTIONS
// ============================================

/**
 * Setup event handlers on the RiverSocketAdapter.
 * Called once when adapter is created.
 */
function setupEventHandlers(adapter: RiverSocketAdapter<typeof dashboardEvents>): void {
  // Agent events - river.ts passes data directly to handlers
  adapter.on('agent:connected', (data) => agents.handleConnected(data));
  adapter.on('agent:disconnected', (data) => agents.handleDisconnected(data));
  adapter.on('agent:reconnecting', (data) => agents.handleReconnecting(data));
  adapter.on('agent:updated', (data) => agents.handleUpdated(data));

  // Instance events
  adapter.on('instance:created', (data) => instances.handleCreated(data));
  adapter.on('instance:started', (data) => instances.handleStarted(data));
  adapter.on('instance:stopped', (data) => instances.handleStopped(data));
  adapter.on('instance:sleeping', (data) => instances.handleSleeping(data));
  adapter.on('instance:error', (data) => {
    instances.handleError(data);
    if (data.error) {
      instances.addMessage(data.instanceId, {
        type: 'error',
        content: data.error,
        timestamp: new Date(),
      });
    }
  });
  adapter.on('instance:resumed', (data) => instances.handleResumed(data));
  adapter.on('instance:token_usage', (data) => instances.handleTokenUsage(data));
  adapter.on('instance:model-changed', (data) => instances.handleModelChanged(data));

  // SDK message
  adapter.on('sdk:message', (data) => handleSdkMessage(data));

  // Task events
  adapter.on('task:created', (data) => tasks.handleCreated(data));
  adapter.on('task:updated', (data) => tasks.handleUpdated(data));
  adapter.on('task:completed', (data) => tasks.handleCompleted(data));

  // Permission events
  adapter.on('permission:request', (data) => permissions.handleRequest(data));

  // Question events (AskUserQuestion UI bridge)
  adapter.on('question:request', (data) => questions.handleRequest(data));

  // Project events
  adapter.on('project:created', (data) => projects.handleCreated(data));
  adapter.on('project:updated', (data) => projects.handleUpdated(data));
  adapter.on('project:deleted', (data) => projects.handleDeleted(data));

  // Connection confirmation from server
  adapter.on('connected', (data) => {
    connection.status = 'connected';
    globalThis.__wsReconnectAttempts = 0;
    console.log('[WS] Connected to hub, clientId:', data.clientId);
  });
}

/**
 * Connect to WebSocket and wire handlers via river.ts adapter.
 */
export function setupWSAndConnect(baseUrl: string = ''): void {
  globalThis.__wsBaseUrl = baseUrl;

  // Close existing connection
  if (globalThis.__wsSocket) {
    globalThis.__wsSocket.close();
    globalThis.__wsSocket = null;
  }
  if (globalThis.__wsAdapter) {
    globalThis.__wsAdapter.clearPendingRequests();
    globalThis.__wsAdapter = null;
  }

  connection.status = 'connecting';

  // Build WebSocket URL from current origin (Vite/SvelteKit proxies /ws to hub)
  const protocol = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = typeof window !== 'undefined' ? window.location.host : 'localhost:3000';
  const wsUrl = `${protocol}//${host}/ws/dashboard`;
  console.log('[WS] Connecting to:', wsUrl);

  // Create WebSocket and river.ts adapter
  const ws = new WebSocket(wsUrl);
  const adapter = new RiverSocketAdapter(dashboardEvents, { debug: false });

  // Setup event handlers
  setupEventHandlers(adapter);

  // Wire WebSocket events
  ws.onopen = () => {
    console.log('[WS] WebSocket opened');
    // Connection confirmation comes from server via 'connected' event
  };

  ws.onmessage = (event) => {
    // Route all messages through river.ts adapter
    adapter.handleMessage(event.data);
  };

  ws.onclose = (event) => {
    console.log('[WS] WebSocket closed:', event.code, event.reason);
    connection.status = 'disconnected';
    adapter.clearPendingRequests();
    attemptReconnect();
  };

  ws.onerror = (error) => {
    console.error('[WS] WebSocket error:', error);
    connection.status = 'error';
  };

  // Store references globally for HMR persistence
  globalThis.__wsSocket = ws;
  globalThis.__wsAdapter = adapter;
}

/** Attempt reconnect with exponential backoff */
function attemptReconnect(): void {
  const maxAttempts = 10;
  if (globalThis.__wsReconnectAttempts < maxAttempts) {
    const delay = Math.min(1000 * Math.pow(2, globalThis.__wsReconnectAttempts), 30000);
    console.log(`[WS] Reconnecting in ${delay}ms (attempt ${globalThis.__wsReconnectAttempts + 1}/${maxAttempts})`);
    globalThis.__wsReconnectTimeout = setTimeout(() => {
      globalThis.__wsReconnectAttempts++;
      setupWSAndConnect(globalThis.__wsBaseUrl);
    }, delay);
  } else {
    console.error('[WS] Max reconnect attempts reached');
    connection.status = 'error';
  }
}

/**
 * Disconnect from WebSocket.
 */
export function disconnectWS(): void {
  if (globalThis.__wsReconnectTimeout) {
    clearTimeout(globalThis.__wsReconnectTimeout);
    globalThis.__wsReconnectTimeout = null;
  }
  if (globalThis.__wsAdapter) {
    globalThis.__wsAdapter.clearPendingRequests();
    globalThis.__wsAdapter = null;
  }
  if (globalThis.__wsSocket) {
    globalThis.__wsSocket.close();
    globalThis.__wsSocket = null;
  }
  connection.status = 'disconnected';
}

/** Force reconnect */
export function reconnectWS(): void {
  disconnectWS();
  globalThis.__wsReconnectAttempts = 0;
  setupWSAndConnect(globalThis.__wsBaseUrl);
}


// ============================================
// WEBSOCKET COMMANDS (RPC-style via river.ts)
// ============================================

import type {
  SpawnInstanceRequest,
  SpawnInstanceResponse,
  SendMessageRequest,
  SendMessageResponse,
  StopInstanceRequest,
  StopInstanceResponse,
  PermissionResponseRequest,
  PermissionResponseResponse,
  QuestionResponseRequest,
  QuestionResponseResponse,
} from '@cockpit/core/dashboard';

/** Error thrown when WebSocket is not connected */
export class WebSocketNotConnectedError extends Error {
  constructor() {
    super('WebSocket not connected');
    this.name = 'WebSocketNotConnectedError';
  }
}

/**
 * Get WebSocket and adapter, throwing if not connected.
 * @throws WebSocketNotConnectedError if not connected
 */
function getConnectedWs(): { ws: WebSocket; adapter: RiverSocketAdapter<typeof dashboardEvents> } {
  const ws = globalThis.__wsSocket;
  const adapter = globalThis.__wsAdapter;

  if (!ws || ws.readyState !== WebSocket.OPEN || !adapter) {
    throw new WebSocketNotConnectedError();
  }

  return { ws, adapter };
}

/**
 * Spawn a new Claude instance on a machine.
 * @throws WebSocketNotConnectedError if not connected
 * @throws RequestTimeoutError if no response within timeout
 */
export async function spawnInstance(params: SpawnInstanceRequest): Promise<SpawnInstanceResponse> {
  const { ws, adapter } = getConnectedWs();
  return adapter.request('instance.spawn', params, (msg) => ws.send(msg), 30000);
}

/**
 * Send a message to a running instance.
 * @throws WebSocketNotConnectedError if not connected
 * @throws RequestTimeoutError if no response within timeout
 */
export async function sendInstanceMessage(params: SendMessageRequest): Promise<SendMessageResponse> {
  const { ws, adapter } = getConnectedWs();
  return adapter.request('instance.send', params, (msg) => ws.send(msg), 30000);
}

/**
 * Stop a running instance.
 * @throws WebSocketNotConnectedError if not connected
 * @throws RequestTimeoutError if no response within timeout
 */
export async function stopInstance(params: StopInstanceRequest): Promise<StopInstanceResponse> {
  const { ws, adapter } = getConnectedWs();
  return adapter.request('instance.stop', params, (msg) => ws.send(msg), 30000);
}

/**
 * Send a permission response (allow/deny).
 * @throws WebSocketNotConnectedError if not connected
 * @throws RequestTimeoutError if no response within timeout
 */
export async function sendPermissionResponse(params: PermissionResponseRequest): Promise<PermissionResponseResponse> {
  const { ws, adapter } = getConnectedWs();
  return adapter.request('permission.response', params, (msg) => ws.send(msg), 30000);
}

/**
 * Send a question response (user answers).
 * @throws WebSocketNotConnectedError if not connected
 * @throws RequestTimeoutError if no response within timeout
 */
export async function sendQuestionResponse(params: QuestionResponseRequest): Promise<QuestionResponseResponse> {
  const { ws, adapter } = getConnectedWs();
  return adapter.request('question.response', params, (msg) => ws.send(msg), 30000);
}

// ============================================
// CROSS-STORE DERIVED VALUES (via class for export)
// ============================================

/**
 * Cross-store derivations wrapped in a class to allow export.
 * Svelte 5 does not allow exporting $derived directly from modules.
 */
class CrossStoreDerivations {
  /**
   * Populated instances with resolved agent and project names.
   * Use this for display in UI components.
   */
  readonly populatedInstances = $derived.by(() => {
    return Array.from(instances.all.values()).map((instance) => {
      const agent = agents.all.get(instance.machineId);
      const project = instance.projectId ? projects.all.get(instance.projectId) : null;
      return {
        ...instance,
        agent: agent?.name || 'Unknown Agent',
        project: project?.name || null,
      };
    });
  });

  /**
   * Running instances (populated).
   */
  readonly runningInstances = $derived(
    this.populatedInstances.filter((i) => i.status === 'running' || i.status === 'starting')
  );

  /**
   * Recent instances sorted by last activity (populated).
   */
  readonly recentInstances = $derived(
    [...this.populatedInstances]
      .sort((a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime())
      .slice(0, 5)
  );

  /**
   * Ad-hoc instances (no project, populated).
   */
  readonly adhocInstances = $derived(
    this.populatedInstances
      .filter((i) => !i.projectId)
      .sort((a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime())
  );

  /**
   * Project instances (has project, populated).
   */
  readonly projectInstances = $derived(
    this.populatedInstances
      .filter((i) => i.projectId)
      .sort((a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime())
  );

  /**
   * Dashboard stats - aggregated metrics.
   */
  readonly stats = $derived.by(() => ({
    totalAgents: agents.all.size,
    onlineAgents: agents.online.length,
    totalInstances: instances.all.size,
    runningInstances: instances.running.length,
    totalProjects: projects.all.size,
    activeTasks: tasks.active.length,
    totalCostUsd: instances.totalCost,
  }));

  /**
   * Instances grouped by project for sidebar display.
   * Respects sidebar filter and project collapse state.
   */
  readonly instancesByProject = $derived.by((): ProjectGroup[] => {
    const filter = ui.sidebarFilter;
    const collapsed = ui.collapsedProjects;

    // Apply filter first
    let filtered = this.populatedInstances;
    if (filter.type === 'running') {
      filtered = this.populatedInstances.filter((i) => i.status === 'running' || i.status === 'starting');
    } else if (filter.type === 'stopped') {
      filtered = this.populatedInstances.filter((i) => i.status === 'stopped' || i.status === 'sleeping');
    } else if (filter.type === 'agent' && filter.agentId) {
      filtered = this.populatedInstances.filter((i) => i.machineId === filter.agentId);
    }

    // Group by project (local computation, recreated each derivation)
    const groups = new Map<string | null, Instance[]>(); // local Map for grouping

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
    const sortedProjects = projects.sorted;

    for (const project of sortedProjects) {
      const projectInstances = groups.get(project.id) || [];
      if (projectInstances.length > 0) {
        result.push({
          project,
          instances: projectInstances.sort(
            (a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime()
          ),
          isCollapsed: collapsed.has(project.id),
        });
      }
    }

    // Unassigned last
    const unassigned = groups.get(null) || [];
    if (unassigned.length > 0) {
      result.push({
        project: null,
        instances: unassigned.sort(
          (a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime()
        ),
        isCollapsed: collapsed.has('__unassigned__'),
      });
    }

    return result;
  });

  /**
   * Selected instance object (resolved from ui.selectedInstanceId).
   */
  readonly selectedInstance = $derived(
    ui.selectedInstanceId ? instances.get(ui.selectedInstanceId) || null : null
  );
}

// Singleton with HMR persistence
function createCrossStoreDerivations(): CrossStoreDerivations {
  // @ts-expect-error - globalThis extension for HMR
  if (globalThis.__cockpitCrossStoreDerivations) {
    // @ts-expect-error - globalThis extension for HMR
    return globalThis.__cockpitCrossStoreDerivations;
  }
  const derivations = new CrossStoreDerivations();
  // @ts-expect-error - globalThis extension for HMR
  globalThis.__cockpitCrossStoreDerivations = derivations;
  return derivations;
}

/**
 * Cross-store derivations singleton.
 * Access reactive cross-store values like:
 *   stores.populatedInstances
 *   stores.stats
 *   stores.instancesByProject
 */
export const stores = createCrossStoreDerivations();

// ============================================
// NOTES ON USAGE
// ============================================
// Cross-store derivations must be accessed via the stores singleton:
//   import { stores } from '$lib/stores';
//   // In template: {stores.stats.runningInstances}
//   // In script: const populated = stores.populatedInstances;
//
// Svelte 5 does not allow exporting $derived directly from modules,
// so these are wrapped in a class (CrossStoreDerivations).
