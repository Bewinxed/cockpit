/**
 * The dashboard's PRODUCTION server.
 *
 * `adapter-node`'s own `build/index.js` serves the app and nothing else, and the
 * app is not the whole story: the browser opens `/ws/dashboard` against the
 * origin that served it, expecting that origin to carry the socket through to
 * the hub. In dev that was `hubWsProxy()` in vite.config.ts — a dev-server
 * plugin, which is exactly why it stopped existing the moment the units began
 * running the build. REST kept working (it is a real SvelteKit route,
 * `routes/api/[...path]`), so the board still loaded while never once
 * connecting: "no hub connected", against a hub that was up the whole time.
 *
 * The relay is done on the RAW SOCKET rather than through `http.request`. It
 * was written that way for bun 1.3.14, which could neither emit `'upgrade'` on
 * an outgoing request nor relay bytes back through an upgraded server socket
 * (oven-sh/bun#9911, #9882, #28396) — 1.4.0 fixes both, and this stayed because
 * after the handshake a websocket proxy is only bytes in both directions
 * anyway: the request line and headers are re-issued verbatim over a plain TCP
 * connection and the hub's own 101 passes straight back. Nothing here has to
 * agree with a runtime about what an upgrade is.
 */
import http from 'node:http';
import net from 'node:net';
import { handler } from './build/handler.js';

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '0.0.0.0';
const target = new URL(process.env.WHIFFLE_HUB_URL || 'http://localhost:3456');
const targetPort = Number(target.port || 80);

const server = http.createServer(handler);

server.on('upgrade', (req, socket, head) => {
  // `http.Server` drops a socket's error handling the moment it emits
  // `upgrade`, so an upgrade nobody claims is left with no `error` listener and
  // the eventual reset becomes a process-level throw — taking the server, and
  // every other dashboard socket, down with it.
  socket.on('error', (error) => {
    console.warn(`[whiffle] websocket socket error on ${req.url}: ${error.code ?? error.message}`);
  });
  if (!req.url?.startsWith('/ws')) return socket.destroy();

  const upstream = net.connect(targetPort, target.hostname, () => {
    const lines = [`${req.method} ${req.url} HTTP/1.1`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      // The hub is the one being addressed now, so it gets its own Host; every
      // other header (the websocket key above all) is the browser's and is
      // forwarded untouched, because the hub's 101 is computed from it.
      if (req.rawHeaders[i].toLowerCase() === 'host') continue;
      lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
    }
    lines.push(`Host: ${target.host}`);
    upstream.write(`${lines.join('\r\n')}\r\n\r\n`);
    if (head?.length) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });

  upstream.on('error', (error) => {
    console.warn(
      `[whiffle] hub ws proxy could not reach ${target.host}: ${error.code ?? error.message}`
    );
    socket.destroy();
  });
  socket.on('close', () => upstream.destroy());
  upstream.on('close', () => socket.destroy());
});

server.listen(PORT, HOST, () => {
  console.log(`dashboard on http://${HOST}:${PORT} — /ws -> ${target.origin}`);
});
