/**
 * Dashboard Client Registry
 *
 * Manages connected dashboard WebSocket clients.
 * Similar to AgentRegistry but simpler - dashboards don't need request/response tracking.
 * Uses river.ts format for all messages: { type, data }
 */

import type { DashboardEventType, DashboardEventMap } from '@agentdeck/core/dashboard';
import { generateId } from '@agentdeck/core/utils';

/**
 * Dashboard client connection
 */
export interface DashboardClient {
  /** Unique client ID (matches Elysia ws.id) */
  id: string;
  /** WebSocket connection */
  ws: unknown;
  /** When client connected */
  connectedAt: Date;
  /** Last activity timestamp */
  lastActivity: Date;
}

/**
 * Registry for tracking connected dashboard WebSocket clients.
 * Provides broadcast and send-to-client functionality.
 */
export class DashboardRegistry {
  private clients: Map<string, DashboardClient> = new Map();

  /**
   * Register a new dashboard client.
   * Uses Elysia's ws.id as the client ID for reliable lookup.
   */
  register(ws: unknown): DashboardClient {
    // Get Elysia's ws.id for reliable identification
    const wsId = (ws as { id?: string }).id ?? generateId();
    const now = new Date();
    const client: DashboardClient = {
      id: wsId,
      ws,
      connectedAt: now,
      lastActivity: now,
    };

    this.clients.set(client.id, client);
    return client;
  }

  /**
   * Get client by Elysia ws.id
   */
  getByWsId(wsId: string): DashboardClient | undefined {
    return this.clients.get(wsId);
  }

  /**
   * Unregister a dashboard client
   */
  unregister(clientId: string): boolean {
    return this.clients.delete(clientId);
  }

  /**
   * Unregister by WebSocket reference (for close handlers)
   */
  unregisterByWs(ws: unknown): DashboardClient | null {
    for (const [id, client] of this.clients) {
      if (client.ws === ws) {
        this.clients.delete(id);
        return client;
      }
    }
    return null;
  }

  /**
   * Get a client by ID
   */
  get(clientId: string): DashboardClient | undefined {
    return this.clients.get(clientId);
  }

  /**
   * Get all connected clients
   */
  getAll(): DashboardClient[] {
    return Array.from(this.clients.values());
  }

  /**
   * Get count of connected clients
   */
  get size(): number {
    return this.clients.size;
  }

  /**
   * Check if any clients are connected
   */
  get hasClients(): boolean {
    return this.clients.size > 0;
  }

  /**
   * Broadcast an event to all connected dashboard clients.
   * Uses river.ts format: { type, data }
   */
  broadcast<K extends DashboardEventType>(
    type: K,
    data: DashboardEventMap[K]
  ): number {
    const message = JSON.stringify({ type, data });
    let sent = 0;

    for (const client of this.clients.values()) {
      try {
        (client.ws as { send: (msg: string) => void }).send(message);
        client.lastActivity = new Date();
        sent++;
      } catch {
        // Client disconnected, will be cleaned up on close event
      }
    }

    return sent;
  }

  /**
   * Send an event to a specific client
   */
  sendToClient<K extends DashboardEventType>(
    clientId: string,
    type: K,
    data: DashboardEventMap[K]
  ): boolean {
    const client = this.clients.get(clientId);
    if (!client) return false;

    try {
      const message = JSON.stringify({ type, data });
      (client.ws as { send: (msg: string) => void }).send(message);
      client.lastActivity = new Date();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Send a raw message to a client (for responses with id)
   */
  sendRaw(clientId: string, message: string): boolean {
    const client = this.clients.get(clientId);
    if (!client) return false;

    try {
      (client.ws as { send: (msg: string) => void }).send(message);
      client.lastActivity = new Date();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Send a raw message to a WebSocket directly
   */
  sendRawToWs(ws: unknown, message: string): boolean {
    try {
      (ws as { send: (msg: string) => void }).send(message);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Clear all clients (for shutdown)
   */
  clear(): void {
    this.clients.clear();
  }
}

// HMR-persistent singleton
declare global {
  var __agentdeckDashboardRegistry: DashboardRegistry | undefined;
}

export function getDashboardRegistry(): DashboardRegistry {
  if (!globalThis.__agentdeckDashboardRegistry) {
    globalThis.__agentdeckDashboardRegistry = new DashboardRegistry();
  }
  return globalThis.__agentdeckDashboardRegistry;
}

export function resetDashboardRegistry(): void {
  globalThis.__agentdeckDashboardRegistry = undefined;
}
