import { SvelteMap } from 'svelte/reactivity';
import type { Agent } from './types';

/**
 * Agent store - manages connected agent state.
 * Uses SvelteMap for reactive mutations without reassignment.
 */
class AgentStore {
  #agents = $state(new SvelteMap<string, Agent>());

  /** Get the underlying map (read-only access for iteration) */
  get all() {
    return this.#agents;
  }

  /** Get agent count */
  get size() {
    return this.#agents.size;
  }

  /** Derived: online agents only */
  readonly online = $derived(
    Array.from(this.#agents.values()).filter(a => a.status === 'online')
  );

  /** Derived: count of online agents */
  readonly onlineCount = $derived(this.online.length);

  // ========================================
  // Mutations
  // ========================================

  /** Set or update an agent */
  set(machineId: string, agent: Agent): void {
    this.#agents.set(machineId, agent);
  }

  /** Get an agent by machineId */
  get(machineId: string): Agent | undefined {
    return this.#agents.get(machineId);
  }

  /** Check if an agent exists */
  has(machineId: string): boolean {
    return this.#agents.has(machineId);
  }

  /** Update agent status */
  updateStatus(machineId: string, status: Agent['status']): void {
    const agent = this.#agents.get(machineId);
    if (agent) {
      this.#agents.set(machineId, { ...agent, status });
    }
  }

  /** Update agent with partial data */
  update(machineId: string, updates: Partial<Agent>): void {
    const agent = this.#agents.get(machineId);
    if (agent) {
      this.#agents.set(machineId, { ...agent, ...updates });
    }
  }

  /** Delete an agent */
  delete(machineId: string): boolean {
    return this.#agents.delete(machineId);
  }

  /** Clear all agents */
  clear(): void {
    this.#agents.clear();
  }

  /** Bulk set agents (for SSR initialization) */
  setAll(agentsMap: Map<string, Agent>): void {
    this.#agents.clear();
    for (const [id, agent] of agentsMap) {
      this.#agents.set(id, agent);
    }
  }

  /** Initialize from SSR data */
  initializeFromSSR(agentsData: Array<{
    machineId: string;
    hostname?: string;
    os?: string;
    status: 'online' | 'offline' | 'reconnecting';
    tailscaleIp?: string;
    connectedAt?: string;
    lastPing?: string;
  }>): void {
    this.#agents.clear();
    for (const a of agentsData) {
      this.#agents.set(a.machineId, {
        machineId: a.machineId,
        name: a.hostname || a.machineId,
        os: (a.os as 'darwin' | 'linux' | 'windows') || 'linux',
        status: a.status,
        instances: 0,
        ip: a.tailscaleIp || '',
        connectedAt: a.connectedAt ? new Date(a.connectedAt) : undefined,
        lastPing: a.lastPing ? new Date(a.lastPing) : undefined,
      });
    }
  }
}

// Singleton with HMR persistence
function createAgentStore(): AgentStore {
  // @ts-expect-error - globalThis extension for HMR
  if (globalThis.__cockpitAgentStore) {
    // @ts-expect-error - globalThis extension for HMR
    return globalThis.__cockpitAgentStore;
  }
  const store = new AgentStore();
  // @ts-expect-error - globalThis extension for HMR
  globalThis.__cockpitAgentStore = store;
  return store;
}

export const agents = createAgentStore();
