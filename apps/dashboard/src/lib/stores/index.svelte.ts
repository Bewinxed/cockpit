/**
 * Store facade - re-exports entity stores and provides cross-store derivations.
 *
 * This is the main entry point for store access. Import from here, not individual files.
 *
 * Usage:
 *   import { agents, instances, ui, stats } from '$lib/stores';
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

// Re-export entity stores
export { agents } from './agents.svelte';
export { instances, type ToolInvocationData } from './instances.svelte';
export { projects } from './projects.svelte';
export { tasks } from './tasks.svelte';
export { permissions } from './permissions.svelte';
export { ui } from './ui.svelte';
export { connection } from './connection.svelte';

// Import stores for cross-store derivations
import { agents } from './agents.svelte';
import { instances } from './instances.svelte';
import { projects } from './projects.svelte';
import { tasks } from './tasks.svelte';
import { permissions } from './permissions.svelte';
import { ui } from './ui.svelte';
import type { Instance, ProjectGroup } from './types';

// ============================================
// CROSS-STORE DERIVED VALUES
// ============================================

/**
 * Populated instances with resolved agent and project names.
 * Use this for display in UI components.
 */
export const populatedInstances = $derived.by(() => {
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
export const runningInstances = $derived(
  populatedInstances.filter((i) => i.status === 'running' || i.status === 'starting')
);

/**
 * Recent instances sorted by last activity (populated).
 */
export const recentInstances = $derived(
  [...populatedInstances]
    .sort((a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime())
    .slice(0, 5)
);

/**
 * Ad-hoc instances (no project, populated).
 */
export const adhocInstances = $derived(
  populatedInstances
    .filter((i) => !i.projectId)
    .sort((a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime())
);

/**
 * Project instances (has project, populated).
 */
export const projectInstances = $derived(
  populatedInstances
    .filter((i) => i.projectId)
    .sort((a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime())
);

/**
 * Dashboard stats - aggregated metrics.
 */
export const stats = $derived.by(() => ({
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
export const instancesByProject = $derived.by((): ProjectGroup[] => {
  const filter = ui.sidebarFilter;
  const collapsed = ui.collapsedProjects;

  // Apply filter first
  let filtered = populatedInstances;
  if (filter.type === 'running') {
    filtered = populatedInstances.filter((i) => i.status === 'running' || i.status === 'starting');
  } else if (filter.type === 'stopped') {
    filtered = populatedInstances.filter((i) => i.status === 'stopped' || i.status === 'sleeping');
  } else if (filter.type === 'agent' && filter.agentId) {
    filtered = populatedInstances.filter((i) => i.machineId === filter.agentId);
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
export const selectedInstance = $derived(
  ui.selectedInstanceId ? instances.get(ui.selectedInstanceId) || null : null
);

// ============================================
// LEGACY COMPATIBILITY EXPORTS
// ============================================
// These maintain backwards compatibility with existing code using the old API.
// New code should use the entity stores directly.

// Writable-like access for migration period
// Components can use: agents.set(), instances.update(), etc.

/**
 * @deprecated Use agents.online directly
 */
export const onlineAgents = $derived(agents.online);

/**
 * @deprecated Use tasks.active directly
 */
export const activeTasks = $derived(tasks.active);

/**
 * @deprecated Use permissions.sorted directly
 */
export const allPendingPermissions = $derived(permissions.sorted);

/**
 * @deprecated Use permissions.count directly
 */
export const pendingPermissionCount = $derived(permissions.count);
