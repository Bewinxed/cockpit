import Bonjour, { type Service as BonjourService, type Browser } from 'bonjour-service';
import { EventEmitter } from 'events';

/**
 * Service type for Cockpit mDNS discovery
 */
export const COCKPIT_SERVICE_TYPE = 'cockpit-hub';

/**
 * Default port for Cockpit hub
 */
export const COCKPIT_DEFAULT_PORT = 3847;

/**
 * Represents a discovered Cockpit service
 */
export interface CockpitService {
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

/**
 * Events emitted by DiscoveryService
 */
export interface DiscoveryEvents {
  /** A new service was discovered */
  serviceUp: (service: CockpitService) => void;
  /** A service went offline */
  serviceDown: (service: CockpitService) => void;
  /** An error occurred */
  error: (error: Error) => void;
}

/**
 * Options for DiscoveryService
 */
export interface DiscoveryOptions {
  /** Service type to use (default: cockpit-hub) */
  serviceType?: string;
  /** Port to advertise on (default: 3847) */
  port?: number;
}

/**
 * mDNS discovery service for finding Cockpit hubs and agents
 */
export class DiscoveryService extends EventEmitter {
  private bonjour: Bonjour;
  private browser: Browser | null = null;
  private publishedService: BonjourService | null = null;
  private readonly serviceType: string;
  private readonly port: number;
  private discovered: Map<string, CockpitService> = new Map();

  constructor(options: DiscoveryOptions = {}) {
    super();
    this.bonjour = new Bonjour();
    this.serviceType = options.serviceType || COCKPIT_SERVICE_TYPE;
    this.port = options.port || COCKPIT_DEFAULT_PORT;
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
      const cockpitService = this.parseService(service);
      if (cockpitService) {
        this.discovered.set(cockpitService.name, cockpitService);
        this.emit('serviceUp', cockpitService);
      }
    });

    this.browser.on('down', (service: BonjourService) => {
      const cockpitService = this.parseService(service);
      if (cockpitService) {
        this.discovered.delete(cockpitService.name);
        this.emit('serviceDown', cockpitService);
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
  getDiscoveredServices(): CockpitService[] {
    return Array.from(this.discovered.values());
  }

  /**
   * Get discovered hubs only
   */
  getDiscoveredHubs(): CockpitService[] {
    return this.getDiscoveredServices().filter((s) => s.type === 'hub');
  }

  /**
   * Get discovered agents only
   */
  getDiscoveredAgents(): CockpitService[] {
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
   * Parse a Bonjour service into a CockpitService
   */
  private parseService(service: BonjourService): CockpitService | null {
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
export async function discoverHub(timeout = 5000): Promise<CockpitService | null> {
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
export async function discoverAll(timeout = 3000): Promise<CockpitService[]> {
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
