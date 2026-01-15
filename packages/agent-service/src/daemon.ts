import { EventEmitter } from 'events';
import {
  type JsonRpcRequest,
  type JsonRpcNotification,
  createNotification,
  PROTOCOL_METHODS,
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
  handleCommandsList,
  handleModelsList,
  handleModelsSet,
  handleClaudeVersion,
  handleMemoryRead,
  handleMemoryWrite,
} from './handlers/index.js';

export interface AgentDaemonOptions {
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
  'instance.sleeping': (instanceId: string) => void;
  'instance.error': (instanceId: string, error: Error) => void;
}

/**
 * Main service that orchestrates the agent components.
 *
 * The agent identifies itself by machineId (stable, hardware-derived).
 * No ephemeral agentId is used - machineId IS the identity.
 */
export class AgentDaemon extends EventEmitter {
  private readonly machineId: string;
  private readonly instanceManager: InstanceManager;
  private readonly hubClient: HubClient;
  private readonly discovery: AgentDiscovery;
  private readonly options: Required<Omit<AgentDaemonOptions, 'hubUrl' | 'hubClientOptions' | 'discoveryOptions'>>;
  private hubUrl: string | null;

  private isRunning: boolean = false;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private startTime: Date = new Date();

  constructor(options: AgentDaemonOptions = {}) {
    super();

    // machineId is stable and hardware-derived
    this.machineId = getMachineFingerprint();
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
   * Get the machine ID (stable identifier)
   */
  get id(): string {
    return this.machineId;
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
      // Registration happens automatically via 'connected' event handler
      console.log(`Connecting to hub at ${this.hubUrl}...`);
      await this.hubClient.connect(this.hubUrl);

      // Start heartbeat
      this.startHeartbeat();

      // Advertise if enabled
      if (this.options.advertise && this.options.advertisePort > 0) {
        this.discovery.advertise(this.options.advertisePort);
      }

      this.emit('started');
      console.log(`Agent daemon started (machineId: ${this.machineId})`);
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
   * Register agent with the hub using machineId as identity
   */
  private async register(): Promise<void> {
    const hostname = getHostname();
    const os = normalizeOS(getPlatform());

    // Try to get Tailscale IP, fall back to localhost
    let tailscaleIp = '127.0.0.1';
    try {
      const tsIp = await getTailscaleIp();
      if (tsIp) tailscaleIp = tsIp;
    } catch {
      // Tailscale not available, use localhost
    }

    // Get all running instances to send with registration
    // This allows hub to reconcile state (mark orphaned instances as sleeping)
    const runningInstances = this.instanceManager.listInstances()
      .filter(inst => inst.state === 'running' || inst.state === 'starting')
      .map(inst => ({
        id: inst.instanceId,
        sessionId: inst.sessionId,
        sdkSessionId: inst.sdkSessionId,
        cwd: inst.projectPath,
        status: inst.state,
      }));

    const result = await this.hubClient.request<{ machineId: string; registered: boolean }>(
      PROTOCOL_METHODS.AGENT_REGISTER,
      {
        machineId: this.machineId,
        hostname,
        tailscaleIp,
        os,
        instances: runningInstances,
      }
    );

    console.log(`Registered with hub (machineId: ${this.machineId})`);
  }

  /**
   * Setup event handlers for all components
   */
  private setupEventHandlers(): void {
    // Hub client events
    this.hubClient.on('connected', async () => {
      console.log('Connected to hub');
      // Always re-register on connection (handles both initial connect and reconnects)
      // This ensures the hub knows about this machine after hub restarts
      try {
        await this.register();
      } catch (error) {
        console.error('Failed to register with hub:', error);
        this.emit('error', error instanceof Error ? error : new Error(String(error)));
      }
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
        machineId: this.machineId,
        instanceId,
        sessionId,
        timestamp: new Date().toISOString(),
      });
    });

    this.instanceManager.on('instance.stopped', (instanceId: string) => {
      this.emit('instance.stopped', instanceId);
      this.hubClient.notify(PROTOCOL_METHODS.INSTANCE_STOPPED, {
        machineId: this.machineId,
        instanceId,
        timestamp: new Date().toISOString(),
      });
    });

    this.instanceManager.on('instance.sleeping', (instanceId: string) => {
      const status = this.instanceManager.getStatus(instanceId);
      this.emit('instance.sleeping', instanceId);
      this.hubClient.notify(PROTOCOL_METHODS.INSTANCE_SLEEPING, {
        machineId: this.machineId,
        instanceId,
        sdkSessionId: status?.sdkSessionId,
        timestamp: new Date().toISOString(),
      });
    });

    this.instanceManager.on('instance.error', (instanceId: string, error: Error) => {
      this.emit('instance.error', instanceId, error);
      this.hubClient.notify(PROTOCOL_METHODS.INSTANCE_ERROR, {
        machineId: this.machineId,
        instanceId,
        error: error.message,
        timestamp: new Date().toISOString(),
      });
    });

    this.instanceManager.on('instance.statusChanged', (instanceId: string, previousStatus: string, newStatus: string) => {
      this.hubClient.notify(PROTOCOL_METHODS.INSTANCE_STATUS_CHANGED, {
        machineId: this.machineId,
        instanceId,
        previousStatus,
        newStatus,
        timestamp: new Date().toISOString(),
      });
    });

    this.instanceManager.on('sdk.message', (instanceId: string, message: unknown) => {
      // Forward SDK messages to hub
      this.hubClient.notify(PROTOCOL_METHODS.SDK_MESSAGE, {
        machineId: this.machineId,
        instanceId,
        message,
        timestamp: new Date().toISOString(),
      });
    });

    // Permission request events
    this.instanceManager.on('permission.request', (request) => {
      // Forward permission requests to hub
      this.hubClient.notify(PROTOCOL_METHODS.PERMISSION_REQUEST, {
        machineId: this.machineId,
        ...request,
        timestamp: new Date().toISOString(),
      });
    });

    // Question request events (AskUserQuestion UI bridge)
    this.instanceManager.on('question.request', (request) => {
      // Forward question requests to hub for dashboard UI
      this.hubClient.notify(PROTOCOL_METHODS.QUESTION_REQUEST, {
        machineId: this.machineId,
        ...request,
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

      case PROTOCOL_METHODS.INSTANCE_INTERRUPT:
        await this.handleInterrupt(request);
        break;

      case PROTOCOL_METHODS.INSTANCE_REWIND:
        await this.handleRewind(request);
        break;

      case PROTOCOL_METHODS.INSTANCE_STATUS:
        await handleInstanceStatus(request, this.instanceManager, this.hubClient);
        break;

      case PROTOCOL_METHODS.AGENT_STATUS:
        await handleAgentStatus(
          request,
          this.instanceManager,
          this.hubClient,
          this.machineId,
          this.startTime
        );
        break;

      case PROTOCOL_METHODS.FILESYSTEM_LIST:
        await handleFilesystemList(request, this.hubClient);
        break;

      case PROTOCOL_METHODS.COMMANDS_LIST:
        await handleCommandsList(request, this.instanceManager, this.hubClient);
        break;

      case PROTOCOL_METHODS.MODELS_LIST:
        await handleModelsList(request, this.instanceManager, this.hubClient);
        break;

      case PROTOCOL_METHODS.MODELS_SET:
        await handleModelsSet(request, this.instanceManager, this.hubClient);
        break;

      case PROTOCOL_METHODS.CLAUDE_VERSION:
        await handleClaudeVersion(request, this.hubClient);
        break;

      case PROTOCOL_METHODS.MEMORY_READ:
        await handleMemoryRead(request, this.hubClient);
        break;

      case PROTOCOL_METHODS.MEMORY_WRITE:
        await handleMemoryWrite(request, this.hubClient);
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

    switch (notification.method) {
      case PROTOCOL_METHODS.PERMISSION_RESPONSE: {
        const params = notification.params as {
          requestId: string;
          instanceId: string;
          behavior: 'allow' | 'deny';
          updatedInput?: Record<string, unknown>;
          updatedPermissions?: unknown[];
          message?: string;
          interrupt?: boolean;
        };
        this.instanceManager.resolvePermission({
          requestId: params.requestId,
          instanceId: params.instanceId,
          behavior: params.behavior,
          updatedInput: params.updatedInput,
          updatedPermissions: params.updatedPermissions as any,
          message: params.message,
          interrupt: params.interrupt,
        });
        break;
      }

      case PROTOCOL_METHODS.QUESTION_RESPONSE: {
        const params = notification.params as {
          requestId: string;
          instanceId: string;
          answers: Record<string, string>;
        };
        this.instanceManager.resolveQuestion({
          requestId: params.requestId,
          instanceId: params.instanceId,
          answers: params.answers,
        });
        break;
      }
    }
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
          machineId: this.machineId,
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
   * Interrupt an instance's current operation
   */
  async interruptInstance(instanceId: string): Promise<string | undefined> {
    return this.instanceManager.interrupt(instanceId);
  }

  /**
   * Handle interrupt request from hub
   */
  private async handleInterrupt(request: JsonRpcRequest): Promise<void> {
    const params = request.params as { instanceId: string };

    try {
      const sdkSessionId = await this.instanceManager.interrupt(params.instanceId);

      this.hubClient.respond(request.id, {
        success: true,
        sdkSessionId,
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.hubClient.respondError(request.id, -32000, err.message);
    }
  }

  /**
   * Handle rewind files request from hub
   */
  private async handleRewind(request: JsonRpcRequest): Promise<void> {
    const params = request.params as { instanceId: string; userMessageId: string };

    try {
      await this.instanceManager.rewindFiles(params.instanceId, params.userMessageId);

      this.hubClient.respond(request.id, {
        success: true,
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.hubClient.respondError(request.id, -32000, err.message);
    }
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
