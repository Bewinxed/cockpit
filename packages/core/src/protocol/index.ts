// Message types and utilities
export {
  JSONRPC_VERSION,
  JsonRpcErrorCode,
  JSON_RPC_ERROR_CODES,
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
  type AgentStatusParams,
  type AgentPingParams,
  type FilesystemListParams,
  type FilesystemEntry,
  type SpawnInstanceResult,
  type StopInstanceResult,
  type SendMessageResult,
  type AgentStatusResult,
  type AgentPingResult,
  type FilesystemListResult,
  type CommandParamsMap,
  type CommandResultMap,
  type CommandRequest,
  type SpawnInstanceCommand,
  type StopInstanceCommand,
  type SendMessageCommand,
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
  INSTANCE_STATUS: 'instance.status',
  AGENT_STATUS: CommandMethod.AGENT_STATUS,
  AGENT_PING: CommandMethod.AGENT_PING,
  AGENT_REGISTER: 'agent.register',
  AGENT_HEARTBEAT: EventMethod.AGENT_HEARTBEAT,
  FILESYSTEM_LIST: CommandMethod.FILESYSTEM_LIST,

  // Events (Agent -> Hub)
  INSTANCE_CREATED: EventMethod.INSTANCE_CREATED,
  INSTANCE_MESSAGE: EventMethod.INSTANCE_MESSAGE,
  INSTANCE_STOPPED: EventMethod.INSTANCE_STOPPED,
  INSTANCE_STATUS_CHANGED: EventMethod.INSTANCE_STATUS_CHANGED,
  INSTANCE_STARTED: 'instance.started',
  INSTANCE_ERROR: 'instance.error',
  SDK_MESSAGE: 'sdk.message',
  TASK_UPDATED: EventMethod.TASK_UPDATED,
  AGENT_CONNECTED: EventMethod.AGENT_CONNECTED,
  AGENT_DISCONNECTED: EventMethod.AGENT_DISCONNECTED,
} as const;
