import type { Agent, CreateAgentData } from '@cockpit/core';
import type { JsonRpcResponse } from '@cockpit/core/protocol';
import {
  createRequest,
  createErrorResponse,
  JsonRpcErrorCode,
} from '@cockpit/core/protocol';
import { generateId, deferred } from '@cockpit/core/utils';

/**
 * Represents an agent currently connected via WebSocket
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
 * Registry for tracking connected agents
 */
export class AgentRegistry {
  private agents: Map<string, ConnectedAgent> = new Map();
  private machineIdToAgentId: Map<string, string> = new Map();
  private requestTimeout: number;

  constructor(options: { requestTimeout?: number } = {}) {
    this.requestTimeout = options.requestTimeout ?? 30000;
  }

  /**
   * Register a new agent connection
   */
  register(ws: unknown, info: CreateAgentData): ConnectedAgent {
    // Check if this machine is already registered
    const existingAgentId = this.machineIdToAgentId.get(info.machineId);
    if (existingAgentId) {
      // Update existing agent with new connection
      const existingAgent = this.agents.get(existingAgentId);
      if (existingAgent) {
        existingAgent.ws = ws;
        existingAgent.connectedAt = new Date();
        existingAgent.lastPing = new Date();
        existingAgent.status = 'online';
        existingAgent.hostname = info.hostname;
        existingAgent.tailscaleIp = info.tailscaleIp;
        return existingAgent;
      }
    }

    // Create new agent
    const agentId = generateId();
    const now = new Date();

    const agent: ConnectedAgent = {
      id: agentId,
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

    this.agents.set(agentId, agent);
    this.machineIdToAgentId.set(info.machineId, agentId);

    return agent;
  }

  /**
   * Register an agent with a specific ID (used when reusing database IDs)
   */
  registerWithId(ws: unknown, agentId: string, info: CreateAgentData): ConnectedAgent {
    // Check if this agent ID is already registered
    const existingAgent = this.agents.get(agentId);
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

    // Create new agent with specified ID
    const now = new Date();

    const agent: ConnectedAgent = {
      id: agentId,
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

    this.agents.set(agentId, agent);
    this.machineIdToAgentId.set(info.machineId, agentId);

    return agent;
  }

  /**
   * Unregister an agent (disconnect)
   * @param agentId - The agent ID to unregister
   * @param ws - Optional: only unregister if this is the current WebSocket (prevents race conditions)
   * @returns object with status info, or null if skipped (ws mismatch or not found)
   */
  unregister(agentId: string, ws?: unknown): { agentId: string; newStatus: 'reconnecting' } | null {
    const agent = this.agents.get(agentId);
    if (!agent) return null;

    // If ws is provided, only unregister if it matches the current connection
    // This prevents race conditions where old WebSocket close events fire after reconnection
    if (ws !== undefined && agent.ws !== ws) {
      console.log(`[AgentRegistry] Skipping unregister for ${agentId} - WebSocket mismatch (stale close event)`);
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

    return { agentId, newStatus: 'reconnecting' };
  }

  /**
   * Remove an agent completely from registry
   */
  remove(agentId: string): boolean {
    const agent = this.agents.get(agentId);
    if (agent) {
      this.machineIdToAgentId.delete(agent.machineId);
      this.agents.delete(agentId);
      return true;
    }
    return false;
  }

  /**
   * Get an agent by ID
   */
  get(agentId: string): ConnectedAgent | undefined {
    return this.agents.get(agentId);
  }

  /**
   * Get an agent by machine ID
   */
  getByMachineId(machineId: string): ConnectedAgent | undefined {
    const agentId = this.machineIdToAgentId.get(machineId);
    return agentId ? this.agents.get(agentId) : undefined;
  }

  /**
   * Get all registered agents
   */
  getAll(): ConnectedAgent[] {
    return Array.from(this.agents.values());
  }

  /**
   * Get all online agents
   */
  getOnline(): ConnectedAgent[] {
    return Array.from(this.agents.values()).filter(
      (agent) => agent.status === 'online' && agent.ws !== null
    );
  }

  /**
   * Update agent's last ping time
   */
  updatePing(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.lastPing = new Date();
      agent.lastSeen = new Date();
    }
  }

  /**
   * Send a JSON-RPC request to an agent and wait for response
   */
  async sendToAgent(agentId: string, method: string, params?: unknown): Promise<JsonRpcResponse> {
    const agent = this.agents.get(agentId);

    if (!agent) {
      return createErrorResponse(
        '0',
        JsonRpcErrorCode.INTERNAL_ERROR,
        `Agent ${agentId} not found`
      );
    }

    if (agent.status === 'reconnecting') {
      return createErrorResponse(
        '0',
        JsonRpcErrorCode.INTERNAL_ERROR,
        `Agent ${agentId} is reconnecting`,
        { code: 'AGENT_RECONNECTING', agentId }
      );
    }

    if (agent.status !== 'online' || !agent.ws) {
      return createErrorResponse(
        '0',
        JsonRpcErrorCode.INTERNAL_ERROR,
        `Agent ${agentId} is not connected`,
        { code: 'AGENT_OFFLINE', agentId }
      );
    }

    const request = createRequest(generateId(), method, params);
    const { promise, resolve, reject } = deferred<JsonRpcResponse>();

    // Set up timeout
    const timeout = setTimeout(() => {
      agent.pendingRequests.delete(request.id);
      reject(new Error(`Request to agent ${agentId} timed out`));
    }, this.requestTimeout);

    // Store pending request
    agent.pendingRequests.set(request.id, { resolve, reject, timeout });

    try {
      // Send the request via WebSocket
      const serialized = JSON.stringify(request);
      console.log(`[AgentRegistry] Sending to agent ${agentId}:`, serialized.slice(0, 300));
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
   * Send a JSON-RPC request to an agent by machineId (stable identifier)
   * Falls back to agentId if machineId lookup fails
   */
  async sendToAgentByMachineId(
    machineId: string | undefined,
    agentId: string,
    method: string,
    params?: unknown
  ): Promise<JsonRpcResponse> {
    // Try to find agent by machineId first (stable across hub restarts)
    let agent = machineId ? this.getByMachineId(machineId) : undefined;

    // Fall back to agentId if machineId lookup fails
    if (!agent) {
      agent = this.agents.get(agentId);
    }

    if (!agent) {
      return createErrorResponse(
        '0',
        JsonRpcErrorCode.INTERNAL_ERROR,
        `Agent not found (machineId: ${machineId}, agentId: ${agentId})`
      );
    }

    // Use the found agent's actual ID for the request
    return this.sendToAgent(agent.id, method, params);
  }

  /**
   * Handle a response from an agent
   */
  handleResponse(agentId: string, response: JsonRpcResponse): boolean {
    const agent = this.agents.get(agentId);
    if (!agent) return false;

    const pending = agent.pendingRequests.get(response.id);
    if (!pending) return false;

    clearTimeout(pending.timeout);
    agent.pendingRequests.delete(response.id);
    pending.resolve(response);

    return true;
  }

  /**
   * Handle a response by request ID (searches all agents for the pending request)
   * This is used when we can't determine the agent from the WebSocket
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
   * Broadcast a notification to all online agents
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
   * Send a notification to a specific agent (no response expected)
   */
  notifyAgent(agentId: string, method: string, params?: unknown): boolean {
    const agent = this.agents.get(agentId);

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
   * Get count of connected agents
   */
  get onlineCount(): number {
    return this.getOnline().length;
  }

  /**
   * Get total count of registered agents
   */
  get totalCount(): number {
    return this.agents.size;
  }
}

// Use globalThis to persist singleton across hot reloads
// Module-level variables reset on hot reload, globalThis persists
declare global {
  var __cockpitAgentRegistry: AgentRegistry | undefined;
}

export function getAgentRegistry(options?: { requestTimeout?: number }): AgentRegistry {
  if (!globalThis.__cockpitAgentRegistry) {
    globalThis.__cockpitAgentRegistry = new AgentRegistry(options);
  }
  return globalThis.__cockpitAgentRegistry;
}

export function resetAgentRegistry(): void {
  globalThis.__cockpitAgentRegistry = undefined;
}
