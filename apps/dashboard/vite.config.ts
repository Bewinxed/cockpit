import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import Icons from 'unplugin-icons/vite';
import { defineConfig, type Plugin } from 'vite';
import path from "path";

/**
 * Keeps a stray WebSocket upgrade from killing the dev server.
 *
 * `http.Server` stops owning a socket the moment it emits `upgrade`: its own
 * error handling comes off, and whoever claims the socket is expected to take
 * over. Vite's two listeners both claim narrowly — HMR wants the `vite-hmr` or
 * `vite-ping` protocol on the HMR path, the proxy wants a `/ws` path — and each
 * simply returns when a request is not its own. An upgrade neither recognises
 * is left with no owner and no `error` listener, so the reset that eventually
 * comes is an unhandled `error` event, which in Node is a process-level throw.
 *
 * The dev server then exits, every dashboard's socket dies with it, and the
 * hub — which never went anywhere — reads as down until systemd restarts it.
 * Listening for the reset is the whole fix.
 */
const surviveStraySockets = (): Plugin => ({
  name: 'cockpit:survive-stray-sockets',
  configureServer(server) {
    server.httpServer?.on('upgrade', (req, socket) => {
      socket.on('error', (error: NodeJS.ErrnoException) => {
        server.config.logger.warn(
          `[cockpit] websocket socket error on ${req.url}: ${error.code ?? error.message}`,
          { timestamp: true }
        );
      });
    });
  },
});

export default defineConfig({
  plugins: [surviveStraySockets(), tailwindcss(), sveltekit(), Icons({ compiler: 'svelte' })],
  server: {
    port: 3000,
    host: true,
    // The dashboard is reached from the other machines on the tailnet, by name.
    // Vite refuses an unknown Host header with a 403, so the tailnet suffix is
    // named here; `.ts.net` covers this tailnet's MagicDNS names without
    // pinning the machine's own hostname into the repo.
    allowedHosts: ['.ts.net', 'localhost'],
    proxy: {
      // Proxy WebSocket connections to the hub server
      '/ws': {
        target: process.env.COCKPIT_HUB_URL || 'http://localhost:3456',
        ws: true,
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: {
      $lib: path.resolve("./src/lib"),
    },
  },
  optimizeDeps: {
    exclude: ['@xyflow/svelte'],
  },
  ssr: {
    // Both ship raw .svelte sources; dev SSR must compile them, not require them.
    // These publish raw .svelte sources, which dev SSR must compile rather
    // than hand to Node — externalizing any of them ends in
    // ERR_UNKNOWN_FILE_EXTENSION on the first server-rendered request.
    noExternal: ['@xyflow/svelte', 'virtua', '@hugeicons/svelte'],
  },
});
