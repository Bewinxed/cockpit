import type { Agent, CreateAgentData } from '@agentdeck/core';
import type { JsonRpcResponse } from '@agentdeck/core/protocol';
import {
  createRequest,
  createErrorResponse,
  JsonRpcErrorCode,
} from '@agentdeck/core/protocol';
import { generateId, deferred } from '@agentdeck/core/utils';

/**
 * Represents a machine currently connected via WebSocket.
 * The machineId is the primary key - stable and hardware-derived.
 */
export interface ConnectedAgent extends Agent {
  ws: unknown; // Elysia WebSocket instance
  connectedAt: Date;
  lastPing: Date;
  pendingRequests: Map<string | number, {
    resolve: (response: JsonRpcResponse) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }>;
}

/**
 * Registry for tracking connected machines.
 *
 * Uses machineId as the primary key - no ephemeral agentId needed.
 * The machineId is stable and hardware-derived, so it never changes.
 */
export class AgentRegistry {
  // Key is machineId (stable, hardware-derived)
  private agents: Map<string, ConnectedAgent> = new Map();
  private requestTimeout: number;

  constructor(options: { requestTimeout?: number } = {}) {
    this.requestTimeout = options.requestTimeout ?? 30000;
  }

  /**
   * Register a machine connection.
   * Uses machineId as the identifier - if already registered, updates the connection.
   */
  register(ws: unknown, info: CreateAgentData): ConnectedAgent {
    const existingAgent = this.agents.get(info.machineId);

    if (existingAgent) {
      // Update existing agent with new connection
      existingAgent.ws = ws;
      existingAgent.connectedAt = new Date();
      existingAgent.lastPing = new Date();
      existingAgent.status = 'online';
      existingAgent.hostname = info.hostname;
      existingAgent.tailscaleIp = info.tailscaleIp;
      return existingAgent;
    }

    // Create new agent entry keyed by machineId
    const now = new Date();

    const agent: ConnectedAgent = {
      machineId: info.machineId,
      hostname: info.hostname,
      tailscaleIp: info.tailscaleIp,
      os: info.os,
      status: 'online',
      lastSeen: now,
      createdAt: now,
      ws,
      connectedAt: now,
      lastPing: now,
      pendingRequests: new Map(),
    };

    this.agents.set(info.machineId, agent);

    return agent;
  }

  /**
   * Unregister a machine (disconnect).
   * @param machineId - The machine ID to unregister
   * @param ws - Optional: only unregister if this is the current WebSocket (prevents race conditions)
   * @returns object with status info, or null if skipped (ws mismatch or not found)
   */
  unregister(machineId: string, ws?: unknown): { machineId: string; newStatus: 'reconnecting' } | null {
    const agent = this.agents.get(machineId);
    if (!agent) return null;

    // If ws is provided, only unregister if it matches the current connection
    // This prevents race conditions where old WebSocket close events fire after reconnection
    if (ws !== undefined && agent.ws !== ws) {
      console.log(`[AgentRegistry] Skipping unregister for ${machineId} - WebSocket mismatch (stale close event)`);
      return null;
    }

    // Reject all pending requests
    for (const [, pending] of agent.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Agent disconnected'));
    }
    agent.pendingRequests.clear();

    // Mark as reconnecting - hub broadcasts this, UI shows "reconnecting" state
    // When agent reconnects, hub broadcasts 'agent:connected' and UI updates
    agent.status = 'reconnecting';
    agent.lastSeen = new Date();
    agent.ws = null;

    return { machineId, newStatus: 'reconnecting' };
  }

  /**
   * Remove a machine completely from registry
   */
  remove(machineId: string): boolean {
    return this.agents.delete(machineId);
  }

  /**
   * Get a machine by machineId
   */
  get(machineId: string): ConnectedAgent | undefined {
    return this.agents.get(machineId);
  }

  /**
   * Get all registered machines
   */
  getAll(): ConnectedAgent[] {
    return Array.from(this.agents.values());
  }

  /**
   * Get all online machines
   */
  getOnline(): ConnectedAgent[] {
    return Array.from(this.agents.values()).filter(
      (agent) => agent.status === 'online' && agent.ws !== null
    );
  }

  /**
   * Update machine's last ping time
   */
  updatePing(machineId: string): void {
    const agent = this.agents.get(machineId);
    if (agent) {
      agent.lastPing = new Date();
      agent.lastSeen = new Date();
    }
  }

