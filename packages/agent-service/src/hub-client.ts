import { EventEmitter } from 'events';
import WebSocket from 'ws';
import {
  type JsonRpcRequest,
  type JsonRpcResponse,
  type JsonRpcNotification,
  createRequest,
  createNotification,
  isRequest,
  isResponse,
  isNotification,
  safeJsonParse,
  exponentialBackoff,
  sleep,
  generateId,
} from '@cockpit/core';

export interface HubClientOptions {
  /** Maximum reconnection attempts (0 = infinite) */
  maxReconnectAttempts?: number;
  /** Base delay for reconnection backoff (ms) */
  reconnectBaseDelay?: number;
  /** Maximum delay for reconnection backoff (ms) */
  reconnectMaxDelay?: number;
  /** Heartbeat interval (ms) */
  heartbeatInterval?: number;
  /** Connection timeout (ms) */
  connectionTimeout?: number;
}

export interface HubClientEvents {
  connected: () => void;
  disconnected: (code: number, reason: string) => void;
  reconnecting: (attempt: number) => void;
  error: (error: Error) => void;
  request: (request: JsonRpcRequest) => void;
  notification: (notification: JsonRpcNotification) => void;
}

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

/**
 * WebSocket client to connect to the Cockpit hub
 */
export class HubClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private hubUrl: string = '';
  private reconnectAttempts: number = 0;
  private isConnecting: boolean = false;
  private shouldReconnect: boolean = true;
  private messageQueue: (JsonRpcRequest | JsonRpcNotification)[] = [];
  private pendingRequests: Map<string | number, PendingRequest> = new Map();
  private heartbeatTimer: NodeJS.Timeout | null = null;

  private readonly options: Required<HubClientOptions>;

  constructor(options: HubClientOptions = {}) {
    super();
    this.options = {
      maxReconnectAttempts: options.maxReconnectAttempts ?? 0,
      reconnectBaseDelay: options.reconnectBaseDelay ?? 1000,
      reconnectMaxDelay: options.reconnectMaxDelay ?? 30000,
      heartbeatInterval: options.heartbeatInterval ?? 30000,
      connectionTimeout: options.connectionTimeout ?? 10000,
    };
  }

  /**
   * Check if connected to the hub
   */
  get isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Connect to the hub
   */
  async connect(hubUrl: string): Promise<void> {
    if (this.isConnecting) {
      throw new Error('Connection already in progress');
    }

    if (this.isConnected) {
      throw new Error('Already connected');
    }

    this.hubUrl = hubUrl;
    this.shouldReconnect = true;
    this.isConnecting = true;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.isConnecting = false;
        reject(new Error('Connection timeout'));
      }, this.options.connectionTimeout);

      try {
        this.ws = new WebSocket(hubUrl);

        this.ws.on('open', () => {
          clearTimeout(timeout);
          this.isConnecting = false;
          this.reconnectAttempts = 0;
          this.emit('connected');
          this.startHeartbeat();
          this.flushMessageQueue();
          resolve();
        });

        this.ws.on('message', (data: WebSocket.Data) => {
          this.handleMessage(data);
        });

        this.ws.on('close', (code: number, reason: Buffer) => {
          clearTimeout(timeout);
          this.isConnecting = false;
          this.stopHeartbeat();
          this.emit('disconnected', code, reason.toString());
          this.handleDisconnect();
        });

        this.ws.on('error', (error: Error) => {
          clearTimeout(timeout);
          this.isConnecting = false;
          this.emit('error', error);
          if (!this.isConnected) {
            reject(error);
          }
        });
      } catch (error) {
        clearTimeout(timeout);
        this.isConnecting = false;
        reject(error);
      }
    });
  }

  /**
   * Disconnect from the hub
   */
  disconnect(): void {
    this.shouldReconnect = false;
    this.stopHeartbeat();

    // Reject all pending requests
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Connection closed'));
      this.pendingRequests.delete(id);
    }

    if (this.ws) {
      this.ws.close(1000, 'Client disconnecting');
      this.ws = null;
    }
  }

  /**
   * Send a JSON-RPC request and wait for response
   */
  async request<T = unknown>(method: string, params?: unknown, timeout = 30000): Promise<T> {
    const id = generateId();
    const request = createRequest(id, method, params);

    return new Promise((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request ${method} timed out`));
      }, timeout);

      this.pendingRequests.set(id, {
        resolve: resolve as (result: unknown) => void,
        reject,
        timeout: timeoutHandle,
      });

      this.send(request);
    });
  }

  /**
   * Send a JSON-RPC notification (no response expected)
   */
  notify(method: string, params?: unknown): void {
    const notification = createNotification(method, params);
    this.send(notification);
  }

  /**
   * Send a message to the hub
   */
  send(message: JsonRpcRequest | JsonRpcNotification): void {
    if (!this.isConnected) {
      // Queue message for later
      this.messageQueue.push(message);
      return;
    }

    try {
      this.ws!.send(JSON.stringify(message));
    } catch (error) {
      // Queue message for retry
      this.messageQueue.push(message);
      this.emit('error', error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Send a JSON-RPC response
   */
  sendResponse(response: JsonRpcResponse): void {
    if (!this.isConnected) {
      return;
    }

    try {
      this.ws!.send(JSON.stringify(response));
    } catch (error) {
      this.emit('error', error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Handle incoming WebSocket message
   */
  private handleMessage(data: WebSocket.Data): void {
    const str = data.toString();
    const message = safeJsonParse<unknown>(str);

    if (!message) {
      console.warn('Invalid JSON received:', str);
      return;
    }

    if (isResponse(message)) {
      this.handleResponse(message);
    } else if (isRequest(message)) {
      this.emit('request', message);
    } else if (isNotification(message)) {
      this.emit('notification', message);
    } else {
      console.warn('Unknown message type:', message);
    }
  }

  /**
   * Handle JSON-RPC response
   */
  private handleResponse(response: JsonRpcResponse): void {
    const pending = this.pendingRequests.get(response.id);
    if (!pending) {
      console.warn('Received response for unknown request:', response.id);
      return;
    }

    clearTimeout(pending.timeout);
    this.pendingRequests.delete(response.id);

    if (response.error) {
      pending.reject(new Error(`${response.error.message} (code: ${response.error.code})`));
    } else {
      pending.resolve(response.result);
    }
  }

  /**
   * Handle disconnect and potentially reconnect
   */
  private async handleDisconnect(): Promise<void> {
    if (!this.shouldReconnect) {
      return;
    }

    const maxAttempts = this.options.maxReconnectAttempts;
    if (maxAttempts > 0 && this.reconnectAttempts >= maxAttempts) {
      this.emit('error', new Error('Max reconnection attempts reached'));
      return;
    }

    this.reconnectAttempts++;
    this.emit('reconnecting', this.reconnectAttempts);

    const delay = exponentialBackoff(
      this.reconnectAttempts - 1,
      this.options.reconnectBaseDelay,
      this.options.reconnectMaxDelay
    );

    await sleep(delay);

    if (this.shouldReconnect) {
      try {
        await this.connect(this.hubUrl);
      } catch (error) {
        // Will trigger another reconnect via the close handler
      }
    }
  }

  /**
   * Flush queued messages after reconnect
   */
  private flushMessageQueue(): void {
    const queue = [...this.messageQueue];
    this.messageQueue = [];

    for (const message of queue) {
      this.send(message);
    }
  }

  /**
   * Start heartbeat timer
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.isConnected) {
        this.ws!.ping();
      }
    }, this.options.heartbeatInterval);
  }

  /**
   * Stop heartbeat timer
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}

export default HubClient;
