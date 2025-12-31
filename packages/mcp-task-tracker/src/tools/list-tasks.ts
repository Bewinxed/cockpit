import { z } from 'zod';
import type { TaskStorage } from '../storage.js';

/**
 * Schema for list_tasks tool parameters
 */
export const listTasksSchema = z.object({
  status: z
    .enum(['in_progress', 'completed', 'blocked', 'cancelled'])
    .optional()
    .describe('Filter by task status'),
  type: z.enum(['major', 'minor']).optional().describe('Filter by task type'),
  limit: z
    .number()
    .min(1)
    .max(100)
    .optional()
    .default(20)
    .describe('Maximum number of results to return (default: 20, max: 100)'),
  parentTaskId: z
    .string()
    .nullable()
    .optional()
    .describe('Filter by parent task ID. Use null to get only top-level tasks'),
});

export type ListTasksParams = z.infer<typeof listTasksSchema>;

/**
 * Create the list_tasks tool handler
 */
export function createListTasksTool(storage: TaskStorage, instanceId: string, projectId?: string) {
  return {
    name: 'list_tasks',
    description:
      'List tasks with optional filtering by status, type, or parent task. Returns tasks ordered by most recently updated first.',
    schema: listTasksSchema,
    handler: async (params: ListTasksParams) => {
      try {
        const tasks = await storage.listTasks({
          instanceId,
          projectId,
          status: params.status,
          type: params.type,
          parentTaskId: params.parentTaskId,
          limit: params.limit ?? 20,
        });

        // Generate a summary
        const summary = {
          total: tasks.length,
          byStatus: {
            in_progress: tasks.filter((t) => t.status === 'in_progress').length,
            completed: tasks.filter((t) => t.status === 'completed').length,
            blocked: tasks.filter((t) => t.status === 'blocked').length,
            cancelled: tasks.filter((t) => t.status === 'cancelled').length,
          },
          byType: {
            major: tasks.filter((t) => t.type === 'major').length,
            minor: tasks.filter((t) => t.type === 'minor').length,
          },
        };

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                success: true,
                data: {
                  tasks,
                  summary,
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
