import { SvelteMap } from 'svelte/reactivity';
import type { Task } from './types';
import type {
  TaskCreatedEvent,
  TaskUpdatedEvent,
  TaskCompletedEvent,
} from './sse-events';

/**
 * Task store - manages task state.
 * Uses SvelteMap for reactive mutations without reassignment.
 */
class TaskStore {
  #tasks = $state(new SvelteMap<string, Task>());

  /** Get the underlying map (read-only access for iteration) */
  get all() {
    return this.#tasks;
  }

  /** Get task count */
  get size() {
    return this.#tasks.size;
  }

  /** Derived: active (in_progress) tasks only */
  readonly active = $derived(
    Array.from(this.#tasks.values()).filter(t => t.status === 'in_progress')
  );

  /** Derived: count of active tasks */
  readonly activeCount = $derived(this.active.length);

  // ========================================
  // Mutations
  // ========================================

  /** Set or update a task */
  set(id: string, task: Task): void {
    this.#tasks.set(id, task);
  }

  /** Get a task by ID */
  get(id: string): Task | undefined {
    return this.#tasks.get(id);
  }

  /** Check if a task exists */
  has(id: string): boolean {
    return this.#tasks.has(id);
  }

  /** Update task status */
  updateStatus(id: string, status: Task['status']): void {
    const task = this.#tasks.get(id);
    if (task) {
      this.#tasks.set(id, {
        ...task,
        status,
        completedAt: status === 'completed' ? new Date() : task.completedAt,
      });
    }
  }

  /** Update task progress */
  updateProgress(id: string, progress: number): void {
    const task = this.#tasks.get(id);
    if (task) {
      this.#tasks.set(id, { ...task, progress });
    }
  }

  /** Update task with partial data */
  update(id: string, updates: Partial<Task>): void {
    const task = this.#tasks.get(id);
    if (task) {
      this.#tasks.set(id, { ...task, ...updates });
    }
  }

  /** Delete a task */
  delete(id: string): boolean {
    return this.#tasks.delete(id);
  }

  /** Clear all tasks */
  clear(): void {
    this.#tasks.clear();
  }

  /** Get tasks for a specific instance */
  getByInstance(instanceId: string): Task[] {
    return Array.from(this.#tasks.values()).filter(t => t.instanceId === instanceId);
  }

  // ========================================
  // SSE Event Handlers
  // ========================================

  /** Handle task:created SSE event */
  handleCreated(event: TaskCreatedEvent): void {
    const startedAt = typeof event.startedAt === 'string' ? new Date(event.startedAt) : event.startedAt;
    const updatedAt = typeof event.updatedAt === 'string' ? new Date(event.updatedAt) : event.updatedAt;
    const completedAt = event.completedAt
      ? typeof event.completedAt === 'string' ? new Date(event.completedAt) : event.completedAt
      : undefined;

    this.#tasks.set(event.id, {
      id: event.id,
      instanceId: event.instanceId,
      projectId: event.projectId || undefined,
      parentTaskId: event.parentTaskId || undefined,
      title: event.title,
      description: event.description,
      type: event.type,
      status: event.status,
      progress: event.progress || 0,
      startedAt,
      completedAt,
      updatedAt,
    });
  }

  /** Handle task:updated SSE event */
  handleUpdated(event: TaskUpdatedEvent): void {
    const updatedAt = typeof event.updatedAt === 'string' ? new Date(event.updatedAt) : event.updatedAt;
    const completedAt = event.completedAt
      ? typeof event.completedAt === 'string' ? new Date(event.completedAt) : event.completedAt
      : undefined;

    const task = this.#tasks.get(event.id);
    if (task) {
      this.#tasks.set(event.id, {
        ...task,
        title: event.title,
        description: event.description,
        status: event.status,
        progress: event.progress || task.progress,
        completedAt,
        updatedAt,
      });
    }
  }

  /** Handle task:completed SSE event */
  handleCompleted(event: TaskCompletedEvent): void {
    const completedAt = typeof event.completedAt === 'string' ? new Date(event.completedAt) : event.completedAt;
    const task = this.#tasks.get(event.id);
    if (task) {
      this.#tasks.set(event.id, {
        ...task,
        status: 'completed',
        completedAt,
      });
    }
  }
}

// Singleton with HMR persistence
function createTaskStore(): TaskStore {
  // @ts-expect-error - globalThis extension for HMR
  if (globalThis.__cockpitTaskStore) {
    // @ts-expect-error - globalThis extension for HMR
    return globalThis.__cockpitTaskStore;
  }
  const store = new TaskStore();
  // @ts-expect-error - globalThis extension for HMR
  globalThis.__cockpitTaskStore = store;
  return store;
}

export const tasks = createTaskStore();
