import { z } from 'zod';
import type { TaskStorage } from '../storage.js';

/**
 * Schema for get_timeline tool parameters
 */
export const getTimelineSchema = z.object({
  since: z
    .string()
    .optional()
    .describe('ISO date string to filter tasks from. Only tasks started after this date are included'),
  includeCompleted: z
    .boolean()
    .optional()
    .default(false)
    .describe('Whether to include completed and cancelled tasks (default: false)'),
  limit: z
    .number()
    .min(1)
    .max(100)
    .optional()
    .default(50)
    .describe('Maximum number of tasks to return (default: 50, max: 100)'),
});

export type GetTimelineParams = z.infer<typeof getTimelineSchema>;

/**
 * Create the get_timeline tool handler
 */
export function createGetTimelineTool(storage: TaskStorage, instanceId: string) {
  return {
    name: 'get_timeline',
    description:
      'Get task timeline for context restoration. Shows tasks with their duration and helps understand what work has been done. Useful for resuming work after a break or context switch.',
    schema: getTimelineSchema,
    handler: async (params: GetTimelineParams) => {
      try {
        const since = params.since ? new Date(params.since) : undefined;

        // Validate the date if provided
        if (params.since && isNaN(since!.getTime())) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  success: false,
                  error: `Invalid date format: "${params.since}". Please use ISO 8601 format (e.g., 2024-01-15T10:30:00Z)`,
                }),
              },
            ],
          };
        }

        const timeline = await storage.getTimeline({
          instanceId,
          since,
          includeCompleted: params.includeCompleted ?? false,
          limit: params.limit ?? 50,
        });

        // Format durations for readability
        const formattedTasks = timeline.tasks.map((task) => ({
          ...task,
          durationFormatted: formatDuration(task.durationMs),
        }));

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                success: true,
                data: {
                  tasks: formattedTasks,
                  stats: {
                    ...timeline.stats,
                    averageDurationFormatted: formatDuration(timeline.stats.averageDurationMs),
                  },
                  context: generateContextSummary(formattedTasks),
                },
              }),
            },
          ],
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                success: false,
                error: errorMessage,
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
function formatDuration(ms?: number): string {
  if (ms === undefined || ms === 0) {
    return 'N/A';
  }

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
 * Generate a context summary from timeline tasks
 */
function generateContextSummary(
  tasks: Array<{ title: string; status: string; type: string; notes?: string }>
): string {
  if (tasks.length === 0) {
    return 'No tasks in the timeline.';
  }

  const inProgress = tasks.filter((t) => t.status === 'in_progress');
  const blocked = tasks.filter((t) => t.status === 'blocked');
  const majorTasks = tasks.filter((t) => t.type === 'major');

  const parts: string[] = [];

  if (inProgress.length > 0) {
    parts.push(`Currently working on: ${inProgress.map((t) => t.title).join(', ')}`);
  }

  if (blocked.length > 0) {
    parts.push(`Blocked tasks: ${blocked.map((t) => t.title).join(', ')}`);
  }

  if (majorTasks.length > 0 && inProgress.length === 0) {
    parts.push(`Major tasks: ${majorTasks.map((t) => t.title).join(', ')}`);
  }

  return parts.length > 0 ? parts.join('. ') : 'Timeline retrieved successfully.';
}
