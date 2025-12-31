// Main server export
export { createTaskTrackerServer } from './server.js';
export type { TaskTrackerOptions } from './server.js';

// Storage export
export { TaskStorage } from './storage.js';
export type {
  TaskFilters,
  TimelineOptions,
  HistoryOptions,
  ProjectContext,
  TaskTimelineEntry,
  TaskTimeline,
} from './storage.js';

// Tool exports (for advanced usage)
export {
  createCreateTaskTool,
  createTaskSchema,
  type CreateTaskParams,
} from './tools/create-task.js';
export {
  createUpdateTaskTool,
  updateTaskSchema,
  type UpdateTaskParams,
} from './tools/update-task.js';
export {
  createListTasksTool,
  listTasksSchema,
  type ListTasksParams,
} from './tools/list-tasks.js';
export {
  createGetTimelineTool,
  getTimelineSchema,
  type GetTimelineParams,
} from './tools/timeline.js';

// Resource exports (for advanced usage)
export { createProjectContextResource } from './resources/project-context.js';
export { createTaskHistoryResource } from './resources/task-history.js';
