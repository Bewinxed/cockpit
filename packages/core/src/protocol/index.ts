// JSON-RPC 2.0 Protocol Types

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: JsonRpcError;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

// Standard JSON-RPC error codes
export const JSON_RPC_ERROR_CODES = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  // Custom error codes (reserved range: -32000 to -32099)
  INSTANCE_NOT_FOUND: -32001,
  INSTANCE_ALREADY_EXISTS: -32002,
  AGENT_NOT_FOUND: -32003,
  CONNECTION_ERROR: -32004,
  TIMEOUT_ERROR: -32005,
} as const;

// Helper functions
export function createRequest(id: string | number, method: string, params?: unknown): JsonRpcRequest {
  return {
    jsonrpc: '2.0',
    id,
    method,
    params,
  };
}

export function createNotification(method: string, params?: unknown): JsonRpcNotification {
  return {
    jsonrpc: '2.0',
    method,
    params,
  };
}

export function createResponse(id: string | number, result: unknown): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id,
    result,
  };
}

export function createErrorResponse(id: string | number, code: number, message: string, data?: unknown): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id,
    error: {
      code,
      message,
      data,
    },
  };
}

export function isRequest(msg: unknown): msg is JsonRpcRequest {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    'jsonrpc' in msg &&
    msg.jsonrpc === '2.0' &&
    'id' in msg &&
    'method' in msg
  );
}

export function isNotification(msg: unknown): msg is JsonRpcNotification {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    'jsonrpc' in msg &&
    msg.jsonrpc === '2.0' &&
    'method' in msg &&
    !('id' in msg)
  );
}

export function isResponse(msg: unknown): msg is JsonRpcResponse {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    'jsonrpc' in msg &&
    msg.jsonrpc === '2.0' &&
    'id' in msg &&
    !('method' in msg)
  );
}

// Protocol Methods
export const PROTOCOL_METHODS = {
  // Agent -> Hub
  AGENT_REGISTER: 'agent.register',
  AGENT_HEARTBEAT: 'agent.heartbeat',
  AGENT_STATUS: 'agent.status',

  // Hub -> Agent
  INSTANCE_SPAWN: 'instance.spawn',
  INSTANCE_SEND: 'instance.send',
  INSTANCE_STOP: 'instance.stop',
  INSTANCE_STATUS: 'instance.status',

  // Notifications (Agent -> Hub)
  INSTANCE_STARTED: 'instance.started',
  INSTANCE_MESSAGE: 'instance.message',
  INSTANCE_TOOL_USE: 'instance.toolUse',
  INSTANCE_RESULT: 'instance.result',
  INSTANCE_ERROR: 'instance.error',
  INSTANCE_STOPPED: 'instance.stopped',
  SDK_MESSAGE: 'sdk.message',
} as const;
