import { EventEmitter } from 'events';
import {
  type JsonRpcRequest,
  type JsonRpcNotification,
  createNotification,
  PROTOCOL_METHODS,
  generateId,
  getHostname,
  getPlatform,
  normalizeOS,
  getMachineFingerprint,
  getTailscaleIp,
} from '@cockpit/core';
import { InstanceManager, type SpawnInstanceParams, type InstanceStatusInfo } from './instance-manager.js';
import { HubClient, type HubClientOptions } from './hub-client.js';
import { AgentDiscovery, type HubService, type AgentDiscoveryOptions } from './discovery.js';
import {
  handleSpawn,
  handleCommand,
  handleStop,
  handleAgentStatus,
  handleInstanceStatus,
  handleFilesystemList,
} from './handlers/index.js';

export interface AgentDaemonOptions {
  /** Agent ID (auto-generated if not provided) */
  agentId?: string;
  /** Hub URL to connect to (if known) */
  hubUrl?: string;
  /** Use mDNS discovery to find hub */
  useDiscovery?: boolean;
  /** Hub client options */
  hubClientOptions?: HubClientOptions;
  /** Discovery options */
  discoveryOptions?: AgentDiscoveryOptions;
  /** Heartbeat interval (ms) */
  heartbeatInterval?: number;
  /** Advertise agent via mDNS */
  advertise?: boolean;
  /** Port for advertising (if advertising) */
  advertisePort?: number;
}

export interface AgentDaemonEvents {
  started: () => void;
  stopped: () => void;
  connected: () => void;
  disconnected: () => void;
  error: (error: Error) => void;
  'instance.started': (instanceId: string, sessionId: string) => void;
  'instance.stopped': (instanceId: string) => void;
  'instance.error': (instanceId: string, error: Error) => void;
}

/**
 * Main service that orchestrates the agent components
 */
export class AgentDaemon extends EventEmitter {
  private readonly agentId: string;
  private readonly instanceManager: InstanceManager;
  private readonly hubClient: HubClient;
  private readonly discovery: AgentDiscovery;
  private readonly options: Required<Omit<AgentDaemonOptions, 'agentId' | 'hubUrl' | 'hubClientOptions' | 'discoveryOptions'>>;
  private hubUrl: string | null;

  private isRunning: boolean = false;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private startTime: Date = new Date();

  constructor(options: AgentDaemonOptions = {}) {
    super();

    this.agentId = options.agentId ?? generateId();
    this.hubUrl = options.hubUrl ?? null;
    this.options = {
      useDiscovery: options.useDiscovery ?? true,
      heartbeatInterval: options.heartbeatInterval ?? 30000,
      advertise: options.advertise ?? false,
      advertisePort: options.advertisePort ?? 0,
    };

    this.instanceManager = new InstanceManager();
    this.hubClient = new HubClient(options.hubClientOptions);
    this.discovery = new AgentDiscovery(options.discoveryOptions);

    this.setupEventHandlers();
  }

  /**
   * Get the agent ID
   */
  get id(): string {
    return this.agentId;
  }

  /**
   * Check if the daemon is running
   */
  get running(): boolean {
    return this.isRunning;
  }

  /**
   * Check if connected to the hub
   */
  get connected(): boolean {
    return this.hubClient.isConnected;
  }

