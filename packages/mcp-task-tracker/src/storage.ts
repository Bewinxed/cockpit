import type { Db } from '@agentdeck/db';
import { tasks, projects, eq, and, desc, asc, sql, isNull, isNotNull } from '@agentdeck/db';
import type {
  Task,
  TaskType,
  TaskStatus,
  CreateTaskData,
  UpdateTaskData,
  TaskSummary,
} from '@agentdeck/core/types';

/**
 * Filter options for listing tasks
 */
export interface TaskFilters {
  instanceId?: string;
  projectId?: string;
  status?: TaskStatus;
  type?: TaskType;
  parentTaskId?: string | null;
  limit?: number;
  offset?: number;
}

/**
 * Options for retrieving task timeline
 */
export interface TimelineOptions {
  instanceId: string;
  since?: Date;
  includeCompleted?: boolean;
  limit?: number;
}

/**
 * Options for retrieving task history
 */
export interface HistoryOptions {
  instanceId?: string;
  projectId?: string;
  limit?: number;
}

/**
 * Project context information
 */
export interface ProjectContext {
  project: {
    id: string;
    name: string;
    description?: string | null;
    rootPath?: string | null;
  } | null;
  taskSummary: TaskSummary;
  activeTasks: Task[];
}

/**
 * Task timeline entry with duration info
 */
export interface TaskTimelineEntry extends Task {
  durationMs?: number;
}

/**
 * Task timeline result
 */
export interface TaskTimeline {
  tasks: TaskTimelineEntry[];
  stats: {
    totalTasks: number;
    completedTasks: number;
    averageDurationMs: number;
  };
}

/**
 * Generate a unique ID for tasks
 */
