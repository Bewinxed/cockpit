// Message types and utilities
export {
  JSONRPC_VERSION,
  JsonRpcErrorCode,
  type JsonRpcErrorCodeValue,
  type JsonRpcError,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type JsonRpcNotification,
  type JsonRpcMessage,
  isJsonRpcRequest,
  isJsonRpcResponse,
  isJsonRpcNotification,
  // Backward compatibility aliases
  isRequest,
  isResponse,
  isNotification,
  createRequest,
  createResponse,
  createErrorResponse,
  createNotification,
} from './messages.js';

// Command types (Hub -> Agent)
export {
  CommandMethod,
  type CommandMethodValue,
  type SpawnInstanceParams,
  type StopInstanceParams,
  type SendMessageParams,
  type InterruptInstanceParams,
  type InstanceStatusParams,
  type RewindFilesParams,
  type RewindFilesResult,
  type AgentStatusParams,
  type AgentPingParams,
  type FilesystemListParams,
  type FilesystemEntry,
  type CommandsListParams,
  type CommandsListResult,
  type AvailableCommand,
  type ModelsListParams,
  type ModelsListResult,
  type ModelsSetParams,
  type ModelsSetResult,
  type ModelInfo,
  type ClaudeVersionParams,
  type ClaudeVersionResult,
  type MemoryReadParams,
  type MemoryReadResult,
  type MemoryWriteParams,
  type MemoryWriteResult,
  type SpawnInstanceResult,
  type StopInstanceResult,
  type SendMessageResult,
  type InterruptInstanceResult,
  type AgentStatusResult,
  type AgentPingResult,
  type FilesystemListResult,
  type CommandParamsMap,
  type CommandResultMap,
  type CommandRequest,
  type SpawnInstanceCommand,
  type StopInstanceCommand,
  type SendMessageCommand,
  type InterruptInstanceCommand,
  type AgentStatusCommand,
  type AgentPingCommand,
} from './commands.js';

// Event types (Agent -> Hub)
export {
  EventMethod,
  type EventMethodValue,
  type InstanceMessageType,
  type InstanceCreatedEvent,
  type InstanceMessageEvent,
  type InstanceStoppedEvent,
  type InstanceSleepingEvent,
  type InstanceStatusChangedEvent,
  type TaskUpdatedEvent,
  type AgentConnectedEvent,
  type AgentDisconnectedEvent,
  type AgentHeartbeatEvent,
  type EventParamsMap,
  type EventNotification,
  type InstanceCreatedNotification,
  type InstanceMessageNotification,
  type InstanceStoppedNotification,
  type InstanceSleepingNotification,
  type InstanceStatusChangedNotification,
  type TaskUpdatedNotification,
  type AgentConnectedNotification,
  type AgentDisconnectedNotification,
  type AgentHeartbeatNotification,
} from './events.js';

import { CommandMethod } from './commands.js';
import { EventMethod } from './events.js';

/**
 * All protocol methods (both commands and events)
 */
export const PROTOCOL_METHODS = {
  // Commands (Hub -> Agent)
  INSTANCE_SPAWN: CommandMethod.INSTANCE_SPAWN,
  INSTANCE_STOP: CommandMethod.INSTANCE_STOP,
  INSTANCE_SEND: CommandMethod.INSTANCE_SEND,
  INSTANCE_INTERRUPT: CommandMethod.INSTANCE_INTERRUPT,
  INSTANCE_STATUS: CommandMethod.INSTANCE_STATUS,
  AGENT_STATUS: CommandMethod.AGENT_STATUS,
  AGENT_PING: CommandMethod.AGENT_PING,
  AGENT_REGISTER: 'agent.register',
  AGENT_HEARTBEAT: EventMethod.AGENT_HEARTBEAT,
  FILESYSTEM_LIST: CommandMethod.FILESYSTEM_LIST,
  COMMANDS_LIST: CommandMethod.COMMANDS_LIST,
  MODELS_LIST: CommandMethod.MODELS_LIST,
  MODELS_SET: CommandMethod.MODELS_SET,
  CLAUDE_VERSION: CommandMethod.CLAUDE_VERSION,
  MEMORY_READ: CommandMethod.MEMORY_READ,
  MEMORY_WRITE: CommandMethod.MEMORY_WRITE,
  INSTANCE_REWIND: CommandMethod.INSTANCE_REWIND,

  // Events (Agent -> Hub)
  INSTANCE_CREATED: EventMethod.INSTANCE_CREATED,
  INSTANCE_MESSAGE: EventMethod.INSTANCE_MESSAGE,
  INSTANCE_STOPPED: EventMethod.INSTANCE_STOPPED,
  INSTANCE_SLEEPING: EventMethod.INSTANCE_SLEEPING,
  INSTANCE_STATUS_CHANGED: EventMethod.INSTANCE_STATUS_CHANGED,
  INSTANCE_STARTED: 'instance.started',
  INSTANCE_ERROR: 'instance.error',
  SDK_MESSAGE: 'sdk.message',
  TASK_UPDATED: EventMethod.TASK_UPDATED,
  AGENT_CONNECTED: EventMethod.AGENT_CONNECTED,
  AGENT_DISCONNECTED: EventMethod.AGENT_DISCONNECTED,

  // Permission handling
  PERMISSION_REQUEST: 'permission.request',
  PERMISSION_RESPONSE: 'permission.response',

  // Question handling (AskUserQuestion UI bridge)
  QUESTION_REQUEST: 'question.request',
  QUESTION_RESPONSE: 'question.response',
} as const;