  /**
   * Start the agent daemon
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      throw new Error('Daemon is already running');
    }

    this.isRunning = true;
    this.startTime = new Date();

    try {
      // Find hub if URL not provided
      if (!this.hubUrl && this.options.useDiscovery) {
        console.log('Discovering hub via mDNS...');
        const hub = await this.discovery.browseForHub();
        this.hubUrl = `ws://${hub.host}:${hub.port}/ws/hub`;
        console.log(`Found hub at ${this.hubUrl}`);
      }

      if (!this.hubUrl) {
        throw new Error('No hub URL configured and discovery failed');
      }

      // Connect to hub
      console.log(`Connecting to hub at ${this.hubUrl}...`);
      await this.hubClient.connect(this.hubUrl);

      // Register with hub
      await this.register();

      // Start heartbeat
      this.startHeartbeat();

      // Advertise if enabled
      if (this.options.advertise && this.options.advertisePort > 0) {
        this.discovery.advertise(this.options.advertisePort);
      }

      this.emit('started');
      console.log(`Agent daemon started (id: ${this.agentId})`);
    } catch (error) {
      this.isRunning = false;
      throw error;
    }
  }

  /**
   * Stop the agent daemon
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    console.log('Stopping agent daemon...');

    // Stop heartbeat
    this.stopHeartbeat();

    // Stop all instances
    await this.instanceManager.stopAll();

    // Disconnect from hub
    this.hubClient.disconnect();

    // Stop discovery
    this.discovery.stop();

    this.isRunning = false;
    this.emit('stopped');

    console.log('Agent daemon stopped');
  }

  /**
   * Register agent with the hub
   */
  private async register(): Promise<void> {
    const hostname = getHostname();
    const os = normalizeOS(getPlatform());
    const machineId = getMachineFingerprint();

    // Try to get Tailscale IP, fall back to localhost
    let tailscaleIp = '127.0.0.1';
    try {
      const tsIp = await getTailscaleIp();
      if (tsIp) tailscaleIp = tsIp;
    } catch {
      // Tailscale not available, use localhost
    }

    const result = await this.hubClient.request<{ agentId: string }>(
      PROTOCOL_METHODS.AGENT_REGISTER,
      {
        machineId,
        hostname,
        tailscaleIp,
        os,
      }
    );

    // Use the agent ID assigned by the hub
    if (result?.agentId) {
      (this as any).agentId = result.agentId;
    }

    console.log(`Registered with hub as ${this.agentId}`);
  }

  /**
   * Setup event handlers for all components
   */
  private setupEventHandlers(): void {
    // Hub client events
    this.hubClient.on('connected', () => {
      console.log('Connected to hub');
      this.emit('connected');
    });

    this.hubClient.on('disconnected', (code, reason) => {
      console.log(`Disconnected from hub: ${code} ${reason}`);
      this.emit('disconnected');
    });

    this.hubClient.on('reconnecting', (attempt) => {
      console.log(`Reconnecting to hub (attempt ${attempt})...`);
    });

    this.hubClient.on('error', (error) => {
      console.error('Hub client error:', error);
      this.emit('error', error);
    });

    this.hubClient.on('request', (request: JsonRpcRequest) => {
      this.handleRequest(request);
    });

    this.hubClient.on('notification', (notification: JsonRpcNotification) => {
      this.handleNotification(notification);
    });

    // Instance manager events
    this.instanceManager.on('instance.started', (instanceId: string, sessionId: string) => {
      this.emit('instance.started', instanceId, sessionId);
      this.hubClient.notify(PROTOCOL_METHODS.INSTANCE_STARTED, {
        agentId: this.agentId,
        instanceId,
        sessionId,
        timestamp: new Date().toISOString(),
      });
    });

    this.instanceManager.on('instance.stopped', (instanceId: string) => {
      this.emit('instance.stopped', instanceId);
      this.hubClient.notify(PROTOCOL_METHODS.INSTANCE_STOPPED, {
        agentId: this.agentId,
        instanceId,
        timestamp: new Date().toISOString(),
      });
    });

    this.instanceManager.on('instance.error', (instanceId: string, error: Error) => {
      this.emit('instance.error', instanceId, error);
      this.hubClient.notify(PROTOCOL_METHODS.INSTANCE_ERROR, {
        agentId: this.agentId,
        instanceId,
        error: error.message,
        timestamp: new Date().toISOString(),
      });
    });

    this.instanceManager.on('sdk.message', (instanceId: string, message: unknown) => {
      // Forward SDK messages to hub
      this.hubClient.notify(PROTOCOL_METHODS.SDK_MESSAGE, {
        agentId: this.agentId,
        instanceId,
        message,
        timestamp: new Date().toISOString(),
      });
    });

    this.instanceManager.on('instance.message', (instanceId: string, message: unknown) => {
      this.hubClient.notify(PROTOCOL_METHODS.INSTANCE_MESSAGE, {
        agentId: this.agentId,
        instanceId,
        message,
        timestamp: new Date().toISOString(),
      });
    });

    // Discovery events
    this.discovery.on('hub.found', (service: HubService) => {
      console.log(`Hub discovered: ${service.name} at ${service.host}:${service.port}`);
    });

    this.discovery.on('hub.lost', (service: HubService) => {
      console.log(`Hub lost: ${service.name}`);
    });
  }

