import Bonjour, { type Service as BonjourService, type Browser } from 'bonjour-service';
import { EventEmitter } from 'events';

/**
 * Service type for AgentDeck mDNS discovery
 */
export const AGENTDECK_SERVICE_TYPE = 'agentdeck-hub';

/**
 * Default port for AgentDeck hub
 */
export const AGENTDECK_DEFAULT_PORT = 3847;

// Backing exports for legacy cockpit naming (used by current core utils index)
export const COCKPIT_SERVICE_TYPE = AGENTDECK_SERVICE_TYPE;
export const COCKPIT_DEFAULT_PORT = AGENTDECK_DEFAULT_PORT;

/**
 * Represents a discovered AgentDeck service
 */
export interface AgentDeckService {
  /** Service name (usually hostname) */
  name: string;
  /** Host address */
  host: string;
  /** Port number */
  port: number;
  /** IP addresses */
  addresses: string[];
  /** Service metadata */
  txt: Record<string, string>;
  /** Whether this is a hub or agent */
  type: 'hub' | 'agent';
  /** Version of the service */
  version?: string;
}

export type CockpitService = AgentDeckService;

/**
 * Events emitted by DiscoveryService
 */
export interface DiscoveryEvents {
  /** A new service was discovered */
  serviceUp: (service: AgentDeckService) => void;
  /** A service went offline */
  serviceDown: (service: AgentDeckService) => void;
  /** An error occurred */
  error: (error: Error) => void;
}

/**
 * Options for DiscoveryService
 */
export interface DiscoveryOptions {
  /** Service type to use (default: agentdeck-hub) */
  serviceType?: string;
  /** Port to advertise on (default: 3847) */
  port?: number;
}

/**
 * mDNS discovery service for finding AgentDeck hubs and agents
 */
export class DiscoveryService extends EventEmitter {
  private bonjour: Bonjour;
  private browser: Browser | null = null;
  private publishedService: BonjourService | null = null;
  private readonly serviceType: string;
  private readonly port: number;
  private discovered: Map<string, AgentDeckService> = new Map();

  constructor(options: DiscoveryOptions = {}) {
    super();
    this.bonjour = new Bonjour();
    this.serviceType = options.serviceType || AGENTDECK_SERVICE_TYPE;
    this.port = options.port || AGENTDECK_DEFAULT_PORT;
  }

  /**
   * Advertise this service on the network
   * @param name - Service name (usually hostname)
   * @param type - Whether this is a hub or agent
   * @param metadata - Additional metadata to advertise
   */
  advertise(
    name: string,
    type: 'hub' | 'agent',
    metadata: Record<string, string> = {}
  ): void {
    if (this.publishedService) {
      this.unpublish();
    }

    const txt = {
      type,
      version: metadata.version || '1.0.0',
      ...metadata,
    };

    this.publishedService = this.bonjour.publish({
      name,
      type: this.serviceType,
      port: this.port,
      txt,
    });
  }

  /**
   * Stop advertising this service
   */
  unpublish(): void {
    if (this.publishedService) {
      if (typeof this.publishedService.stop === 'function') {
        this.publishedService.stop();
      }
      this.publishedService = null;
    }
  }

  /**
   * Start browsing for services on the network
   */
  browse(): void {
    if (this.browser) {
      return;
    }

    this.browser = this.bonjour.find({ type: this.serviceType });

    this.browser.on('up', (service: BonjourService) => {
      const agentdeckService = this.parseService(service);
      if (agentdeckService) {
        this.discovered.set(agentdeckService.name, agentdeckService);
        this.emit('serviceUp', agentdeckService);
      }
    });

    this.browser.on('down', (service: BonjourService) => {
      const agentdeckService = this.parseService(service);
      if (agentdeckService) {
        this.discovered.delete(agentdeckService.name);
        this.emit('serviceDown', agentdeckService);
      }
    });
  }

  /**
   * Stop browsing for services
   */
  stopBrowsing(): void {
    if (this.browser) {
      this.browser.stop();
      this.browser = null;
    }
  }

  /**
   * Get all currently discovered services
   */
  getDiscoveredServices(): AgentDeckService[] {
    return Array.from(this.discovered.values());
  }

  /**
   * Get discovered hubs only
   */
  getDiscoveredHubs(): AgentDeckService[] {
    return this.getDiscoveredServices().filter((s) => s.type === 'hub');
  }

  /**
   * Get discovered agents only
   */
  getDiscoveredAgents(): AgentDeckService[] {
    return this.getDiscoveredServices().filter((s) => s.type === 'agent');
  }

  /**
   * Clean up all resources
   */
  destroy(): void {
    this.stopBrowsing();
    this.unpublish();
    this.bonjour.destroy();
    this.discovered.clear();
    this.removeAllListeners();
  }

  /**
   * Parse a Bonjour service into an AgentDeckService
   */
  private parseService(service: BonjourService): AgentDeckService | null {
    try {
      const txt = (service.txt || {}) as Record<string, string>;
      const type = txt.type as 'hub' | 'agent';

      if (!type || (type !== 'hub' && type !== 'agent')) {
        return null;
      }

      return {
        name: service.name,
        host: service.host,
        port: service.port,
        addresses: service.addresses || [],
        txt,
        type,
        version: txt.version,
      };
    } catch {
      return null;
    }
  }
}

/**
 * Create a one-shot discovery that returns the first hub found
 * @param timeout - Maximum time to wait in milliseconds (default: 5000)
 * @returns The first discovered hub, or null if timeout
 */
export async function discoverHub(timeout = 5000): Promise<AgentDeckService | null> {
  return new Promise((resolve) => {
    const discovery = new DiscoveryService();
    let resolved = false;

    const cleanup = () => {
      if (!resolved) {
        resolved = true;
        discovery.destroy();
      }
    };

    const timeoutId = setTimeout(() => {
      cleanup();
      resolve(null);
    }, timeout);

    discovery.on('serviceUp', (service) => {
      if (service.type === 'hub' && !resolved) {
        clearTimeout(timeoutId);
        cleanup();
        resolve(service);
      }
    });

    discovery.browse();
  });
}

/**
 * Discover all services within a timeout period
 * @param timeout - Maximum time to wait in milliseconds (default: 3000)
 * @returns All discovered services
 */
export async function discoverAll(timeout = 3000): Promise<AgentDeckService[]> {
  return new Promise((resolve) => {
    const discovery = new DiscoveryService();

    setTimeout(() => {
      const services = discovery.getDiscoveredServices();
      discovery.destroy();
      resolve(services);
    }, timeout);

    discovery.browse();
  });
}
