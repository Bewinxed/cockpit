import { z } from 'zod';
import type { TaskStorage } from '../storage.js';

/**
 * Schema for create_task tool parameters
 */
export const createTaskSchema = z.object({
  title: z.string().min(1).describe('Task title'),
  description: z.string().min(1).describe('Task description'),
  type: z.enum(['major', 'minor']).describe('Task importance: major for significant work, minor for small tasks'),
  parentTaskId: z.string().optional().describe('Parent task ID for creating subtasks'),
});

export type CreateTaskParams = z.infer<typeof createTaskSchema>;

/**
 * Create the create_task tool handler
 */
export function createCreateTaskTool(storage: TaskStorage, instanceId: string, projectId?: string) {
  return {
    name: 'create_task',
    description:
      'Create a new task with timeline tracking. Use this to track your progress on work items. Major tasks are for significant work, minor tasks are for small items.',
    schema: createTaskSchema,
    handler: async (params: CreateTaskParams) => {
      try {
        const task = await storage.createTask({
          instanceId,
          projectId,
          parentTaskId: params.parentTaskId,
          title: params.title,
          description: params.description,
          type: params.type,
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                success: true,
                data: {
                  task,
                  message: `Task "${task.title}" created successfully`,
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
