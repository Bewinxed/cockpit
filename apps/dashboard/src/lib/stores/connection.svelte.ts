/**
 * Connection store - manages SSE connection to hub using river.ts.
 *
 * Uses river.ts RiverClient for type-safe SSE event handling.
 * All event handlers are wired to entity stores via the SSE event handlers.
 */
import { RiverClient } from 'river.ts/client';
import { RiverEvents } from 'river.ts';
import type {
  CockpitEventMap,
  AgentConnectedEvent,
  AgentDisconnectedEvent,
  AgentReconnectingEvent,
  AgentUpdatedEvent,
  InstanceCreatedEvent,
  InstanceStartedEvent,
  InstanceStoppedEvent,
  InstanceSleepingEvent,
  InstanceErrorEvent,
  InstanceResumedEvent,
  InstanceTokenUsageEvent,
  InstanceModelChangedEvent,
  SdkMessageEvent,
  TaskCreatedEvent,
  TaskUpdatedEvent,
  TaskCompletedEvent,
  PermissionRequestEvent,
  ProjectCreatedEvent,
  ProjectUpdatedEvent,
  ProjectDeletedEvent,
} from './sse-events';

// Define the event schema for river.ts using RiverEvents builder
// Each event's data property contains the actual payload type
const cockpitEvents = new RiverEvents()
  // Agent events
  .defineEvent('agent:connected', { data: {} as AgentConnectedEvent })
  .defineEvent('agent:disconnected', { data: {} as AgentDisconnectedEvent })
  .defineEvent('agent:reconnecting', { data: {} as AgentReconnectingEvent })
  .defineEvent('agent:updated', { data: {} as AgentUpdatedEvent })
  // Instance lifecycle events
  .defineEvent('instance:created', { data: {} as InstanceCreatedEvent })
  .defineEvent('instance:started', { data: {} as InstanceStartedEvent })
  .defineEvent('instance:stopped', { data: {} as InstanceStoppedEvent })
  .defineEvent('instance:sleeping', { data: {} as InstanceSleepingEvent })
  .defineEvent('instance:error', { data: {} as InstanceErrorEvent })
  .defineEvent('instance:resumed', { data: {} as InstanceResumedEvent })
  .defineEvent('instance:token_usage', { data: {} as InstanceTokenUsageEvent })
  .defineEvent('instance:model-changed', { data: {} as InstanceModelChangedEvent })
  // SDK message event
  .defineEvent('sdk:message', { data: {} as SdkMessageEvent })
  // Task events
  .defineEvent('task:created', { data: {} as TaskCreatedEvent })
  .defineEvent('task:updated', { data: {} as TaskUpdatedEvent })
  .defineEvent('task:completed', { data: {} as TaskCompletedEvent })
  // Permission events
  .defineEvent('permission:request', { data: {} as PermissionRequestEvent })
  // Project events
  .defineEvent('project:created', { data: {} as ProjectCreatedEvent })
  .defineEvent('project:updated', { data: {} as ProjectUpdatedEvent })
  .defineEvent('project:deleted', { data: {} as ProjectDeletedEvent })
  // Connection event (from hub)
  .defineEvent('connected', { data: { clientId: '' } })
  .build();

type CockpitEventsType = typeof cockpitEvents;

class ConnectionStore {
  status = $state<'connecting' | 'connected' | 'disconnected' | 'error'>('disconnected');

  #client: RiverClient<CockpitEventsType> | null = null;
  #reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  #reconnectAttempts = 0;
  #maxReconnectAttempts = 10;
  #baseUrl = '';

  // Event handlers - will be called with typed data
  #handlers = new Map<string, (data: unknown) => void>();

  /** Register an event handler */
  on<K extends keyof CockpitEventMap>(eventType: K, handler: (data: CockpitEventMap[K]) => void): void {
    this.#handlers.set(eventType, handler as (data: unknown) => void);
  }

  /** Register handler for the 'connected' event */
  onConnected(handler: (data: { clientId: string }) => void): void {
    this.#handlers.set('connected', handler as (data: unknown) => void);
  }

  /** Remove an event handler */
  off(eventType: string): void {
    this.#handlers.delete(eventType);
  }

