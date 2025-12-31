/**
 * JSON-RPC 2.0 protocol version
 */
export const JSONRPC_VERSION = '2.0' as const;

/**
 * JSON-RPC 2.0 error codes
 */
export const JsonRpcErrorCode = {
  /** Invalid JSON was received */
  PARSE_ERROR: -32700,
  /** The JSON sent is not a valid Request object */
  INVALID_REQUEST: -32600,
  /** The method does not exist / is not available */
  METHOD_NOT_FOUND: -32601,
  /** Invalid method parameter(s) */
  INVALID_PARAMS: -32602,
  /** Internal JSON-RPC error */
  INTERNAL_ERROR: -32603,
  /** Server-defined errors start here */
  SERVER_ERROR_START: -32099,
  /** Server-defined errors end here */
  SERVER_ERROR_END: -32000,
  /** Instance not found */
  INSTANCE_NOT_FOUND: -32001,
  /** Agent not found */
  AGENT_NOT_FOUND: -32002,
  /** Project not found */
  PROJECT_NOT_FOUND: -32003,
} as const;

export type JsonRpcErrorCodeValue = (typeof JsonRpcErrorCode)[keyof typeof JsonRpcErrorCode];

/**
 * JSON-RPC 2.0 error object
 */
export interface JsonRpcError {
  /** Error code */
  code: number;
  /** Short description of the error */
  message: string;
  /** Additional error data */
  data?: unknown;
}

/**
 * JSON-RPC 2.0 request message.
 * Sent from Hub to Agent (commands) or Agent to Hub (queries).
 */
export interface JsonRpcRequest<T = unknown> {
  /** JSON-RPC version, always "2.0" */
  jsonrpc: '2.0';
  /** Unique request identifier */
  id: string;
  /** Method name to invoke */
  method: string;
  /** Method parameters */
  params: T;
}

/**
 * JSON-RPC 2.0 response message.
 * Sent in response to a request.
 */
export interface JsonRpcResponse<T = unknown> {
  /** JSON-RPC version, always "2.0" */
  jsonrpc: '2.0';
  /** Request identifier being responded to */
  id: string;
  /** Result on success */
  result?: T;
  /** Error on failure */
  error?: JsonRpcError;
}

/**
 * JSON-RPC 2.0 notification message.
 * One-way message that doesn't expect a response.
 */
export interface JsonRpcNotification<T = unknown> {
  /** JSON-RPC version, always "2.0" */
  jsonrpc: '2.0';
  /** Method/event name */
  method: string;
  /** Event parameters */
  params: T;
}

/**
 * Union type for any JSON-RPC message
 */
export type JsonRpcMessage<T = unknown> =
  | JsonRpcRequest<T>
  | JsonRpcResponse<T>
  | JsonRpcNotification<T>;

/**
 * Type guard to check if a message is a request
 */
export function isJsonRpcRequest<T = unknown>(msg: unknown): msg is JsonRpcRequest<T> {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    'jsonrpc' in msg &&
    msg.jsonrpc === '2.0' &&
    'id' in msg &&
    'method' in msg
  );
}

/**
 * Type guard to check if a message is a response
 */
export function isJsonRpcResponse<T = unknown>(msg: unknown): msg is JsonRpcResponse<T> {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    'jsonrpc' in msg &&
    msg.jsonrpc === '2.0' &&
    'id' in msg &&
    !('method' in msg)
  );
}

/**
 * Type guard to check if a message is a notification
 */
export function isJsonRpcNotification<T = unknown>(msg: unknown): msg is JsonRpcNotification<T> {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    'jsonrpc' in msg &&
    msg.jsonrpc === '2.0' &&
    'method' in msg &&
    !('id' in msg)
  );
}

/**
 * Create a JSON-RPC request
 */
export function createRequest<T>(id: string, method: string, params: T): JsonRpcRequest<T> {
  return {
    jsonrpc: '2.0',
    id,
    method,
    params,
  };
}

/**
 * Create a JSON-RPC success response
 */
export function createResponse<T>(id: string, result: T): JsonRpcResponse<T> {
  return {
    jsonrpc: '2.0',
    id,
    result,
  };
}

/**
 * Create a JSON-RPC error response
 */
export function createErrorResponse(
  id: string,
  code: number,
  message: string,
  data?: unknown
): JsonRpcResponse<never> {
  return {
    jsonrpc: '2.0',
    id,
    error: { code, message, data },
  };
}

/**
 * Create a JSON-RPC notification
 */
export function createNotification<T>(method: string, params: T): JsonRpcNotification<T> {
  return {
    jsonrpc: '2.0',
    method,
    params,
  };
}

// Aliases for backward compatibility
export const isRequest = isJsonRpcRequest;
export const isResponse = isJsonRpcResponse;
export const isNotification = isJsonRpcNotification;

/** @deprecated Use JsonRpcErrorCode instead */
export const JSON_RPC_ERROR_CODES = JsonRpcErrorCode;
