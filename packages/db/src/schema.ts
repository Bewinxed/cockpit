import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core';

// agents - connected devices
export const agents = sqliteTable('agents', {
  id: text('id').primaryKey(),
  machineId: text('machine_id').notNull().unique(),
  hostname: text('hostname').notNull(),
  tailscaleIp: text('tailscale_ip').notNull(),
  os: text('os').notNull(), // 'windows' | 'darwin' | 'linux'
  status: text('status').notNull(), // 'online' | 'offline'
  lastSeen: integer('last_seen', { mode: 'timestamp' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (table) => [
  index('agents_machine_id_idx').on(table.machineId),
  index('agents_status_idx').on(table.status),
  index('agents_last_seen_idx').on(table.lastSeen),
]);

// projects - organize instances
export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  rootPath: text('root_path'),
  agentId: text('agent_id').references(() => agents.id),
  settings: text('settings', { mode: 'json' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => [
  index('projects_agent_id_idx').on(table.agentId),
  index('projects_name_idx').on(table.name),
]);

// instances - Claude Code sessions
export const instances = sqliteTable('instances', {
  id: text('id').primaryKey(),
  sessionId: text('session_id'),
  projectId: text('project_id').references(() => projects.id),
  agentId: text('agent_id').references(() => agents.id).notNull(),
  cwd: text('cwd').notNull(),
  status: text('status').notNull(), // 'starting' | 'running' | 'stopping' | 'stopped' | 'error'
  model: text('model'),
  permissionMode: text('permission_mode'),
  lastPrompt: text('last_prompt'),
  totalCostUsd: real('total_cost_usd').default(0),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  stoppedAt: integer('stopped_at', { mode: 'timestamp' }),
}, (table) => [
  index('instances_session_id_idx').on(table.sessionId),
  index('instances_project_id_idx').on(table.projectId),
  index('instances_agent_id_idx').on(table.agentId),
  index('instances_status_idx').on(table.status),
  index('instances_created_at_idx').on(table.createdAt),
]);

// tasks - from MCP task tracker
export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  instanceId: text('instance_id').references(() => instances.id).notNull(),
  projectId: text('project_id').references(() => projects.id),
  parentTaskId: text('parent_task_id'),
  title: text('title').notNull(),
  description: text('description').notNull(),
  type: text('type').notNull(), // 'major' | 'minor'
  status: text('status').notNull(), // 'in_progress' | 'completed' | 'blocked' | 'cancelled'
  progress: integer('progress').default(0),
  notes: text('notes'),
  metadata: text('metadata', { mode: 'json' }),
  startedAt: integer('started_at', { mode: 'timestamp' }).notNull(),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => [
  index('tasks_instance_id_idx').on(table.instanceId),
  index('tasks_project_id_idx').on(table.projectId),
  index('tasks_parent_task_id_idx').on(table.parentTaskId),
  index('tasks_status_idx').on(table.status),
  index('tasks_type_idx').on(table.type),
]);

// messages - conversation history (optional, for replay)
export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),
  instanceId: text('instance_id').references(() => instances.id).notNull(),
  messageType: text('message_type').notNull(),
  content: text('content', { mode: 'json' }).notNull(),
  timestamp: integer('timestamp', { mode: 'timestamp' }).notNull(),
}, (table) => [
  index('messages_instance_id_idx').on(table.instanceId),
  index('messages_timestamp_idx').on(table.timestamp),
  index('messages_message_type_idx').on(table.messageType),
]);

// Inferred types for select and insert operations
export type Agent = typeof agents.$inferSelect;
export type NewAgent = typeof agents.$inferInsert;

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;

export type Instance = typeof instances.$inferSelect;
export type NewInstance = typeof instances.$inferInsert;

export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;

export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;

// Status type literals for type safety
export type AgentOS = 'windows' | 'darwin' | 'linux';
export type AgentStatus = 'online' | 'offline';
export type InstanceStatus = 'starting' | 'running' | 'stopping' | 'stopped' | 'error';
export type TaskType = 'major' | 'minor';
export type TaskStatus = 'in_progress' | 'completed' | 'blocked' | 'cancelled';