function generateId(): string {
  return `task_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Convert database row to Task interface
 */
function rowToTask(row: typeof tasks.$inferSelect): Task {
  return {
    id: row.id,
    instanceId: row.instanceId,
    projectId: row.projectId ?? undefined,
    parentTaskId: row.parentTaskId ?? undefined,
    title: row.title,
    description: row.description,
    type: row.type as TaskType,
    status: row.status as TaskStatus,
    progress: row.progress ?? 0,
    notes: row.notes ?? undefined,
    metadata: row.metadata as Record<string, unknown> | undefined,
    startedAt: row.startedAt,
    completedAt: row.completedAt ?? undefined,
    updatedAt: row.updatedAt,
  };
}

/**
 * TaskStorage handles all database operations for the task tracker.
 * Provides methods to create, update, query, and analyze tasks.
 */
export class TaskStorage {
  constructor(private db: Db) {}

  /**
   * Create a new task
   */
  async createTask(data: CreateTaskData): Promise<Task> {
    const now = new Date();
    const id = generateId();

    const newTask: typeof tasks.$inferInsert = {
      id,
      instanceId: data.instanceId,
      projectId: data.projectId ?? null,
      parentTaskId: data.parentTaskId ?? null,
      title: data.title,
      description: data.description,
      type: data.type,
      status: 'in_progress',
      progress: 0,
      notes: null,
      metadata: data.metadata ?? null,
      startedAt: now,
      completedAt: null,
      updatedAt: now,
    };

    await this.db.insert(tasks).values(newTask);

    return {
      id,
      instanceId: data.instanceId,
      projectId: data.projectId,
      parentTaskId: data.parentTaskId,
      title: data.title,
      description: data.description,
      type: data.type,
      status: 'in_progress',
      progress: 0,
      notes: undefined,
      metadata: data.metadata,
      startedAt: now,
      completedAt: undefined,
      updatedAt: now,
    };
  }

  /**
   * Update an existing task
   */
  async updateTask(taskId: string, data: UpdateTaskData): Promise<void> {
    const now = new Date();

    const updateData: Partial<typeof tasks.$inferInsert> = {
      updatedAt: now,
    };

    if (data.title !== undefined) {
      updateData.title = data.title;
    }
    if (data.description !== undefined) {
      updateData.description = data.description;
    }
    if (data.status !== undefined) {
      updateData.status = data.status;
      // Auto-set completedAt when status becomes completed
      if (data.status === 'completed') {
        updateData.completedAt = data.completedAt ?? now;
        updateData.progress = 100;
      }
    }
    if (data.progress !== undefined) {
      updateData.progress = data.progress;
    }
    if (data.notes !== undefined) {
      updateData.notes = data.notes;
    }
    if (data.metadata !== undefined) {
      updateData.metadata = data.metadata;
    }

    await this.db.update(tasks).set(updateData).where(eq(tasks.id, taskId));
  }

  /**
   * Get a single task by ID
   */
  async getTask(taskId: string): Promise<Task | null> {
    const result = await this.db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);

    if (result.length === 0) {
      return null;
    }

    return rowToTask(result[0]);
  }

  /**
   * List tasks with optional filtering
   */
  async listTasks(filters: TaskFilters): Promise<Task[]> {
    const conditions: ReturnType<typeof eq>[] = [];

    if (filters.instanceId) {
      conditions.push(eq(tasks.instanceId, filters.instanceId));
    }
    if (filters.projectId) {
      conditions.push(eq(tasks.projectId, filters.projectId));
    }
    if (filters.status) {
      conditions.push(eq(tasks.status, filters.status));
    }
    if (filters.type) {
      conditions.push(eq(tasks.type, filters.type));
    }
    if (filters.parentTaskId !== undefined) {
      if (filters.parentTaskId === null) {
        conditions.push(isNull(tasks.parentTaskId));
      } else {
        conditions.push(eq(tasks.parentTaskId, filters.parentTaskId));
      }
    }

    const limit = filters.limit ?? 20;
    const offset = filters.offset ?? 0;

    let query = this.db
      .select()
      .from(tasks)
      .orderBy(desc(tasks.updatedAt))
      .limit(limit)
      .offset(offset);

    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as typeof query;
    }

    const result = await query;
    return result.map(rowToTask);
  }

  /**
   * Get task timeline for context restoration
   */
  async getTimeline(options: TimelineOptions): Promise<TaskTimeline> {
    const conditions: ReturnType<typeof eq>[] = [eq(tasks.instanceId, options.instanceId)];

    if (options.since) {
      conditions.push(sql`${tasks.startedAt} >= ${options.since}` as unknown as ReturnType<typeof eq>);
    }

    if (!options.includeCompleted) {
      conditions.push(
        sql`${tasks.status} != 'completed' AND ${tasks.status} != 'cancelled'` as unknown as ReturnType<typeof eq>
      );
    }

    const limit = options.limit ?? 50;

    const result = await this.db
      .select()
      .from(tasks)
      .where(and(...conditions))
      .orderBy(desc(tasks.startedAt))
      .limit(limit);

    const taskEntries: TaskTimelineEntry[] = result.map((row) => {
      const task = rowToTask(row);
      let durationMs: number | undefined;

      if (task.completedAt) {
        durationMs = task.completedAt.getTime() - task.startedAt.getTime();
      } else {
        durationMs = Date.now() - task.startedAt.getTime();
      }

      return { ...task, durationMs };
    });

    const completedTasks = taskEntries.filter((t) => t.status === 'completed');
    const totalDuration = completedTasks.reduce((sum, t) => sum + (t.durationMs ?? 0), 0);
    const averageDurationMs = completedTasks.length > 0 ? totalDuration / completedTasks.length : 0;

    return {
      tasks: taskEntries,
      stats: {
        totalTasks: taskEntries.length,
        completedTasks: completedTasks.length,
        averageDurationMs,
      },
    };
  }

  /**
   * Get project context and task summary
   */
  async getProjectContext(instanceId: string, projectId?: string): Promise<ProjectContext> {
    // Get project info if projectId provided
    let project: ProjectContext['project'] = null;

    if (projectId) {
      const projectResult = await this.db
        .select()
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1);

      if (projectResult.length > 0) {
        const p = projectResult[0];
        project = {
          id: p.id,
          name: p.name,
          description: p.description,
          rootPath: p.rootPath,
        };
      }
    }

    // Get task summary
    const allTasks = await this.db
      .select()
      .from(tasks)
      .where(eq(tasks.instanceId, instanceId));

    const summary: TaskSummary = {
      total: allTasks.length,
      inProgress: allTasks.filter((t) => t.status === 'in_progress').length,
      completed: allTasks.filter((t) => t.status === 'completed').length,
      blocked: allTasks.filter((t) => t.status === 'blocked').length,
      cancelled: allTasks.filter((t) => t.status === 'cancelled').length,
      overallProgress: 0,
    };

    if (summary.total > 0) {
      const totalProgress = allTasks.reduce((sum, t) => sum + (t.progress ?? 0), 0);
      summary.overallProgress = Math.round(totalProgress / summary.total);
    }

    // Get active tasks
    const activeTasks = await this.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.instanceId, instanceId), eq(tasks.status, 'in_progress')))
      .orderBy(desc(tasks.updatedAt))
      .limit(10);

    return {
      project,
      taskSummary: summary,
      activeTasks: activeTasks.map(rowToTask),
    };
  }

  /**
   * Get task history for context restoration
   */
  async getTaskHistory(options: HistoryOptions): Promise<Task[]> {
    const conditions: ReturnType<typeof eq>[] = [];

    if (options.instanceId) {
      conditions.push(eq(tasks.instanceId, options.instanceId));
    }
    if (options.projectId) {
      conditions.push(eq(tasks.projectId, options.projectId));
    }

    const limit = options.limit ?? 50;

    let query = this.db
      .select()
      .from(tasks)
      .orderBy(desc(tasks.updatedAt))
      .limit(limit);

    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as typeof query;
    }

    const result = await query;
    return result.map(rowToTask);
  }
}
