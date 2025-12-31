import { z } from 'zod';
import type { TaskStorage } from '../storage.js';

/**
 * Schema for update_task tool parameters
 */
export const updateTaskSchema = z.object({
  taskId: z.string().min(1).describe('Task ID to update'),
  status: z
    .enum(['in_progress', 'completed', 'blocked', 'cancelled'])
    .optional()
    .describe('New status for the task'),
  progress: z
    .number()
    .min(0)
    .max(100)
    .optional()
    .describe('Progress percentage (0-100)'),
  notes: z.string().optional().describe('Additional notes or context about the task'),
  title: z.string().optional().describe('Updated task title'),
  description: z.string().optional().describe('Updated task description'),
});

export type UpdateTaskParams = z.infer<typeof updateTaskSchema>;

/**
 * Create the update_task tool handler
 */
export function createUpdateTaskTool(storage: TaskStorage) {
  return {
    name: 'update_task',
    description:
      "Update an existing task's status, progress, or details. Use this to track progress on your work items and mark tasks as completed, blocked, or cancelled.",
    schema: updateTaskSchema,
    handler: async (params: UpdateTaskParams) => {
      try {
        // First, verify the task exists
        const existingTask = await storage.getTask(params.taskId);
        if (!existingTask) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  success: false,
                  error: `Task with ID "${params.taskId}" not found`,
                }),
              },
            ],
          };
        }

        // Prepare update data
        const updateData: {
          status?: 'in_progress' | 'completed' | 'blocked' | 'cancelled';
          progress?: number;
          notes?: string;
          title?: string;
          description?: string;
        } = {};

        if (params.status !== undefined) {
          updateData.status = params.status;
        }
        if (params.progress !== undefined) {
          updateData.progress = params.progress;
        }
        if (params.notes !== undefined) {
          updateData.notes = params.notes;
        }
        if (params.title !== undefined) {
          updateData.title = params.title;
        }
        if (params.description !== undefined) {
          updateData.description = params.description;
        }

        await storage.updateTask(params.taskId, updateData);

        // Get the updated task
        const updatedTask = await storage.getTask(params.taskId);

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                success: true,
                data: {
                  task: updatedTask,
                  message: `Task "${updatedTask?.title}" updated successfully`,
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
