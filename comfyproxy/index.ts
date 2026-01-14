import type { ServerWebSocket } from "bun";

const TARGET = "https://comfy.bewinxed.com";
const WS_TARGET = "wss://comfy.bewinxed.com";
const PORT = 8188;

interface WsData {
  path: string;
  search: string;
}

// Track active WebSocket connections (using a symbol key for Bun's ServerWebSocket)
const wsConnections = new Map<ServerWebSocket<WsData>, WebSocket>();

Bun.serve<WsData>({
  port: PORT,

  async fetch(req, server) {
    const url = new URL(req.url);
    const targetUrl = `${TARGET}${url.pathname}${url.search}`;

    // Handle WebSocket upgrade
    if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
      const success = server.upgrade(req, {
        data: {
          path: url.pathname,
          search: url.search,
        },
      });

      if (success) {
        return undefined;
      }
      return new Response("WebSocket upgrade failed", { status: 500 });
    }

    // Proxy regular HTTP requests
    const headers = new Headers();

    // Copy relevant headers, but skip compression to get raw response
    for (const [key, value] of req.headers) {
      const lower = key.toLowerCase();
      if (
        lower !== "host" &&
        lower !== "connection" &&
        lower !== "upgrade" &&
        lower !== "accept-encoding" // Don't request compressed content
      ) {
        headers.set(key, value);
      }
    }
    headers.set("Host", new URL(TARGET).host);
    // Request uncompressed content so we can proxy it cleanly
    headers.set("Accept-Encoding", "identity");

    try {
      const response = await fetch(targetUrl, {
        method: req.method,
        headers,
        body: req.method !== "GET" && req.method !== "HEAD" ? req.body : undefined,
        redirect: "manual",
      });

      // Clone response headers and add CORS
      const responseHeaders = new Headers();
      for (const [key, value] of response.headers) {
        const lower = key.toLowerCase();
        // Skip encoding headers since we requested uncompressed
        if (lower !== "content-encoding" && lower !== "transfer-encoding") {
          responseHeaders.set(key, value);
        }
      }
      responseHeaders.set("Access-Control-Allow-Origin", "*");
      responseHeaders.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
      responseHeaders.set("Access-Control-Allow-Headers", "*");
      responseHeaders.set("Access-Control-Expose-Headers", "*");

      // Handle OPTIONS preflight
      if (req.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: responseHeaders,
        });
      }

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      });
    } catch (error) {
      console.error("Proxy error:", error);
      return new Response(`Proxy error: ${error}`, { status: 502 });
    }
  },

  websocket: {
    open(clientWs) {
      const data = clientWs.data;
      const wsUrl = `${WS_TARGET}${data.path}${data.search}`;

      console.log(`🔌 WebSocket connecting to: ${wsUrl}`);

      const targetWs = new WebSocket(wsUrl);

      // Store the connection mapping
      wsConnections.set(clientWs, targetWs);

      targetWs.onopen = () => {
        console.log(`✅ WebSocket connected to target`);
      };

      targetWs.onmessage = (event) => {
        try {
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(event.data);
          }
        } catch (e) {
          console.error("Error forwarding message to client:", e);
        }
      };

      targetWs.onerror = (error) => {
        console.error("Target WebSocket error:", error);
      };

      targetWs.onclose = (event) => {
        console.log(`🔌 Target WebSocket closed: ${event.code} ${event.reason}`);
        wsConnections.delete(clientWs);
        try {
          clientWs.close(event.code, event.reason);
        } catch (e) {
          // Client might already be closed
        }
      };
    },

    message(clientWs, message) {
      const targetWs = wsConnections.get(clientWs);
      if (targetWs && targetWs.readyState === WebSocket.OPEN) {
        targetWs.send(message);
      }
    },

    close(clientWs, code, reason) {
      console.log(`🔌 Client WebSocket closed: ${code} ${reason}`);
      const targetWs = wsConnections.get(clientWs);
      if (targetWs) {
        targetWs.close(code, reason);
        wsConnections.delete(clientWs);
      }
    },
  },
});

console.log(`🐱 Proxy server running at http://localhost:${PORT}`);
console.log(`   HTTP proxying to: ${TARGET}`);
console.log(`   WebSocket proxying to: ${WS_TARGET}`);