/**
 * Supported operating systems for agents
 */
export type AgentOS = 'windows' | 'darwin' | 'linux';

/**
 * Connection status of an agent
 * - 'online': Agent is connected and ready
 * - 'reconnecting': Agent disconnected but expected to reconnect soon
 * - 'offline': Agent is disconnected
 */
export type AgentStatus = 'online' | 'reconnecting' | 'offline';

/**
 * Represents a connected machine running the Cockpit agent service.
 * Each machine can run multiple Claude Code instances.
 *
 * The machineId is the primary identifier - it's stable and hardware-derived.
 * There is no separate "agentId" - the machine IS the agent.
 */
export interface Agent {
  /**
   * Unique machine identifier (hardware-based, stable).
   * This is the PRIMARY KEY - used for all routing and references.
   */
  machineId: string;

  /** Hostname of the machine */
  hostname: string;

  /** Tailscale IP address for secure communication */
  tailscaleIp: string;

  /** Operating system of the machine */
  os: AgentOS;

  /** Current connection status */
  status: AgentStatus;

  /** Last time the agent was seen online */
  lastSeen: Date;

  /** When the agent was first registered */
  createdAt: Date;
}

/**
 * Data required to create a new agent
 */
export interface CreateAgentData {
  machineId: string;
  hostname: string;
  tailscaleIp: string;
  os: AgentOS;
}

/**
 * Data for updating an existing agent
 */
export interface UpdateAgentData {
  hostname?: string;
  tailscaleIp?: string;
  status?: AgentStatus;
  lastSeen?: Date;
}
