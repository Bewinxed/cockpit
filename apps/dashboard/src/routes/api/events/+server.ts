import type { RequestHandler } from './$types';

const HUB_URL = process.env.HUB_URL || 'http://localhost:3456';

/**
 * Proxy SSE events from the hub server
 */
export const GET: RequestHandler = async ({ request }) => {
  const targetUrl = `${HUB_URL}/api/events`;

  try {
    const response = await fetch(targetUrl, {
      headers: {
        'Accept': 'text/event-stream',
        'Cache-Control': 'no-cache',
      },
    });

    if (!response.ok || !response.body) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Failed to connect to hub events',
      }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Stream the SSE response directly
    return new Response(response.body, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    console.error('[Proxy] Error connecting to hub events:', error);
    return new Response(JSON.stringify({
      success: false,
      error: 'Failed to connect to hub server',
    }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
