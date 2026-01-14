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
export { connection } from './connection.svelte';

// Re-export SDK message handler
export { handleSdkMessage } from './sdk-message-handler';

// Import stores for cross-store derivations and initialization
import { agents } from './agents.svelte';
import { instances } from './instances.svelte';
import { projects } from './projects.svelte';
import { tasks } from './tasks.svelte';
import { permissions } from './permissions.svelte';
import { ui } from './ui.svelte';
import { connection } from './connection.svelte';
import { handleSdkMessage } from './sdk-message-handler';
import type { Instance, ProjectGroup } from './types';
import type { SdkMessageEvent } from './sse-events';

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
// SSE CONNECTION SETUP
// ============================================

/**
 * Set up SSE event handlers and connect to hub.
 * Wires all entity store handlers to the connection store.
 */
export function setupSSEAndConnect(baseUrl: string = ''): void {
  // Agent events
  connection.on('agent:connected', (data) => agents.handleConnected(data));
  connection.on('agent:disconnected', (data) => agents.handleDisconnected(data));
  connection.on('agent:reconnecting', (data) => agents.handleReconnecting(data));
  connection.on('agent:updated', (data) => agents.handleUpdated(data));

  // Instance events
  connection.on('instance:created', (data) => instances.handleCreated(data));
  connection.on('instance:started', (data) => instances.handleStarted(data));
  connection.on('instance:stopped', (data) => instances.handleStopped(data));
  connection.on('instance:sleeping', (data) => instances.handleSleeping(data));
  connection.on('instance:error', (data) => {
    instances.handleError(data);
    // Display error as message. Auth is handled separately via sdk:message with subtype 'login_prompt'.
    if (data.error) {
      instances.addMessage(data.instanceId, {
        type: 'error',
        content: data.error,
        timestamp: new Date(),
      });
    }
  });
  connection.on('instance:resumed', (data) => instances.handleResumed(data));
  connection.on('instance:token_usage', (data) => instances.handleTokenUsage(data));
  connection.on('instance:model-changed', (data) => instances.handleModelChanged(data));

  // SDK message event - uses the extracted handler
  connection.on('sdk:message', (data) => handleSdkMessage(data as SdkMessageEvent));

  // Task events
  connection.on('task:created', (data) => tasks.handleCreated(data));
  connection.on('task:updated', (data) => tasks.handleUpdated(data));
  connection.on('task:completed', (data) => tasks.handleCompleted(data));

  // Permission events
  connection.on('permission:request', (data) => permissions.handleRequest(data));

  // Project events
  connection.on('project:created', (data) => projects.handleCreated(data));
  connection.on('project:updated', (data) => projects.handleUpdated(data));
  connection.on('project:deleted', (data) => projects.handleDeleted(data));

  // Connect to SSE
  connection.connect(baseUrl);
}

/**
 * Disconnect from SSE.
 */
export function disconnectSSE(): void {
  connection.disconnect();
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

  // ============================================
  // LEGACY COMPATIBILITY (deprecated)
  // ============================================

  /** @deprecated Use agents.online directly */
  readonly onlineAgents = $derived(agents.online);

  /** @deprecated Use tasks.active directly */
  readonly activeTasks = $derived(tasks.active);

  /** @deprecated Use permissions.sorted directly */
  readonly allPendingPermissions = $derived(permissions.sorted);

  /** @deprecated Use permissions.count directly */
  readonly pendingPermissionCount = $derived(permissions.count);
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