  /** Connect to SSE endpoint */
  connect(baseUrl: string = ''): void {
    this.#baseUrl = baseUrl;

    // Close existing connection
    if (this.#client) {
      this.#client.close();
      this.#client = null;
    }

    this.status = 'connecting';

    const url = `${baseUrl}/api/events`;

    // Initialize river.ts client with the typed events schema
    this.#client = RiverClient.init(cockpitEvents, {
      reconnect: true,
    });

    // Prepare and start the connection
    this.#client
      .prepare(url, { method: 'GET' })
      // Agent events - river.ts passes parsed data directly to handlers
      .on('agent:connected', (data) => {
        this.#handlers.get('agent:connected')?.(data);
      })
      .on('agent:disconnected', (data) => {
        this.#handlers.get('agent:disconnected')?.(data);
      })
      .on('agent:reconnecting', (data) => {
        this.#handlers.get('agent:reconnecting')?.(data);
      })
      .on('agent:updated', (data) => {
        this.#handlers.get('agent:updated')?.(data);
      })
      // Instance events
      .on('instance:created', (data) => {
        this.#handlers.get('instance:created')?.(data);
      })
      .on('instance:started', (data) => {
        this.#handlers.get('instance:started')?.(data);
      })
      .on('instance:stopped', (data) => {
        this.#handlers.get('instance:stopped')?.(data);
      })
      .on('instance:sleeping', (data) => {
        this.#handlers.get('instance:sleeping')?.(data);
      })
      .on('instance:error', (data) => {
        this.#handlers.get('instance:error')?.(data);
      })
      .on('instance:resumed', (data) => {
        this.#handlers.get('instance:resumed')?.(data);
      })
      .on('instance:token_usage', (data) => {
        this.#handlers.get('instance:token_usage')?.(data);
      })
      .on('instance:model-changed', (data) => {
        this.#handlers.get('instance:model-changed')?.(data);
      })
      // SDK message
      .on('sdk:message', (data) => {
        this.#handlers.get('sdk:message')?.(data);
      })
      // Task events
      .on('task:created', (data) => {
        this.#handlers.get('task:created')?.(data);
      })
      .on('task:updated', (data) => {
        this.#handlers.get('task:updated')?.(data);
      })
      .on('task:completed', (data) => {
        this.#handlers.get('task:completed')?.(data);
      })
      // Permission events
      .on('permission:request', (data) => {
        this.#handlers.get('permission:request')?.(data);
      })
      // Project events
      .on('project:created', (data) => {
        this.#handlers.get('project:created')?.(data);
      })
      .on('project:updated', (data) => {
        this.#handlers.get('project:updated')?.(data);
      })
      .on('project:deleted', (data) => {
        this.#handlers.get('project:deleted')?.(data);
      })
      // Connection event
      .on('connected', (data) => {
        this.status = 'connected';
        this.#reconnectAttempts = 0;
        console.log('[SSE] Connected to hub, clientId:', data.clientId);
        this.#handlers.get('connected')?.(data);
      })
      // Close event
      .on('close', () => {
        console.log('[SSE] Connection closed');
        this.status = 'disconnected';
        this.#attemptReconnect();
      })
      // Start streaming
      .stream();
  }

  /** Attempt to reconnect with exponential backoff */
  #attemptReconnect(): void {
    if (this.#reconnectAttempts < this.#maxReconnectAttempts) {
      const delay = Math.min(1000 * Math.pow(2, this.#reconnectAttempts), 30000);
      console.log(`[SSE] Reconnecting in ${delay}ms (attempt ${this.#reconnectAttempts + 1}/${this.#maxReconnectAttempts})`);
      this.#reconnectTimeout = setTimeout(() => {
        this.#reconnectAttempts++;
        this.connect(this.#baseUrl);
      }, delay);
    } else {
      console.error('[SSE] Max reconnect attempts reached');
      this.status = 'error';
    }
  }

  /** Disconnect from SSE */
  disconnect(): void {
    if (this.#reconnectTimeout) {
      clearTimeout(this.#reconnectTimeout);
      this.#reconnectTimeout = null;
    }

    if (this.#client) {
      this.#client.close();
      this.#client = null;
    }

    this.status = 'disconnected';
  }

  /** Get current connection status */
  get isConnected(): boolean {
    return this.status === 'connected';
  }

  /** Force reconnect */
  reconnect(): void {
    this.disconnect();
    this.#reconnectAttempts = 0;
    this.connect(this.#baseUrl);
  }
}

// Singleton with HMR persistence
function createConnectionStore(): ConnectionStore {
  // @ts-expect-error - globalThis extension for HMR
  if (globalThis.__cockpitConnectionStore) {
    // @ts-expect-error - globalThis extension for HMR
    return globalThis.__cockpitConnectionStore;
  }
  const store = new ConnectionStore();
  // @ts-expect-error - globalThis extension for HMR
  globalThis.__cockpitConnectionStore = store;
  return store;
}

export const connection = createConnectionStore();