  /**
   * Handle incoming JSON-RPC requests from the hub
   */
  private async handleRequest(request: JsonRpcRequest): Promise<void> {
    console.log(`Received request: ${request.method}`);

    switch (request.method) {
      case PROTOCOL_METHODS.INSTANCE_SPAWN:
        await handleSpawn(request, this.instanceManager, this.hubClient);
        break;

      case PROTOCOL_METHODS.INSTANCE_SEND:
        await handleCommand(request, this.instanceManager, this.hubClient);
        break;

      case PROTOCOL_METHODS.INSTANCE_STOP:
        await handleStop(request, this.instanceManager, this.hubClient);
        break;

      case PROTOCOL_METHODS.INSTANCE_STATUS:
        await handleInstanceStatus(request, this.instanceManager, this.hubClient);
        break;

      case PROTOCOL_METHODS.AGENT_STATUS:
        await handleAgentStatus(
          request,
          this.instanceManager,
          this.hubClient,
          this.agentId,
          this.startTime
        );
        break;

      case PROTOCOL_METHODS.FILESYSTEM_LIST:
        await handleFilesystemList(request, this.hubClient);
        break;

      default:
        console.warn(`Unknown method: ${request.method}`);
    }
  }

  /**
   * Handle incoming JSON-RPC notifications from the hub
   */
  private handleNotification(notification: JsonRpcNotification): void {
    console.log(`Received notification: ${notification.method}`);
    // Currently no notifications to handle from hub
  }

  /**
   * Start heartbeat timer
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();

    this.heartbeatTimer = setInterval(() => {
      if (this.hubClient.isConnected) {
        // Use notify instead of request - heartbeat doesn't need a response
        this.hubClient.notify(PROTOCOL_METHODS.AGENT_HEARTBEAT, {
          agentId: this.agentId,
          instanceCount: this.instanceManager.listInstances().length,
          timestamp: new Date().toISOString(),
        });
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

  /**
   * Spawn a new instance
   */
  async spawnInstance(params: SpawnInstanceParams): Promise<string> {
    return this.instanceManager.spawn(params);
  }

  /**
   * Send a message to an instance
   */
  async sendMessage(instanceId: string, content: string): Promise<void> {
    return this.instanceManager.sendMessage(instanceId, content);
  }

  /**
   * Stop an instance
   */
  async stopInstance(instanceId: string): Promise<void> {
    return this.instanceManager.stop(instanceId);
  }

  /**
   * Get instance status
   */
  getInstanceStatus(instanceId: string): InstanceStatusInfo | undefined {
    return this.instanceManager.getStatus(instanceId);
  }

  /**
   * List all instances
   */
  listInstances(): InstanceStatusInfo[] {
    return this.instanceManager.listInstances();
  }

  /**
   * Get the instance manager (for advanced usage)
   */
  getInstanceManager(): InstanceManager {
    return this.instanceManager;
  }

  /**
   * Get the hub client (for advanced usage)
   */
  getHubClient(): HubClient {
    return this.hubClient;
  }

  /**
   * Get the discovery service (for advanced usage)
   */
  getDiscovery(): AgentDiscovery {
    return this.discovery;
  }
}

export default AgentDaemon;
