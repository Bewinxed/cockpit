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
      ({ query }) => {
        // Parse subscriptions from query parameter
        const subscriptions = query.subscribe
          ? query.subscribe.split(',').map((s) => s.trim())
          : undefined;

        // Track client ID for cleanup
        let clientId: string | null = null;

        // Create a readable stream for SSE with string type
        const stream = new ReadableStream<string>({
          start(controller) {
            // Register client with broadcast service
            const client = broadcast.addClient(controller, subscriptions);
            clientId = client.id;

            console.log(`[SSE] Client connected: ${client.id}`);
          },
          cancel() {
            // Mark client as closed to prevent writes to closed controller
            if (clientId) {
              broadcast.markClosed(clientId);
              console.log(`[SSE] Client disconnected: ${clientId}`);
            }
          },
        });

        // Return as Response with explicit SSE headers
        // Use TextEncoderStream to convert strings to bytes
        const encoder = new TextEncoderStream();
        stream.pipeTo(encoder.writable).catch(() => {
          // Silently handle stream close errors
        });

        return new Response(encoder.readable, {
          headers: {
            'content-type': 'text/event-stream',
            'cache-control': 'no-cache',
            'connection': 'keep-alive',
            'access-control-allow-origin': '*',
            'x-accel-buffering': 'no',
          },
        });
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
      ({ params }) => {
        const instanceId = params.id;
        let clientId: string | null = null;

        // Create a filtered stream for this instance with string type
        const stream = new ReadableStream<string>({
          start(controller) {
            // Register client with instance-specific subscriptions
            const client = broadcast.addClient(controller, [
              `instance:${instanceId}:*`,
              'instance:message',
              'instance:updated',
              'instance:stopped',
              'instance:error',
            ]);
            clientId = client.id;

            console.log(`[SSE] Instance stream connected: ${instanceId} (client: ${client.id})`);
          },
          cancel() {
            if (clientId) {
              broadcast.markClosed(clientId);
              console.log(`[SSE] Instance stream disconnected: ${instanceId} (client: ${clientId})`);
            }
          },
        });

        // Return as Response with explicit SSE headers
        // Use TextEncoderStream to convert strings to bytes
        const encoder = new TextEncoderStream();
        stream.pipeTo(encoder.writable).catch(() => {
          // Silently handle stream close errors
        });

        return new Response(encoder.readable, {
          headers: {
            'content-type': 'text/event-stream',
            'cache-control': 'no-cache',
            'connection': 'keep-alive',
            'access-control-allow-origin': '*',
            'x-accel-buffering': 'no',
          },
        });
      },
      {
        params: t.Object({
          id: t.String(),
        }),
      }
    );
}
