import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { TaskStorage } from './storage.js';
import {
  createCreateTaskTool,
  createTaskSchema,
} from './tools/create-task.js';
import {
  createUpdateTaskTool,
  updateTaskSchema,
} from './tools/update-task.js';
import {
  createListTasksTool,
  listTasksSchema,
} from './tools/list-tasks.js';
import {
  createGetTimelineTool,
  getTimelineSchema,
} from './tools/timeline.js';
import { createProjectContextResource } from './resources/project-context.js';
import { createTaskHistoryResource } from './resources/task-history.js';

/**
 * Options for creating a task tracker MCP server
 */
export interface TaskTrackerOptions {
  /** Unique identifier for the Claude Code instance */
  instanceId: string;
  /** Optional project ID to associate tasks with */
  projectId?: string;
  /** Storage instance for database operations */
  storage: TaskStorage;
}

/**
 * Create a new MCP server for task tracking.
 *
 * This server provides tools and resources for Claude Code instances
 * to track their progress on tasks and restore context after breaks.
 *
 * @example
 * ```typescript
 * import { createTaskTrackerServer, TaskStorage } from '@cockpit/mcp-task-tracker';
 * import { createDb } from '@cockpit/db';
 *
 * const db = createDb('./cockpit.db');
 * const storage = new TaskStorage(db);
 *
 * const server = createTaskTrackerServer({
 *   instanceId: 'instance-123',
 *   projectId: 'project-456',
 *   storage,
 * });
 * ```
 */
export function createTaskTrackerServer(options: TaskTrackerOptions): McpServer {
  const { instanceId, projectId, storage } = options;

  const server = new McpServer({
    name: 'task-tracker',
    version: '1.0.0',
  });

  // Create tool handlers
  const createTaskTool = createCreateTaskTool(storage, instanceId, projectId);
  const updateTaskTool = createUpdateTaskTool(storage);
  const listTasksTool = createListTasksTool(storage, instanceId, projectId);
  const getTimelineTool = createGetTimelineTool(storage, instanceId);

  // Create resource handlers
  const projectContextResource = createProjectContextResource(storage, instanceId, projectId);
  const taskHistoryResource = createTaskHistoryResource(storage, instanceId, projectId);

  // Register tools
  server.tool(
    createTaskTool.name,
    createTaskTool.description,
    {
      title: createTaskSchema.shape.title,
      description: createTaskSchema.shape.description,
      type: createTaskSchema.shape.type,
      parentTaskId: createTaskSchema.shape.parentTaskId,
    },
    async (params) => {
      return createTaskTool.handler(params as z.infer<typeof createTaskSchema>);
    }
  );

  server.tool(
    updateTaskTool.name,
    updateTaskTool.description,
    {
      taskId: updateTaskSchema.shape.taskId,
      status: updateTaskSchema.shape.status,
      progress: updateTaskSchema.shape.progress,
      notes: updateTaskSchema.shape.notes,
      title: updateTaskSchema.shape.title,
      description: updateTaskSchema.shape.description,
    },
    async (params) => {
      return updateTaskTool.handler(params as z.infer<typeof updateTaskSchema>);
    }
  );

  server.tool(
    listTasksTool.name,
    listTasksTool.description,
    {
      status: listTasksSchema.shape.status,
      type: listTasksSchema.shape.type,
      limit: listTasksSchema.shape.limit,
      parentTaskId: listTasksSchema.shape.parentTaskId,
    },
    async (params) => {
      return listTasksTool.handler(params as z.infer<typeof listTasksSchema>);
    }
  );

  server.tool(
    getTimelineTool.name,
    getTimelineTool.description,
    {
      since: getTimelineSchema.shape.since,
      includeCompleted: getTimelineSchema.shape.includeCompleted,
      limit: getTimelineSchema.shape.limit,
    },
    async (params) => {
      return getTimelineTool.handler(params as z.infer<typeof getTimelineSchema>);
    }
  );

  // Register resources
  server.resource(
    projectContextResource.uri,
    projectContextResource.name,
    async () => {
      return projectContextResource.handler();
    }
  );

  server.resource(
    taskHistoryResource.uri,
    taskHistoryResource.name,
    async () => {
      return taskHistoryResource.handler();
    }
  );

  return server;
}
