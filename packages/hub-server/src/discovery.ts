import Bonjour, { type Service } from 'bonjour-service';

/**
 * Hub discovery service using mDNS (Bonjour)
 * Allows agents to discover the hub on the local network
 */
export class HubDiscovery {
  private bonjour: Bonjour | null = null;
  private service: Service | null = null;
  private isAdvertising = false;

  /**
   * Start advertising the hub via mDNS
   */
  advertise(port: number, tailscaleIp?: string): void {
    if (this.isAdvertising) {
      console.log('[Discovery] Already advertising');
      return;
    }

    try {
      this.bonjour = new Bonjour();

      // Advertise the hub service
      this.service = this.bonjour.publish({
        name: 'cockpit-hub',
        type: 'cockpit-hub',
        port,
        txt: {
          version: '1.0.0',
          protocol: 'json-rpc',
          tailscaleIp: tailscaleIp || '',
        },
      });

      this.isAdvertising = true;
      console.log(`[Discovery] Advertising hub on port ${port}`);

      if (tailscaleIp) {
        console.log(`[Discovery] Tailscale IP: ${tailscaleIp}`);
      }
    } catch (error) {
      console.error('[Discovery] Failed to start mDNS advertising:', error);
    }
  }

  /**
   * Stop advertising
   */
  stop(): void {
    if (!this.isAdvertising) {
      return;
    }

    try {
      if (this.service) {
        this.service.stop();
        this.service = null;
      }

      if (this.bonjour) {
        this.bonjour.destroy();
        this.bonjour = null;
      }

      this.isAdvertising = false;
      console.log('[Discovery] Stopped advertising');
    } catch (error) {
      console.error('[Discovery] Error stopping mDNS:', error);
    }
  }

  /**
   * Check if currently advertising
   */
  get advertising(): boolean {
    return this.isAdvertising;
  }
}

/**
 * Hub discovery browser for agents to find the hub
 */
export class HubBrowser {
  private bonjour: Bonjour | null = null;
  private browser: ReturnType<Bonjour['find']> | null = null;

  /**
   * Search for hub on the network
   */
  find(options: {
    timeout?: number;
    onFound?: (hub: DiscoveredHub) => void;
  } = {}): Promise<DiscoveredHub | null> {
    const { timeout = 5000, onFound } = options;

    return new Promise((resolve) => {
      this.bonjour = new Bonjour();

      let foundHub: DiscoveredHub | null = null;
      let resolved = false;

      this.browser = this.bonjour.find({ type: 'cockpit-hub' }, (service) => {
        const hub: DiscoveredHub = {
          name: service.name,
          host: service.host,
          port: service.port,
          addresses: service.addresses || [],
          txt: {
            version: service.txt?.version as string | undefined,
            protocol: service.txt?.protocol as string | undefined,
            tailscaleIp: service.txt?.tailscaleIp as string | undefined,
          },
        };

        console.log(`[Discovery] Found hub: ${hub.name} at ${hub.host}:${hub.port}`);

        if (onFound) {
          onFound(hub);
        }

        if (!foundHub) {
          foundHub = hub;
        }
      });

      // Timeout after specified duration
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          this.stop();
          resolve(foundHub);
        }
      }, timeout);
    });
  }

  /**
   * Stop browsing
   */
  stop(): void {
    if (this.browser) {
      this.browser.stop();
      this.browser = null;
    }

    if (this.bonjour) {
      this.bonjour.destroy();
      this.bonjour = null;
    }
  }
}

/**
 * Discovered hub information
 */
export interface DiscoveredHub {
  name: string;
  host: string;
  port: number;
  addresses: string[];
  txt: {
    version?: string;
    protocol?: string;
    tailscaleIp?: string;
  };
}

// Factory functions
export function createHubDiscovery(): HubDiscovery {
  return new HubDiscovery();
}

export function createHubBrowser(): HubBrowser {
  return new HubBrowser();
}