  /**
   * Send a JSON-RPC request to a machine and wait for response.
   * Uses machineId as the identifier.
   */
  async sendToMachine(machineId: string, method: string, params?: unknown): Promise<JsonRpcResponse> {
    const agent = this.agents.get(machineId);

    if (!agent) {
      return createErrorResponse(
        '0',
        JsonRpcErrorCode.INTERNAL_ERROR,
        `Machine ${machineId} not found`
      );
    }

    if (agent.status === 'reconnecting') {
      return createErrorResponse(
        '0',
        JsonRpcErrorCode.INTERNAL_ERROR,
        `Machine ${machineId} is reconnecting`,
        { code: 'AGENT_RECONNECTING', machineId }
      );
    }

    if (agent.status !== 'online' || !agent.ws) {
      return createErrorResponse(
        '0',
        JsonRpcErrorCode.INTERNAL_ERROR,
        `Machine ${machineId} is not connected`,
        { code: 'AGENT_OFFLINE', machineId }
      );
    }

    const request = createRequest(generateId(), method, params);
    const { promise, resolve, reject } = deferred<JsonRpcResponse>();

    // Set up timeout
    const timeout = setTimeout(() => {
      agent.pendingRequests.delete(request.id);
      reject(new Error(`Request to machine ${machineId} timed out`));
    }, this.requestTimeout);

    // Store pending request
    agent.pendingRequests.set(request.id, { resolve, reject, timeout });

    try {
      // Send the request via WebSocket
      const serialized = JSON.stringify(request);
      console.log(`[AgentRegistry] Sending to machine ${machineId}:`, serialized.slice(0, 300));
      // @ts-expect-error - ws type varies by runtime
      agent.ws.send(serialized);

      return await promise;
    } catch (error) {
      agent.pendingRequests.delete(request.id);
      clearTimeout(timeout);

      return createErrorResponse(
        request.id,
        JsonRpcErrorCode.INTERNAL_ERROR,
        error instanceof Error ? error.message : 'Failed to send request'
      );
    }
  }

  /**
   * Handle a response from a machine
   */
  handleResponse(machineId: string, response: JsonRpcResponse): boolean {
    const agent = this.agents.get(machineId);
    if (!agent) return false;

    const pending = agent.pendingRequests.get(response.id);
    if (!pending) return false;

    clearTimeout(pending.timeout);
    agent.pendingRequests.delete(response.id);
    pending.resolve(response);

    return true;
  }

  /**
   * Handle a response by request ID (searches all machines for the pending request)
   * This is used when we can't determine the machine from the WebSocket
   */
  handleResponseByRequestId(response: JsonRpcResponse): boolean {
    for (const agent of this.agents.values()) {
      const pending = agent.pendingRequests.get(response.id);
      if (pending) {
        clearTimeout(pending.timeout);
        agent.pendingRequests.delete(response.id);
        pending.resolve(response);
        return true;
      }
    }
    return false;
  }

  /**
   * Broadcast a notification to all online machines
   */
  broadcast(method: string, params?: unknown): void {
    const notification = {
      jsonrpc: '2.0' as const,
      method,
      params,
    };

    const message = JSON.stringify(notification);

    for (const agent of this.getOnline()) {
      try {
        // @ts-expect-error - ws type varies by runtime
        agent.ws.send(message);
      } catch {
        // Ignore send errors for broadcasts
      }
    }
  }

  /**
   * Send a notification to a specific machine (no response expected)
   */
  notifyMachine(machineId: string, method: string, params?: unknown): boolean {
    const agent = this.agents.get(machineId);

    if (!agent || agent.status !== 'online' || !agent.ws) {
      return false;
    }

    const notification = {
      jsonrpc: '2.0' as const,
      method,
      params,
    };

    try {
      // @ts-expect-error - ws type varies by runtime
      agent.ws.send(JSON.stringify(notification));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get count of connected machines
   */
  get onlineCount(): number {
    return this.getOnline().length;
  }

  /**
   * Get total count of registered machines
   */
  get totalCount(): number {
    return this.agents.size;
  }
}

// Use globalThis to persist singleton across hot reloads
// Module-level variables reset on hot reload, globalThis persists
declare global {
  var __agentdeckAgentRegistry: AgentRegistry | undefined;
}

export function getAgentRegistry(options?: { requestTimeout?: number }): AgentRegistry {
  if (!globalThis.__agentdeckAgentRegistry) {
    globalThis.__agentdeckAgentRegistry = new AgentRegistry(options);
  }
  return globalThis.__agentdeckAgentRegistry;
}

export function resetAgentRegistry(): void {
  globalThis.__agentdeckAgentRegistry = undefined;
}
