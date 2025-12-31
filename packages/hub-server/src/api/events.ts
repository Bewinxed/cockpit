import { Elysia, t } from 'elysia';
import { getBroadcastService } from '../services/broadcast';

/**
 * SSE routes for dashboard real-time updates
 */
export function createEventRoutes() {
  const broadcast = getBroadcastService();

  return new Elysia({ prefix: '/events' })
    // Main SSE endpoint for dashboard
    .get(
      '/',
      ({ set, query }) => {
        set.headers['content-type'] = 'text/event-stream';
        set.headers['cache-control'] = 'no-cache';
        set.headers['connection'] = 'keep-alive';
        set.headers['access-control-allow-origin'] = '*';

        // Parse subscriptions from query parameter
        const subscriptions = query.subscribe
          ? query.subscribe.split(',').map((s) => s.trim())
          : undefined;

        // Create a readable stream for SSE
        const stream = new ReadableStream({
          start(controller) {
            // Register client with broadcast service
            const client = broadcast.addClient(controller, subscriptions);

            console.log(`[SSE] Client connected: ${client.id}`);
          },
          cancel() {
            // Client disconnected - handled by broadcast service
            console.log('[SSE] Client disconnected');
          },
        });

        return stream;
      },
      {
        query: t.Object({
          subscribe: t.Optional(t.String()),
        }),
      }
    )

    // Health check endpoint
    .get('/health', () => ({
      success: true,
      clients: broadcast.clientCount,
      timestamp: Date.now(),
    }))

    // Get current client count
    .get('/clients', () => ({
      success: true,
      count: broadcast.clientCount,
    }));
}

/**
 * Instance-specific SSE endpoint
 */
export function createInstanceEventRoutes() {
  const broadcast = getBroadcastService();

  return new Elysia({ prefix: '/instances/:id/events' })
    .get(
      '/',
      ({ set, params }) => {
        set.headers['content-type'] = 'text/event-stream';
        set.headers['cache-control'] = 'no-cache';
        set.headers['connection'] = 'keep-alive';
        set.headers['access-control-allow-origin'] = '*';

        const instanceId = params.id;

        // Create a filtered stream for this instance
        const stream = new ReadableStream({
          start(controller) {
            // Register client with instance-specific subscriptions
            const client = broadcast.addClient(controller, [
              `instance:${instanceId}:*`,
              'instance:message',
              'instance:updated',
              'instance:stopped',
              'instance:error',
            ]);

            console.log(`[SSE] Instance stream connected: ${instanceId} (client: ${client.id})`);
          },
          cancel() {
            console.log(`[SSE] Instance stream disconnected: ${instanceId}`);
          },
        });

        return stream;
      },
      {
        params: t.Object({
          id: t.String(),
        }),
      }
    );
}
