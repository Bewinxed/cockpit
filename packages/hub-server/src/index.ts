import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import { getDb } from '@cockpit/db';

import {
  createInstanceRoutes,
  createProjectRoutes,
  createAgentRoutes,
  createWebsocketRoutes,
  createEventRoutes,
  createInstanceEventRoutes,
} from './api';
import {
  getAgentRegistry,
  getBroadcastService,
  resetAgentRegistry,
  resetBroadcastService,
} from './services';
import { HubDiscovery } from './discovery';

/**
 * Hub server configuration options
 */
export interface HubOptions {
  /** Port to listen on */
  port: number;
  /** Path to SQLite database file */
  dbPath: string;
  /** Tailscale IP for mDNS advertisement */
  tailscaleIp?: string;
  /** Enable mDNS discovery advertisement */
  enableDiscovery?: boolean;
  /** CORS origins to allow (default: all) */
  corsOrigins?: string | string[] | boolean;
  /** Request timeout for agent communication (ms) */
  requestTimeout?: number;
}

/**
 * Create the hub server without starting it
 */
export function createHubServer(options: HubOptions) {
  const {
    dbPath,
    corsOrigins = true,
    requestTimeout = 30000,
  } = options;

  // Initialize database
  const db = getDb(dbPath);

  // Initialize services
  getAgentRegistry({ requestTimeout });
  getBroadcastService();

  // Create Elysia app
  const app = new Elysia()
    // CORS middleware
    .use(cors({
      origin: corsOrigins,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      credentials: true,
    }))

    // Health check endpoint
    .get('/health', () => ({
      status: 'ok',
      timestamp: Date.now(),
      version: '1.0.0',
    }))

    // API info endpoint
    .get('/api', () => ({
      name: 'Cockpit Hub',
      version: '1.0.0',
      endpoints: {
        instances: '/instances',
        projects: '/projects',
        agents: '/agents',
        events: '/events',
        websocket: '/ws/hub',
      },
    }))

    // Mount API routes
    .use(createInstanceRoutes(db))
    .use(createProjectRoutes(db))
    .use(createAgentRoutes(db))
    .use(createWebsocketRoutes(db))
    .use(createEventRoutes())
    .use(createInstanceEventRoutes())

    // Global error handler
    .onError(({ code, error, set }) => {
      console.error(`[Hub] Error (${code}):`, error);

      if (code === 'NOT_FOUND') {
        set.status = 404;
        return {
          success: false,
          error: 'Not found',
        };
      }

      if (code === 'VALIDATION') {
        set.status = 400;
        return {
          success: false,
          error: 'Validation error',
          details: error.message,
        };
      }

      set.status = 500;
      return {
        success: false,
        error: 'Internal server error',
      };
    });

  return app;
}

/**
 * Start the hub server
 */
export async function startHub(options: HubOptions) {
  const {
    port,
    tailscaleIp,
    enableDiscovery = true,
  } = options;

  // Create the server
  const app = createHubServer(options);

  // Start mDNS discovery advertisement
  let discovery: HubDiscovery | null = null;
  if (enableDiscovery) {
    discovery = new HubDiscovery();

    // Get Tailscale IP if not provided
    let tsIp = tailscaleIp;
    if (!tsIp) {
      try {
        const { exec } = await import('node:child_process');
        const { promisify } = await import('node:util');
        const execAsync = promisify(exec);
        const { stdout } = await execAsync('tailscale ip -4 2>/dev/null');
        tsIp = stdout.trim();
      } catch {
        // Tailscale not available
      }
    }

    discovery.advertise(port, tsIp);
  }

  // Start the server
  app.listen(port);

  console.log(`
========================================
       Cockpit Hub Server
========================================
  Port:     ${port}
  Database: ${options.dbPath}
  Discovery: ${enableDiscovery ? 'enabled' : 'disabled'}
  ${tailscaleIp ? `Tailscale: ${tailscaleIp}` : ''}
----------------------------------------
  API:      http://localhost:${port}/api
  Health:   http://localhost:${port}/health
  WebSocket: ws://localhost:${port}/ws/hub
  Events:   http://localhost:${port}/events
========================================
`);

  // Return server and cleanup function
  return {
    app,
    discovery,
    stop: () => {
      console.log('[Hub] Shutting down...');

      if (discovery) {
        discovery.stop();
      }

      resetAgentRegistry();
      resetBroadcastService();

      app.stop();
    },
  };
}

/**
 * CLI entry point
 */
async function main() {
  const port = parseInt(process.env.HUB_PORT || '3456', 10);
  const dbPath = process.env.HUB_DB_PATH || './cockpit.db';
  const enableDiscovery = process.env.HUB_DISCOVERY !== 'false';

  const hub = await startHub({
    port,
    dbPath,
    enableDiscovery,
  });

  // Handle shutdown signals
  const shutdown = () => {
    hub.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// Run if executed directly
if (import.meta.main) {
  main().catch((error) => {
    console.error('[Hub] Fatal error:', error);
    process.exit(1);
  });
}

// Export everything
export * from './services';
export * from './api';
export { HubDiscovery, HubBrowser, createHubDiscovery, createHubBrowser } from './discovery';
export type { DiscoveredHub } from './discovery';
