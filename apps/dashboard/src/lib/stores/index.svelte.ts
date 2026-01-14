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
  Instance,
  Project,
  Task,
  Message,
  MessageMetadata,
  StreamingState,
  StreamingMessage,
  PermissionRequest,
  SubagentState,
  SplitViewState,
  SidebarFilter,
  SidebarFilterState,
  ProjectGroup,
} from './types';

// Re-export SSE event types (for river.ts consumers)
export type {
  CockpitEventMap,
  CockpitEventType,
  CockpitEventPayload,
  SdkMessageEvent,
  ExtractedToolInvocation,
  ExtractedToolResult,
  AgentConnectedEvent,
  AgentDisconnectedEvent,
  AgentReconnectingEvent,
  AgentUpdatedEvent,
  InstanceCreatedEvent,
  InstanceStartedEvent,
  InstanceStoppedEvent,
  InstanceSleepingEvent,
  InstanceErrorEvent,
  InstanceResumedEvent,
  InstanceTokenUsageEvent,
  InstanceModelChangedEvent,
  TaskCreatedEvent,
  TaskUpdatedEvent,
  TaskCompletedEvent,
  PermissionRequestEvent,
  ProjectCreatedEvent,
  ProjectUpdatedEvent,
  ProjectDeletedEvent,
} from './sse-events';

// Re-export entity stores
export { agents } from './agents.svelte';
export { instances, type ToolInvocationData } from './instances.svelte';
export { projects } from './projects.svelte';
export { tasks } from './tasks.svelte';
export { permissions } from './permissions.svelte';
export { ui } from './ui.svelte';

// Re-export SDK message handler
export { handleSdkMessage } from './sdk-message-handler';

// Import stores for cross-store derivations and initialization
import { agents } from './agents.svelte';
import { instances } from './instances.svelte';
import { projects } from './projects.svelte';
import { tasks } from './tasks.svelte';
import { permissions } from './permissions.svelte';
import { ui } from './ui.svelte';
import { handleSdkMessage } from './sdk-message-handler';
import type { Instance, ProjectGroup } from './types';
import type { SdkMessageEvent } from './sse-events';

// river.ts - direct usage, no wrapper
import { RiverClient } from 'river.ts/client';
import { RiverEvents } from 'river.ts';
import type {
  AgentConnectedEvent,
  AgentDisconnectedEvent,
  AgentReconnectingEvent,
  AgentUpdatedEvent,
  InstanceCreatedEvent,
  InstanceStartedEvent,
  InstanceStoppedEvent,
  InstanceSleepingEvent,
  InstanceErrorEvent,
  InstanceResumedEvent,
  InstanceTokenUsageEvent,
  InstanceModelChangedEvent,
  TaskCreatedEvent,
  TaskUpdatedEvent,
  TaskCompletedEvent,
  PermissionRequestEvent,
  ProjectCreatedEvent,
  ProjectUpdatedEvent,
  ProjectDeletedEvent,
} from './sse-events';

// ============================================
// SSE CONNECTION (river.ts direct)
// ============================================

// Define typed events schema for river.ts
const sseEvents = new RiverEvents()
  .defineEvent('agent:connected', { data: {} as AgentConnectedEvent })
  .defineEvent('agent:disconnected', { data: {} as AgentDisconnectedEvent })
  .defineEvent('agent:reconnecting', { data: {} as AgentReconnectingEvent })
  .defineEvent('agent:updated', { data: {} as AgentUpdatedEvent })
  .defineEvent('instance:created', { data: {} as InstanceCreatedEvent })
  .defineEvent('instance:started', { data: {} as InstanceStartedEvent })
  .defineEvent('instance:stopped', { data: {} as InstanceStoppedEvent })
  .defineEvent('instance:sleeping', { data: {} as InstanceSleepingEvent })
  .defineEvent('instance:error', { data: {} as InstanceErrorEvent })
  .defineEvent('instance:resumed', { data: {} as InstanceResumedEvent })
  .defineEvent('instance:token_usage', { data: {} as InstanceTokenUsageEvent })
  .defineEvent('instance:model-changed', { data: {} as InstanceModelChangedEvent })
  .defineEvent('sdk:message', { data: {} as SdkMessageEvent })
  .defineEvent('task:created', { data: {} as TaskCreatedEvent })
  .defineEvent('task:updated', { data: {} as TaskUpdatedEvent })
  .defineEvent('task:completed', { data: {} as TaskCompletedEvent })
  .defineEvent('permission:request', { data: {} as PermissionRequestEvent })
  .defineEvent('project:created', { data: {} as ProjectCreatedEvent })
  .defineEvent('project:updated', { data: {} as ProjectUpdatedEvent })
  .defineEvent('project:deleted', { data: {} as ProjectDeletedEvent })
  .defineEvent('connected', { data: { clientId: '' } })
  .build();

