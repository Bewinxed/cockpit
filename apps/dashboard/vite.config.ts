import http from "node:http";
import path from "node:path";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import Icons from "unplugin-icons/vite";
import { defineConfig, type Plugin } from "vite";

/**
 * Proxies the dashboard's `/ws` upgrade to the hub, by hand.
 *
 * Vite's built-in `server.proxy['/ws'] { ws: true }` stopped upgrading the
 * socket under rolldown-vite — the handshake returns 404/no-101 and the
 * dashboard reads the hub as unreachable even while it is up. Rather than fight
 * the proxy internals, this claims the `/ws` upgrade itself: it opens an Upgrade
 * request to the hub, replays the hub's 101 back to the browser, and pipes the
 * two raw sockets together. HMR (a different path / the `vite-hmr` protocol) is
 * never `/ws`, so returning early leaves it entirely to Vite.
 *
 * Also the whole fix for a stray upgrade killing the dev server: `http.Server`
 * drops a socket's error handling the moment it emits `upgrade`, so an upgrade
 * no listener claims is left with no `error` handler and the eventual reset is a
 * process-level throw. Attaching an error listener to every upgrade socket keeps
 * that reset from taking the server (and every dashboard socket) down with it.
 */
const hubWsProxy = (): Plugin => ({
  name: "whiffle:hub-ws-proxy",
  configureServer(server) {
    const target = new URL(
      process.env.WHIFFLE_HUB_URL || "http://localhost:3456"
    );
    server.httpServer?.on("upgrade", (req, socket, head) => {
      socket.on("error", (error: NodeJS.ErrnoException) => {
        server.config.logger.warn(
          `[whiffle] websocket socket error on ${req.url}: ${error.code ?? error.message}`,
          { timestamp: true }
        );
      });
      // Only /ws is ours; HMR's upgrade is left for Vite to answer.
      if (!req.url?.startsWith("/ws")) {
        return;
      }
      const proxyReq = http.request({
        host: target.hostname,
        port: target.port,
        path: req.url,
        method: req.method,
        headers: req.headers,
      });
      proxyReq.on("upgrade", (proxyRes, proxySocket, proxyHead) => {
        const lines = ["HTTP/1.1 101 Switching Protocols"];
        for (let i = 0; i < proxyRes.rawHeaders.length; i += 2) {
          lines.push(
            `${proxyRes.rawHeaders[i]}: ${proxyRes.rawHeaders[i + 1]}`
          );
        }
        socket.write(`${lines.join("\r\n")}\r\n\r\n`);
        if (proxyHead?.length) {
          socket.write(proxyHead);
        }
        if (head?.length) {
          proxySocket.write(head);
        }
        proxySocket.pipe(socket).pipe(proxySocket);
        proxySocket.on("error", () => socket.destroy());
        socket.on("error", () => proxySocket.destroy());
      });
      proxyReq.on("error", (error: NodeJS.ErrnoException) => {
        server.config.logger.warn(
          `[whiffle] hub ws proxy could not reach ${target.host}: ${error.code ?? error.message}`,
          { timestamp: true }
        );
        socket.destroy();
      });
      proxyReq.end();
    });
  },
});

export default defineConfig({
  plugins: [
    hubWsProxy(),
    tailwindcss(),
    sveltekit(),
    Icons({ compiler: "svelte" }),
  ],
  server: {
    port: 3000,
    host: true,
    // The dashboard is reached from the other machines on the tailnet, by name.
    // Vite refuses an unknown Host header with a 403, so the tailnet suffix is
    // named here; `.ts.net` covers this tailnet's MagicDNS names without
    // pinning the machine's own hostname into the repo.
    allowedHosts: [".ts.net", "localhost"],
    // NOTE: the /ws websocket is proxied by hubWsProxy() above, not here —
    // rolldown-vite's built-in ws proxy fails the 101 upgrade. REST /api is
    // handled by SvelteKit's own route (routes/api/[...path]).
  },
  resolve: {
    alias: {
      $lib: path.resolve("./src/lib"),
    },
  },
  optimizeDeps: {
    exclude: ["@xyflow/svelte"],
  },
  ssr: {
    // Both ship raw .svelte sources; dev SSR must compile them, not require them.
    // These publish raw .svelte sources, which dev SSR must compile rather
    // than hand to Node — externalizing any of them ends in
    // ERR_UNKNOWN_FILE_EXTENSION on the first server-rendered request.
    noExternal: ["@xyflow/svelte", "virtua", "@hugeicons/svelte", "torph"],
  },
});
