/**
 * Connection store - manages SSE connection to hub.
 *
 * TODO: Migrate to river.ts for type-safe SSE when ready.
 * Currently uses native EventSource with manual event handling.
 */
class ConnectionStore {
  status = $state<'connecting' | 'connected' | 'disconnected' | 'error'>('disconnected');

  #eventSource: EventSource | null = null;
  #reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  #reconnectAttempts = 0;
  #maxReconnectAttempts = 10;
  #baseUrl = '';

  // Event handlers - set by the facade during initialization
  #handlers: Map<string, (data: unknown) => void> = new Map();

  /** Register an event handler */
  on(eventType: string, handler: (data: unknown) => void): void {
    this.#handlers.set(eventType, handler);
    // If already connected, add listener immediately
    if (this.#eventSource) {
      this.#eventSource.addEventListener(eventType, (event: Event) => {
        const data = JSON.parse((event as MessageEvent).data);
        handler(data);
      });
    }
  }

  /** Remove an event handler */
  off(eventType: string): void {
    this.#handlers.delete(eventType);
  }

  /** Connect to SSE endpoint */
  connect(baseUrl: string = ''): void {
    this.#baseUrl = baseUrl;

    if (this.#eventSource) {
      this.#eventSource.close();
    }

    this.status = 'connecting';

    const url = `${baseUrl}/api/events`;
    this.#eventSource = new EventSource(url);

    this.#eventSource.onopen = () => {
      this.status = 'connected';
      this.#reconnectAttempts = 0;
      console.log('[SSE] Connected to hub');
    };

    this.#eventSource.onerror = (error) => {
      console.error('[SSE] Connection error:', error);
      this.status = 'error';
      this.#eventSource?.close();
      this.#eventSource = null;

      // Attempt reconnection with exponential backoff
      if (this.#reconnectAttempts < this.#maxReconnectAttempts) {
        const delay = Math.min(1000 * Math.pow(2, this.#reconnectAttempts), 30000);
        this.#reconnectTimeout = setTimeout(() => {
          this.#reconnectAttempts++;
          this.connect(this.#baseUrl);
        }, delay);
      }
    };

    // Register all handlers
    for (const [eventType, handler] of this.#handlers) {
      this.#eventSource.addEventListener(eventType, (event: Event) => {
        const data = JSON.parse((event as MessageEvent).data);
        handler(data);
      });
    }

    // Built-in connected handler
    this.#eventSource.addEventListener('connected', (event: Event) => {
      const data = JSON.parse((event as MessageEvent).data);
      console.log('[SSE] Client connected:', data.clientId);
    });
  }

  /** Disconnect from SSE */
  disconnect(): void {
    if (this.#reconnectTimeout) {
      clearTimeout(this.#reconnectTimeout);
      this.#reconnectTimeout = null;
    }

    if (this.#eventSource) {
      this.#eventSource.close();
      this.#eventSource = null;
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
