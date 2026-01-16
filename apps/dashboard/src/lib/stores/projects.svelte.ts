import { SvelteMap } from 'svelte/reactivity';
import type { Project } from './types';
import type {
  ProjectCreatedEvent,
  ProjectUpdatedEvent,
  ProjectDeletedEvent,
} from '@cockpit/core/dashboard';

/**
 * Project store - manages project state.
 * Uses SvelteMap for reactive mutations without reassignment.
 */
class ProjectStore {
  #projects = $state(new SvelteMap<string, Project>());

  /** Get the underlying map (read-only access for iteration) */
  get all() {
    return this.#projects;
  }

  /** Get project count */
  get size() {
    return this.#projects.size;
  }

  /** Derived: projects sorted by name */
  readonly sorted = $derived(
    Array.from(this.#projects.values()).sort((a, b) => a.name.localeCompare(b.name))
  );

  // ========================================
  // Mutations
  // ========================================

  /** Set or update a project */
  set(id: string, project: Project): void {
    this.#projects.set(id, project);
  }

  /** Get a project by ID */
  get(id: string): Project | undefined {
    return this.#projects.get(id);
  }

  /** Check if a project exists */
  has(id: string): boolean {
    return this.#projects.has(id);
  }

  /** Update project with partial data */
  update(id: string, updates: Partial<Project>): void {
    const project = this.#projects.get(id);
    if (project) {
      this.#projects.set(id, { ...project, ...updates });
    }
  }

  /** Delete a project */
  delete(id: string): boolean {
    return this.#projects.delete(id);
  }

  /** Clear all projects */
  clear(): void {
    this.#projects.clear();
  }

  /** Bulk set projects (for SSR initialization) */
  setAll(projectsMap: Map<string, Project>): void {
    this.#projects.clear();
    for (const [id, project] of projectsMap) {
      this.#projects.set(id, project);
    }
  }

  /** Initialize from SSR data */
  initializeFromSSR(projectsData: Array<{
    id: string;
    name: string;
    description?: string;
    rootPath?: string;
    machineId?: string;
    createdAt: string;
    updatedAt: string;
  }>): void {
    this.#projects.clear();
    for (const p of projectsData) {
      this.#projects.set(p.id, {
        id: p.id,
        name: p.name,
        description: p.description,
        rootPath: p.rootPath,
        machineId: p.machineId,
        instanceCount: 0,
        createdAt: new Date(p.createdAt),
        updatedAt: new Date(p.updatedAt),
      });
    }
  }

  // ========================================
  // WebSocket Event Handlers
  // ========================================

  /** Handle project:created WebSocket event */
  handleCreated(event: ProjectCreatedEvent): void {
    const createdAt = typeof event.createdAt === 'string' ? new Date(event.createdAt) : event.createdAt;
    const updatedAt = typeof event.updatedAt === 'string' ? new Date(event.updatedAt) : event.updatedAt;
    this.#projects.set(event.id, {
      id: event.id,
      name: event.name,
      description: event.description || undefined,
      rootPath: event.rootPath || undefined,
      machineId: event.machineId || undefined,
      instanceCount: 0,
      createdAt,
      updatedAt,
    });
  }

  /** Handle project:updated WebSocket event */
  handleUpdated(event: ProjectUpdatedEvent): void {
    const project = this.#projects.get(event.id);
    const updatedAt = typeof event.updatedAt === 'string' ? new Date(event.updatedAt) : event.updatedAt;
    if (project) {
      this.#projects.set(event.id, {
        ...project,
        name: event.name,
        description: event.description || undefined,
        rootPath: event.rootPath || undefined,
        machineId: event.machineId || undefined,
        updatedAt,
      });
    }
  }

  /** Handle project:deleted WebSocket event */
  handleDeleted(event: ProjectDeletedEvent): void {
    this.#projects.delete(event.id);
  }
}

// Singleton with HMR persistence
function createProjectStore(): ProjectStore {
  // @ts-expect-error - globalThis extension for HMR
  if (globalThis.__cockpitProjectStore) {
    // @ts-expect-error - globalThis extension for HMR
    return globalThis.__cockpitProjectStore;
  }
  const store = new ProjectStore();
  // @ts-expect-error - globalThis extension for HMR
  globalThis.__cockpitProjectStore = store;
  return store;
}

export const projects = createProjectStore();
