/**
 * Cross-store derivations — lightweight reactive values computed from multiple stores.
 *
 * Extracted from index.svelte.ts CrossStoreDerivations class to keep the facade slim.
 * All derivations use Svelte 5 $derived runes for automatic dependency tracking.
 */

import { agents } from './agents.svelte';
import { instances } from './instances.svelte';
import { projects } from './projects.svelte';
import { tasks } from './tasks.svelte';
import { ui } from './ui.svelte';
import type { Instance, ProjectGroup } from './types';

/**
 * Cross-store derivations wrapped in a class to allow export.
 * Svelte 5 does not allow exporting $derived directly from modules.
 */
class CrossStoreDerivations {
  /**
   * Populated instances with resolved agent and project names.
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
   * Dashboard stats — aggregated metrics.
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

    let filtered = this.populatedInstances;
    if (filter.type === 'running') {
      filtered = this.populatedInstances.filter((i) => i.status === 'running' || i.status === 'starting');
    } else if (filter.type === 'stopped') {
      filtered = this.populatedInstances.filter((i) => i.status === 'stopped' || i.status === 'sleeping');
    } else if (filter.type === 'agent' && filter.agentId) {
      filtered = this.populatedInstances.filter((i) => i.machineId === filter.agentId);
    }

    const groups = new Map<string | null, Instance[]>();

    for (const instance of filtered) {
      const key = instance.projectId || null;
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(instance);
    }

    const result: ProjectGroup[] = [];

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
  if (globalThis.__agentdeckCrossStoreDerivations) {
    // @ts-expect-error - globalThis extension for HMR
    return globalThis.__agentdeckCrossStoreDerivations;
  }
  const derivations = new CrossStoreDerivations();
  // @ts-expect-error - globalThis extension for HMR
  globalThis.__agentdeckCrossStoreDerivations = derivations;
  return derivations;
}

export const stores = createCrossStoreDerivations();
