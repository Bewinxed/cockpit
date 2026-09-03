import { readEnv, WHIFFLE_ENV } from "@whiffle/core";
import type { RequestHandler } from "./$types";

/**
 * The hub's HTTP origin, derived from WHIFFLE_HUB_URL. That variable is a
 * WebSocket URL (e.g. `ws://localhost:3456/ws`) — the same one the agent and
 * the browser socket use — so the REST base is it with the scheme mapped to
 * http(s) and the trailing `/ws` path dropped. Without this the api route did
 * `fetch("ws://…/ws/api/agents")`, which fetch cannot dial (ws scheme), and
 * every load returned "Failed to connect to hub server".
 */
const HUB_URL = (() => {
  const raw = readEnv(WHIFFLE_ENV.hubUrl) || "http://localhost:3456";
  const http = raw.replace(/^ws(s?):\/\//, "http$1://").replace(/\/ws\/?$/, "");
  return http.replace(/\/+$/, "");
})();

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
        "Content-Type": "application/json",
        // Forward relevant headers
        ...(request.headers.get("authorization") && {
          Authorization: request.headers.get("authorization")!,
        }),
      },
      body:
        request.method !== "GET" && request.method !== "HEAD"
          ? await request.text()
          : undefined,
    });

    // Forward the response
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: {
        "Content-Type":
          response.headers.get("Content-Type") || "application/json",
      },
    });
  } catch (error) {
    console.error(`[Proxy] Error forwarding to ${targetUrl}:`, error);
    return new Response(
      JSON.stringify({
        success: false,
        error: "Failed to connect to hub server",
      }),
      {
        status: 502,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}

export const GET: RequestHandler = async ({ request, params }) =>
  proxyToHub(request, params.path);

export const POST: RequestHandler = async ({ request, params }) =>
  proxyToHub(request, params.path);

export const PUT: RequestHandler = async ({ request, params }) =>
  proxyToHub(request, params.path);

export const PATCH: RequestHandler = async ({ request, params }) =>
  proxyToHub(request, params.path);

export const DELETE: RequestHandler = async ({ request, params }) =>
  proxyToHub(request, params.path);
