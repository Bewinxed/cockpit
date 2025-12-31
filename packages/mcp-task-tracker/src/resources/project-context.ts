import type { TaskStorage } from '../storage.js';

/**
 * Create the project context resource handler
 */
export function createProjectContextResource(
  storage: TaskStorage,
  instanceId: string,
  projectId?: string
) {
  return {
    uri: 'context://project',
    name: 'Project Context',
    description:
      'Current project context and task summary. Provides project name, active task count, and completion statistics.',
    mimeType: 'application/json',
    handler: async () => {
      try {
        const context = await storage.getProjectContext(instanceId, projectId);

        // Format the context for easy consumption
        const formattedContext = {
          project: context.project
            ? {
                id: context.project.id,
                name: context.project.name,
                description: context.project.description ?? undefined,
                rootPath: context.project.rootPath ?? undefined,
              }
            : null,
          taskSummary: {
            total: context.taskSummary.total,
            inProgress: context.taskSummary.inProgress,
            completed: context.taskSummary.completed,
            blocked: context.taskSummary.blocked,
            cancelled: context.taskSummary.cancelled,
            overallProgress: context.taskSummary.overallProgress,
            completionRate:
              context.taskSummary.total > 0
                ? Math.round(
                    (context.taskSummary.completed / context.taskSummary.total) * 100
                  )
                : 0,
          },
          activeTasks: context.activeTasks.map((task) => ({
            id: task.id,
            title: task.title,
            description: task.description,
            type: task.type,
            progress: task.progress,
            startedAt: task.startedAt.toISOString(),
            notes: task.notes,
          })),
          summary: generateContextSummary(context),
        };

        return {
          contents: [
            {
              uri: 'context://project',
              mimeType: 'application/json',
              text: JSON.stringify(formattedContext, null, 2),
            },
          ],
        };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error occurred';
        return {
          contents: [
            {
              uri: 'context://project',
              mimeType: 'application/json',
              text: JSON.stringify({
                error: errorMessage,
                project: null,
                taskSummary: null,
                activeTasks: [],
              }),
            },
          ],
        };
      }
    },
  };
}

/**
 * Generate a human-readable context summary
 */
function generateContextSummary(context: {
  project: { name: string } | null;
  taskSummary: {
    total: number;
    inProgress: number;
    completed: number;
    blocked: number;
    overallProgress: number;
  };
  activeTasks: Array<{ title: string }>;
}): string {
  const parts: string[] = [];

  if (context.project) {
    parts.push(`Working on project: ${context.project.name}`);
  }

  if (context.taskSummary.total > 0) {
    parts.push(
      `${context.taskSummary.completed}/${context.taskSummary.total} tasks completed (${context.taskSummary.overallProgress}% overall progress)`
    );
  } else {
    parts.push('No tasks tracked yet');
  }

  if (context.taskSummary.inProgress > 0) {
    parts.push(`${context.taskSummary.inProgress} task(s) in progress`);
  }

  if (context.taskSummary.blocked > 0) {
    parts.push(`${context.taskSummary.blocked} task(s) blocked`);
  }

  if (context.activeTasks.length > 0) {
    parts.push(
      `Currently active: ${context.activeTasks.map((t) => t.title).join(', ')}`
    );
  }

  return parts.join('. ');
}
