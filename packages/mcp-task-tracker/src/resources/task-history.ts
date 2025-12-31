import type { TaskStorage } from '../storage.js';

/**
 * Create the task history resource handler
 */
export function createTaskHistoryResource(
  storage: TaskStorage,
  instanceId: string,
  projectId?: string
) {
  return {
    uri: 'context://tasks/history',
    name: 'Task History',
    description:
      'Historical task data for context restoration. Returns the last 50 tasks with their status, notes, and timeline information.',
    mimeType: 'application/json',
    handler: async () => {
      try {
        const tasks = await storage.getTaskHistory({
          instanceId,
          projectId,
          limit: 50,
        });

        // Format tasks for context restoration
        const formattedTasks = tasks.map((task) => ({
          id: task.id,
          title: task.title,
          description: task.description,
          type: task.type,
          status: task.status,
          progress: task.progress,
          notes: task.notes,
          parentTaskId: task.parentTaskId,
          startedAt: task.startedAt.toISOString(),
          completedAt: task.completedAt?.toISOString(),
          updatedAt: task.updatedAt.toISOString(),
          duration: task.completedAt
            ? formatDuration(task.completedAt.getTime() - task.startedAt.getTime())
            : formatDuration(Date.now() - task.startedAt.getTime()),
        }));

        // Generate statistics
        const stats = {
          totalTasks: tasks.length,
          completed: tasks.filter((t) => t.status === 'completed').length,
          inProgress: tasks.filter((t) => t.status === 'in_progress').length,
          blocked: tasks.filter((t) => t.status === 'blocked').length,
          cancelled: tasks.filter((t) => t.status === 'cancelled').length,
          majorTasks: tasks.filter((t) => t.type === 'major').length,
          minorTasks: tasks.filter((t) => t.type === 'minor').length,
        };

        // Build task hierarchy for nested view
        const taskHierarchy = buildTaskHierarchy(formattedTasks);

        // Generate context restoration hints
        const contextHints = generateContextHints(tasks);

        return {
          contents: [
            {
              uri: 'context://tasks/history',
              mimeType: 'application/json',
              text: JSON.stringify(
                {
                  tasks: formattedTasks,
                  hierarchy: taskHierarchy,
                  stats,
                  contextHints,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error occurred';
        return {
          contents: [
            {
              uri: 'context://tasks/history',
              mimeType: 'application/json',
              text: JSON.stringify({
                error: errorMessage,
                tasks: [],
                hierarchy: [],
                stats: null,
                contextHints: [],
              }),
            },
          ],
        };
      }
    },
  };
}

/**
 * Format milliseconds to human-readable duration
 */
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
  } else if (minutes > 0) {
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  } else {
    return `${seconds}s`;
  }
}

/**
 * Build a hierarchical structure of tasks
 */
function buildTaskHierarchy(
  tasks: Array<{
    id: string;
    title: string;
    status: string;
    parentTaskId?: string;
  }>
): Array<{
  id: string;
  title: string;
  status: string;
  subtasks: Array<{ id: string; title: string; status: string }>;
}> {
  const taskMap = new Map(tasks.map((t) => [t.id, t]));
  const rootTasks = tasks.filter((t) => !t.parentTaskId);

  return rootTasks.map((task) => ({
    id: task.id,
    title: task.title,
    status: task.status,
    subtasks: tasks
      .filter((t) => t.parentTaskId === task.id)
      .map((st) => ({
        id: st.id,
        title: st.title,
        status: st.status,
      })),
  }));
}

/**
 * Generate context hints to help restore working state
 */
function generateContextHints(
  tasks: Array<{
    title: string;
    status: string;
    type: string;
    notes?: string;
    updatedAt: Date;
  }>
): string[] {
  const hints: string[] = [];

  // Find the most recently updated task
  const sortedByUpdate = [...tasks].sort(
    (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()
  );

  if (sortedByUpdate.length > 0) {
    const mostRecent = sortedByUpdate[0];
    hints.push(
      `Most recent activity: "${mostRecent.title}" (${mostRecent.status})`
    );
  }

  // Find in-progress tasks
  const inProgressTasks = tasks.filter((t) => t.status === 'in_progress');
  if (inProgressTasks.length > 0) {
    hints.push(
      `Tasks currently in progress: ${inProgressTasks.map((t) => t.title).join(', ')}`
    );
  }

  // Find blocked tasks that need attention
  const blockedTasks = tasks.filter((t) => t.status === 'blocked');
  if (blockedTasks.length > 0) {
    hints.push(
      `Blocked tasks requiring attention: ${blockedTasks.map((t) => t.title).join(', ')}`
    );
  }

  // Identify major tasks
  const majorInProgress = tasks.filter(
    (t) => t.type === 'major' && t.status === 'in_progress'
  );
  if (majorInProgress.length > 0) {
    hints.push(
      `Major tasks in progress: ${majorInProgress.map((t) => t.title).join(', ')}`
    );
  }

  // Add notes from recent tasks as context
  const recentWithNotes = sortedByUpdate
    .filter((t) => t.notes && t.status === 'in_progress')
    .slice(0, 3);
  if (recentWithNotes.length > 0) {
    recentWithNotes.forEach((t) => {
      hints.push(`Note on "${t.title}": ${t.notes}`);
    });
  }

  return hints;
}
