import Bonjour, { type Service, type Browser } from 'bonjour-service';
import { EventEmitter } from 'events';

export interface HubService {
  name: string;
  host: string;
  port: number;
  addresses?: string[];
  txt?: Record<string, string>;
}

export interface AgentDiscoveryOptions {
  /** Service type to search for */
  serviceType?: string;
  /** Browse timeout in milliseconds */
  browseTimeout?: number;
}

export interface AgentDiscoveryEvents {
  'hub.found': (service: HubService) => void;
  'hub.lost': (service: HubService) => void;
  error: (error: Error) => void;
}

/**
 * mDNS discovery to find the Cockpit hub on the local network
 */
export class AgentDiscovery extends EventEmitter {
  private bonjour: Bonjour | null = null;
  private browser: Browser | null = null;
  private publisher: Service | null = null;
  private readonly serviceType: string;
  private readonly browseTimeout: number;
  private discoveredHubs: Map<string, HubService> = new Map();

  constructor(options: AgentDiscoveryOptions = {}) {
    super();
    this.serviceType = options.serviceType ?? '_cockpit-hub._tcp';
    this.browseTimeout = options.browseTimeout ?? 30000;
  }

  /**
   * Initialize Bonjour
   */
  private initBonjour(): void {
    if (!this.bonjour) {
      this.bonjour = new Bonjour();
    }
  }

  /**
   * Browse for the hub and return the first one found
   */
  async browseForHub(): Promise<HubService> {
    this.initBonjour();

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.stopBrowsing();
        reject(new Error('Hub discovery timeout'));
      }, this.browseTimeout);

      this.browser = this.bonjour!.find({ type: this.serviceType });

      this.browser.on('up', (service: Service) => {
        clearTimeout(timeout);

        const hubService: HubService = {
          name: service.name,
          host: service.host,
          port: service.port,
          addresses: service.addresses,
          txt: service.txt as Record<string, string>,
        };

        this.discoveredHubs.set(service.name, hubService);
        this.emit('hub.found', hubService);
        resolve(hubService);
      });

      this.browser.on('down', (service: Service) => {
        const hubService = this.discoveredHubs.get(service.name);
        if (hubService) {
          this.discoveredHubs.delete(service.name);
          this.emit('hub.lost', hubService);
        }
      });

      this.browser.start();
    });
  }

  /**
   * Start continuous browsing for hubs
   */
  startBrowsing(): void {
    this.initBonjour();

    if (this.browser) {
      this.stopBrowsing();
    }

    this.browser = this.bonjour!.find({ type: this.serviceType });

    this.browser.on('up', (service: Service) => {
      const hubService: HubService = {
        name: service.name,
        host: service.host,
        port: service.port,
        addresses: service.addresses,
        txt: service.txt as Record<string, string>,
      };

      this.discoveredHubs.set(service.name, hubService);
      this.emit('hub.found', hubService);
    });

    this.browser.on('down', (service: Service) => {
      const hubService = this.discoveredHubs.get(service.name);
      if (hubService) {
        this.discoveredHubs.delete(service.name);
        this.emit('hub.lost', hubService);
      }
    });

    this.browser.start();
  }

  /**
   * Stop browsing for hubs
   */
  stopBrowsing(): void {
    if (this.browser) {
      this.browser.stop();
      this.browser = null;
    }
  }

  /**
   * Advertise this agent on the network
   */
  advertise(port: number, name?: string, txt?: Record<string, string>): void {
    this.initBonjour();

    if (this.publisher) {
      this.unpublish();
    }

    const serviceName = name ?? `cockpit-agent-${process.pid}`;

    this.publisher = this.bonjour!.publish({
      name: serviceName,
      type: '_cockpit-agent._tcp',
      port,
      txt: {
        ...txt,
        pid: String(process.pid),
        platform: process.platform,
        hostname: require('os').hostname(),
      },
    });
  }

  /**
   * Stop advertising this agent
   */
  unpublish(): void {
    if (this.publisher) {
      // The stop method may not exist on all Service implementations
      if (typeof this.publisher.stop === 'function') {
        this.publisher.stop();
      }
      this.publisher = null;
    }
  }

  /**
   * Get list of discovered hubs
   */
  getDiscoveredHubs(): HubService[] {
    return Array.from(this.discoveredHubs.values());
  }

  /**
   * Stop all discovery activities
   */
  stop(): void {
    this.stopBrowsing();
    this.unpublish();

    if (this.bonjour) {
      this.bonjour.destroy();
      this.bonjour = null;
    }

    this.discoveredHubs.clear();
  }
}

export default AgentDiscovery;
