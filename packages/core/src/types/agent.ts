/**
 * Supported operating systems for agents
 */
export type AgentOS = 'windows' | 'darwin' | 'linux';

/**
 * Connection status of an agent
 */
export type AgentStatus = 'online' | 'offline';

/**
 * Represents a connected device running the Cockpit agent.
 * Each agent corresponds to a machine that can run Claude Code instances.
 */
export interface Agent {
  /** Unique identifier for the agent */
  id: string;

  /** Unique machine identifier (hardware-based) */
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