// Connection state (reactive)
export let connectionStatus = $state<'connecting' | 'connected' | 'disconnected' | 'error'>('disconnected');

// HMR-persistent client reference
declare global {
  var __sseClient: RiverClient<typeof sseEvents> | null;
  var __sseReconnectTimeout: ReturnType<typeof setTimeout> | null;
  var __sseReconnectAttempts: number;
  var __sseBaseUrl: string;
}
globalThis.__sseClient ??= null;
globalThis.__sseReconnectTimeout ??= null;
globalThis.__sseReconnectAttempts ??= 0;
globalThis.__sseBaseUrl ??= '';

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
// SSE CONNECTION FUNCTIONS
// ============================================

/**
 * Connect to SSE and wire handlers directly to river.ts client.
 */
export function setupSSEAndConnect(baseUrl: string = ''): void {
  globalThis.__sseBaseUrl = baseUrl;

  // Close existing connection
  if (globalThis.__sseClient) {
    globalThis.__sseClient.close();
    globalThis.__sseClient = null;
  }

  connectionStatus = 'connecting';

  // Create river.ts client and wire handlers directly
  globalThis.__sseClient = RiverClient.init(sseEvents, { reconnect: true });

  globalThis.__sseClient
    .prepare(`${baseUrl}/api/events`, { method: 'GET' })
    // Agent events
    .on('agent:connected', (e) => agents.handleConnected(e.data))
    .on('agent:disconnected', (e) => agents.handleDisconnected(e.data))
    .on('agent:reconnecting', (e) => agents.handleReconnecting(e.data))
    .on('agent:updated', (e) => agents.handleUpdated(e.data))
    // Instance events
    .on('instance:created', (e) => instances.handleCreated(e.data))
    .on('instance:started', (e) => instances.handleStarted(e.data))
    .on('instance:stopped', (e) => instances.handleStopped(e.data))
    .on('instance:sleeping', (e) => instances.handleSleeping(e.data))
    .on('instance:error', (e) => {
      instances.handleError(e.data);
      if (e.data.error) {
        instances.addMessage(e.data.instanceId, {
          type: 'error',
          content: e.data.error,
          timestamp: new Date(), // plain Date for timestamp, not reactive
        });
      }
    })
    .on('instance:resumed', (e) => instances.handleResumed(e.data))
    .on('instance:token_usage', (e) => instances.handleTokenUsage(e.data))
    .on('instance:model-changed', (e) => instances.handleModelChanged(e.data))
    // SDK message
    .on('sdk:message', (e) => handleSdkMessage(e.data))
    // Task events
    .on('task:created', (e) => tasks.handleCreated(e.data))
    .on('task:updated', (e) => tasks.handleUpdated(e.data))
    .on('task:completed', (e) => tasks.handleCompleted(e.data))
    // Permission events
    .on('permission:request', (e) => permissions.handleRequest(e.data))
    // Project events
    .on('project:created', (e) => projects.handleCreated(e.data))
    .on('project:updated', (e) => projects.handleUpdated(e.data))
    .on('project:deleted', (e) => projects.handleDeleted(e.data))
    // Connection events
    .on('connected', (e) => {
      connectionStatus = 'connected';
      globalThis.__sseReconnectAttempts = 0;
      console.log('[SSE] Connected to hub, clientId:', e.data.clientId);
    })
    .on('close', () => {
      console.log('[SSE] Connection closed');
      connectionStatus = 'disconnected';
      attemptReconnect();
    })
    .stream();
}

/** Attempt reconnect with exponential backoff */
function attemptReconnect(): void {
  const maxAttempts = 10;
  if (globalThis.__sseReconnectAttempts < maxAttempts) {
    const delay = Math.min(1000 * Math.pow(2, globalThis.__sseReconnectAttempts), 30000);
    console.log(`[SSE] Reconnecting in ${delay}ms (attempt ${globalThis.__sseReconnectAttempts + 1}/${maxAttempts})`);
    globalThis.__sseReconnectTimeout = setTimeout(() => {
      globalThis.__sseReconnectAttempts++;
      setupSSEAndConnect(globalThis.__sseBaseUrl);
    }, delay);
  } else {
    console.error('[SSE] Max reconnect attempts reached');
    connectionStatus = 'error';
  }
}

/**
 * Disconnect from SSE.
 */
export function disconnectSSE(): void {
  if (globalThis.__sseReconnectTimeout) {
    clearTimeout(globalThis.__sseReconnectTimeout);
    globalThis.__sseReconnectTimeout = null;
  }
  if (globalThis.__sseClient) {
    globalThis.__sseClient.close();
    globalThis.__sseClient = null;
  }
  connectionStatus = 'disconnected';
}

/** Force reconnect */
export function reconnectSSE(): void {
  disconnectSSE();
  globalThis.__sseReconnectAttempts = 0;
  setupSSEAndConnect(globalThis.__sseBaseUrl);
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
