/**
 * Task type classification
 */
export type TaskType = 'major' | 'minor';

/**
 * Possible states of a task
 */
export type TaskStatus = 'in_progress' | 'completed' | 'blocked' | 'cancelled';

/**
 * Represents a tracked task being worked on by a Claude Code instance.
 * Tasks can be hierarchical (parent/child relationships) for complex work.
 */
export interface Task {
  /** Unique identifier for the task */
  id: string;

  /** Instance working on this task */
  instanceId: string;

  /** Project this task belongs to (if any) */
  projectId?: string;

  /** Parent task ID for sub-tasks */
  parentTaskId?: string;

  /** Short title of the task */
  title: string;

  /** Detailed description of what the task involves */
  description: string;

  /** Type/importance of the task */
  type: TaskType;

  /** Current status of the task */
  status: TaskStatus;

  /** Progress percentage (0-100) */
  progress: number;

  /** Additional notes or context */
  notes?: string;

  /** Arbitrary metadata for extensibility */
  metadata?: Record<string, unknown>;

  /** When the task was started */
  startedAt: Date;

  /** When the task was completed (if completed) */
  completedAt?: Date;

  /** When the task was last updated */
  updatedAt: Date;
}

/**
 * Data required to create a new task
 */
export interface CreateTaskData {
  instanceId: string;
  projectId?: string;
  parentTaskId?: string;
  title: string;
  description: string;
  type: TaskType;
  metadata?: Record<string, unknown>;
}

/**
 * Data for updating an existing task
 */
export interface UpdateTaskData {
  title?: string;
  description?: string;
  status?: TaskStatus;
  progress?: number;
  notes?: string;
  metadata?: Record<string, unknown>;
  completedAt?: Date;
}

/**
 * Summary of task progress for an instance or project
 */
export interface TaskSummary {
  /** Total number of tasks */
  total: number;

  /** Number of tasks in progress */
  inProgress: number;

  /** Number of completed tasks */
  completed: number;

  /** Number of blocked tasks */
  blocked: number;

  /** Number of cancelled tasks */
  cancelled: number;

  /** Overall progress percentage */
  overallProgress: number;
}
