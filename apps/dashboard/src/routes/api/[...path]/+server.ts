import type { RequestHandler } from './$types';

const HUB_URL = process.env.COCKPIT_HUB_URL || 'http://localhost:3456';

/**
 * Proxy all API requests to the hub server
 */
async function proxyToHub(request: Request, path: string): Promise<Response> {
  const url = new URL(request.url);
  const targetUrl = `${HUB_URL}/api/${path}${url.search}`;

  try {
    const response = await fetch(targetUrl, {
      method: request.method,
      headers: {
        'Content-Type': 'application/json',
        // Forward relevant headers
        ...(request.headers.get('authorization') && {
          'Authorization': request.headers.get('authorization')!
        }),
      },
      body: request.method !== 'GET' && request.method !== 'HEAD'
        ? await request.text()
        : undefined,
    });

    // Forward the response
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: {
        'Content-Type': response.headers.get('Content-Type') || 'application/json',
      },
    });
  } catch (error) {
    console.error(`[Proxy] Error forwarding to ${targetUrl}:`, error);
    return new Response(JSON.stringify({
      success: false,
      error: 'Failed to connect to hub server',
    }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

export const GET: RequestHandler = async ({ request, params }) => {
  return proxyToHub(request, params.path);
};

export const POST: RequestHandler = async ({ request, params }) => {
  return proxyToHub(request, params.path);
};

export const PUT: RequestHandler = async ({ request, params }) => {
  return proxyToHub(request, params.path);
};

export const PATCH: RequestHandler = async ({ request, params }) => {
  return proxyToHub(request, params.path);
};

export const DELETE: RequestHandler = async ({ request, params }) => {
  return proxyToHub(request, params.path);
};
