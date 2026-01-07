import { generateId } from '@cockpit/core/utils';

/**
 * SSE client connection
 */
export interface SSEClient {
  id: string;
  controller: ReadableStreamDefaultController<string | Uint8Array>;
  connectedAt: Date;
  subscriptions: Set<string>; // Event types to subscribe to
  closed: boolean; // Track if connection is closed
}

/**
 * Broadcast event types
 */
export type BroadcastEventType =
  | 'agent:connected'
  | 'agent:disconnected'
  | 'agent:updated'
  | 'instance:created'
  | 'instance:updated'
  | 'instance:started'
  | 'instance:message'
  | 'instance:stopped'
  | 'instance:sleeping'
  | 'instance:resumed'
  | 'instance:error'
  | 'instance:token_usage'
  | 'instance:model-changed'
  | 'sdk:message'
  | 'task:created'
  | 'task:updated'
  | 'task:completed'
  | 'project:created'
  | 'project:updated'
  | 'project:deleted';

/**
 * Service for broadcasting events to dashboard clients via SSE
 */
export class BroadcastService {
  private clients: Map<string, SSEClient> = new Map();

  /**
   * Add a new SSE client
   */
  addClient(controller: ReadableStreamDefaultController<string | Uint8Array>, subscriptions?: string[]): SSEClient {
    const client: SSEClient = {
      id: generateId(),
      controller,
      connectedAt: new Date(),
      subscriptions: new Set(subscriptions ?? ['*']),
      closed: false,
    };

    this.clients.set(client.id, client);

    // Send initial connection message (deferred to avoid race condition)
    queueMicrotask(() => {
      if (!client.closed) {
        this.sendToClient(client, 'connected', { clientId: client.id });
      }
    });

    return client;
  }

  /**
   * Mark a client as closed (call when connection ends)
   */
  markClosed(clientId: string): void {
    const client = this.clients.get(clientId);
    if (client) {
      client.closed = true;
      this.clients.delete(clientId);
    }
  }

  /**
   * Remove a client
   */
  removeClient(clientId: string): boolean {
    return this.clients.delete(clientId);
  }

  /**
   * Get a client by ID
   */
  getClient(clientId: string): SSEClient | undefined {
    return this.clients.get(clientId);
  }

  /**
   * Get all connected clients
   */
  getAllClients(): SSEClient[] {
    return Array.from(this.clients.values());
  }

  /**
   * Update client subscriptions
   */
  updateSubscriptions(clientId: string, subscriptions: string[]): boolean {
    const client = this.clients.get(clientId);
    if (!client) return false;

    client.subscriptions = new Set(subscriptions);
    return true;
  }

  /**
   * Send an event to a specific client
   */
  private sendToClient(client: SSEClient, event: string, data: unknown): boolean {
    // Skip if client is already marked as closed
    if (client.closed) {
      return false;
    }

    try {
      const message = this.formatSSEMessage(event, data);
      // Enqueue as raw string - will be encoded by the Response stream
      client.controller.enqueue(message);
      return true;
    } catch (err) {
      // Client might be disconnected, mark as closed
      client.closed = true;
      this.clients.delete(client.id);
      // Silently ignore "Controller is already closed" errors - they're expected when clients disconnect
      return false;
    }
  }

  /**
   * Format data as SSE message
   */
  private formatSSEMessage(event: string, data: unknown): string {
    const lines: string[] = [];
    lines.push(`event: ${event}`);
    lines.push(`data: ${JSON.stringify(data)}`);
    lines.push(`id: ${generateId()}`);
    lines.push(''); // Empty line terminates the message
    lines.push(''); // Extra newline for SSE format
    return lines.join('\n');
  }

  /**
   * Broadcast an event to all subscribed clients
   */
  broadcast(event: BroadcastEventType, data: unknown): void {
    const eventCategory = event.split(':')[0];

    for (const client of this.clients.values()) {
      // Check if client is subscribed to this event
      if (
        client.subscriptions.has('*') ||
        client.subscriptions.has(event) ||
        client.subscriptions.has(`${eventCategory}:*`)
      ) {
        this.sendToClient(client, event, data);
      }
    }
  }

  /**
   * Send a heartbeat to all clients (keep connection alive)
   */
  sendHeartbeat(): void {
    const heartbeat = `: heartbeat ${Date.now()}\n\n`;

    for (const [clientId, client] of this.clients) {
      if (client.closed) {
        this.clients.delete(clientId);
        continue;
      }

      try {
        // Enqueue as raw string
        client.controller.enqueue(heartbeat);
      } catch {
        client.closed = true;
        this.clients.delete(clientId);
      }
    }
  }

  /**
   * Start automatic heartbeat interval
   */
  startHeartbeat(intervalMs: number = 30000): ReturnType<typeof setInterval> {
    return setInterval(() => this.sendHeartbeat(), intervalMs);
  }

  /**
   * Get connected client count
   */
  get clientCount(): number {
    return this.clients.size;
  }

  /**
   * Close all client connections
   */
  closeAll(): void {
    for (const client of this.clients.values()) {
      try {
        client.controller.close();
      } catch {
        // Ignore errors during cleanup
      }
    }
    this.clients.clear();
  }
}

// Singleton instance
let broadcastInstance: BroadcastService | null = null;
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

export function getBroadcastService(): BroadcastService {
  if (!broadcastInstance) {
    broadcastInstance = new BroadcastService();
    // Start heartbeat
    heartbeatInterval = broadcastInstance.startHeartbeat();
  }
  return broadcastInstance;
}

export function resetBroadcastService(): void {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
  if (broadcastInstance) {
    broadcastInstance.closeAll();
    broadcastInstance = null;
  }
}
