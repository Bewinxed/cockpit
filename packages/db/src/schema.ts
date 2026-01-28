import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core';
import type {
  SDKCompactBoundaryMessage,
  SDKHookResponseMessage,
  SDKResultMessage,
  SDKStatus,
  SDKSystemMessage,
} from '@anthropic-ai/claude-agent-sdk';

// agents - connected machines (machineId is the primary key)
// The "agent" is just the daemon running on a machine - machineId IS the identity
export const agents = sqliteTable('agents', {
  // machineId is the PRIMARY KEY - stable, hardware-derived identifier
  machineId: text('machine_id').primaryKey(),
  hostname: text('hostname').notNull(),
  tailscaleIp: text('tailscale_ip').notNull(),
  os: text('os').notNull(), // 'windows' | 'darwin' | 'linux'
  status: text('status').notNull(), // 'online' | 'offline' | 'reconnecting'
  lastSeen: integer('last_seen', { mode: 'timestamp' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  // Agent settings (persisted)
  defaultCwd: text('default_cwd'), // Default working directory for new instances
}, (table) => [
  index('agents_status_idx').on(table.status),
  index('agents_last_seen_idx').on(table.lastSeen),
]);

// projects - organize instances
export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  rootPath: text('root_path'),
  // Machine this project is associated with (optional)
  machineId: text('machine_id').references(() => agents.machineId),
  settings: text('settings', { mode: 'json' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => [
  index('projects_machine_id_idx').on(table.machineId),
  index('projects_name_idx').on(table.name),
]);

// instances - Claude Code sessions
// Instances are tied to a machine via machineId (stable, never changes)
export const instances = sqliteTable('instances', {
  id: text('id').primaryKey(),
  sessionId: text('session_id'), // Agent service's internal session ID (for tracking)
  sdkSessionId: text('sdk_session_id'), // Claude SDK's session ID (for resume)
  // Conversation graph
  conversationId: text('conversation_id'),
  activeThreadId: text('active_thread_id'),
  activeSpanId: text('active_span_id'),
  projectId: text('project_id').references(() => projects.id),
  // Machine running this instance - FK to agents.machineId, REQUIRED
  machineId: text('machine_id').references(() => agents.machineId).notNull(),
  cwd: text('cwd').notNull(),
  status: text('status').notNull(), // 'starting' | 'running' | 'stopping' | 'stopped' | 'error' | 'sleeping'
  model: text('model'),
  permissionMode: text('permission_mode'),
  lastPrompt: text('last_prompt'),
  totalCostUsd: real('total_cost_usd').default(0),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  stoppedAt: integer('stopped_at', { mode: 'timestamp' }),
  // UI preferences (persisted per instance)
  viewMode: text('view_mode').default('chat'), // 'flow' | 'chat'
}, (table) => [
  index('instances_session_id_idx').on(table.sessionId),
  index('instances_sdk_session_id_idx').on(table.sdkSessionId),
  index('instances_conversation_id_idx').on(table.conversationId),
  index('instances_active_thread_id_idx').on(table.activeThreadId),
  index('instances_active_span_id_idx').on(table.activeSpanId),
  index('instances_project_id_idx').on(table.projectId),
  index('instances_machine_id_idx').on(table.machineId),
  index('instances_status_idx').on(table.status),
  index('instances_created_at_idx').on(table.createdAt),
]);

// conversations - root container for all threads in a session
export const conversations = sqliteTable('conversations', {
  id: text('id').primaryKey(),
  instanceId: text('instance_id').references(() => instances.id).notNull(),
  metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown> | null>(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => [
  index('conversations_instance_id_idx').on(table.instanceId),
  index('conversations_created_at_idx').on(table.createdAt),
]);

// threads - branches within a conversation
export const threads = sqliteTable('threads', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').references(() => conversations.id).notNull(),
  parentThreadId: text('parent_thread_id'),
  forkedFromMessageId: text('forked_from_message_id'),
  headMessageId: text('head_message_id'),
  metadata: text('metadata', { mode: 'json' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => [
  index('threads_conversation_id_idx').on(table.conversationId),
  index('threads_parent_thread_id_idx').on(table.parentThreadId),
  index('threads_forked_from_message_id_idx').on(table.forkedFromMessageId),
  index('threads_created_at_idx').on(table.createdAt),
]);

// spans - execution contexts (main agent, subagent, subsubagent)
export const spans = sqliteTable('spans', {
  id: text('id').primaryKey(),
  threadId: text('thread_id').references(() => threads.id).notNull(),
  parentSpanId: text('parent_span_id'),
  toolCallId: text('tool_call_id'), // Task tool_use that spawned this span
  agentType: text('agent_type'),
  agentDescription: text('agent_description'),
  model: text('model'),
  status: text('status').notNull(), // 'starting' | 'running' | 'complete' | 'error'
  metadata: text('metadata', { mode: 'json' }),
  startedAt: integer('started_at', { mode: 'timestamp' }).notNull(),
  endedAt: integer('ended_at', { mode: 'timestamp' }),
}, (table) => [
  index('spans_thread_id_idx').on(table.threadId),
  index('spans_parent_span_id_idx').on(table.parentSpanId),
  index('spans_tool_call_id_idx').on(table.toolCallId),
  index('spans_started_at_idx').on(table.startedAt),
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

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface MessageMetadata {
  // Tool messages
  toolId?: string;
  toolName?: string;
  toolInput?: JsonValue;
  toolResult?: JsonValue;
  toolStatus?: 'pending' | 'success' | 'error';
  toolUseResult?: JsonValue;
  // System messages
  subtype?: string;
  command?: string;
  model?: SDKSystemMessage['model'];
  cwd?: string;
  tools?: SDKSystemMessage['tools'];
  sessionId?: string;
  status?: SDKStatus;
  // Compact boundary
  preTokens?: SDKCompactBoundaryMessage['compact_metadata']['pre_tokens'];
  trigger?: SDKCompactBoundaryMessage['compact_metadata']['trigger'];
  // Hook response
  hookName?: SDKHookResponseMessage['hook_name'];
  exitCode?: SDKHookResponseMessage['exit_code'];
  stdout?: SDKHookResponseMessage['stdout'];
  stderr?: SDKHookResponseMessage['stderr'];
  // Login prompt
  authUrl?: string;
  oauthState?: string;
  // Model picker
  loading?: boolean;
  error?: string;
  models?: Array<{ value: string; displayName: string; description: string }>;
  currentModel?: string;
  selectedModel?: string;
  // Memory picker
  memoryPhase?: 'selection' | 'editing';
  selectedMemoryType?: 'project' | 'user';
  memoryContent?: string;
  memoryPath?: string;
  // Ask question (AskUserQuestion tool)
  questionRequestId?: string;
  questions?: Array<{
    question: string;
    header: string;
    options: Array<{ label: string; description: string }>;
    multiSelect: boolean;
  }>;
  questionAnswers?: Record<string, string>;
  // Help menu
  version?: string;
  commands?: Array<{ name: string; description?: string; type: 'builtin' | 'custom' | 'skill' | 'mcp' }>;
  // Thinking blocks
  thinking?: string;
  thinkingSignature?: string;
  isRedactedThinking?: boolean;
  // Result errors
  resultSubtype?: SDKResultMessage['subtype'];
  resultErrors?: Extract<SDKResultMessage, { errors: string[] }>['errors'];
  totalCost?: SDKResultMessage['total_cost_usd'];
  numTurns?: SDKResultMessage['num_turns'];
  result?: Extract<SDKResultMessage, { subtype: 'success' }>['result'];
  // System init - MCP server status
  mcpServers?: SDKSystemMessage['mcp_servers'];
  // Subagent spawning (Task tool)
  subagentType?: string;
  subagentDescription?: string;
}

// messages - canonical UI-ready messages (semantic type only)
export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),
  threadId: text('thread_id').references(() => threads.id).notNull(),
  spanId: text('span_id').references(() => spans.id).notNull(),
  parentMessageId: text('parent_message_id'),
  parentToolUseId: text('parent_tool_use_id'),
  type: text('type').notNull(), // e.g. 'assistant', 'system.init', 'tool.use', 'ui.ask_question'
  contentText: text('content_text'),
  contentJson: text('content_json', { mode: 'json' }),
  metadata: text('metadata', { mode: 'json' }).$type<MessageMetadata | null>(),
  sdkUuid: text('sdk_uuid'),
  toolCallId: text('tool_call_id'),
  status: text('status'), // 'final' | 'streaming' | null
  seq: integer('seq').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (table) => [
  index('messages_thread_id_idx').on(table.threadId),
  index('messages_span_id_idx').on(table.spanId),
  index('messages_parent_message_id_idx').on(table.parentMessageId),
  index('messages_parent_tool_use_id_idx').on(table.parentToolUseId),
  index('messages_type_idx').on(table.type),
  index('messages_sdk_uuid_idx').on(table.sdkUuid),
  index('messages_seq_idx').on(table.seq),
  index('messages_created_at_idx').on(table.createdAt),
]);

// message_blocks - incremental streaming content (optional)
export const messageBlocks = sqliteTable('message_blocks', {
  id: text('id').primaryKey(),
  messageId: text('message_id').references(() => messages.id).notNull(),
  index: integer('index').notNull(),
  type: text('type').notNull(),
  contentText: text('content_text'),
  contentJson: text('content_json', { mode: 'json' }),
  isFinal: integer('is_final', { mode: 'boolean' }).default(false),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => [
  index('message_blocks_message_id_idx').on(table.messageId),
  index('message_blocks_type_idx').on(table.type),
  index('message_blocks_index_idx').on(table.index),
]);

// tool_invocations - canonical tool calls tied to messages/spans
export const toolInvocations = sqliteTable('tool_invocations', {
  id: text('id').primaryKey(), // SDK's tool_use_id (e.g. toolu_015D36eARg...)
  spanId: text('span_id').references(() => spans.id).notNull(),
  messageId: text('message_id').references(() => messages.id).notNull(),
  toolName: text('tool_name').notNull(),
  toolInput: text('tool_input', { mode: 'json' }),
  toolResult: text('tool_result', { mode: 'json' }),
  toolResultContent: text('tool_result_content'),
  status: text('status').notNull().default('pending'),
  isError: integer('is_error', { mode: 'boolean' }).default(false),
  durationMs: integer('duration_ms'),
  backgroundAgentId: text('background_agent_id'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
}, (table) => [
  index('tool_invocations_message_id_idx').on(table.messageId),
  index('tool_invocations_span_id_idx').on(table.spanId),
  index('tool_invocations_tool_name_idx').on(table.toolName),
  index('tool_invocations_status_idx').on(table.status),
]);

// credentials - OAuth tokens and API keys for Claude authentication
export const credentials = sqliteTable('credentials', {
  id: text('id').primaryKey(),
  type: text('type').notNull(), // 'oauth' | 'api_key'
  // OAuth fields
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  expiresAt: integer('expires_at'), // Unix timestamp in milliseconds
  // API key field
  apiKey: text('api_key'),
  // Metadata
  label: text('label'), // User-friendly name for this credential
  isDefault: integer('is_default', { mode: 'boolean' }).default(false),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => [
  index('credentials_type_idx').on(table.type),
  index('credentials_is_default_idx').on(table.isDefault),
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

export type ToolInvocation = typeof toolInvocations.$inferSelect;
export type NewToolInvocation = typeof toolInvocations.$inferInsert;

export type Credential = typeof credentials.$inferSelect;
export type NewCredential = typeof credentials.$inferInsert;

// Status type literals for type safety
export type AgentOS = 'windows' | 'darwin' | 'linux';
export type AgentStatus = 'online' | 'offline' | 'reconnecting';
export type InstanceStatus = 'starting' | 'running' | 'stopping' | 'stopped' | 'error' | 'sleeping' | 'disconnected';
export type TaskType = 'major' | 'minor';
export type TaskStatus = 'in_progress' | 'completed' | 'blocked' | 'cancelled';
export type CredentialType = 'oauth' | 'api_key';
export type SdkMessageType = 'user' | 'assistant' | 'system' | 'result';
export type ToolInvocationStatus = 'pending' | 'success' | 'error';
export type ViewMode = 'flow' | 'chat';
