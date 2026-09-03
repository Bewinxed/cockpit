/**
 * opencode's server under sessiond (design §4.2), against a REAL sessiond in a
 * REAL separate process.
 *
 * The property under test is process keeping and nothing else: `opencode serve`
 * must be sessiond's child, its announced port must be readable AGENT-SIDE out
 * of the ring (sessiond parses nothing), and the whole agent-side apparatus —
 * socket, client, SSE subscription — must be destructible and rebuildable
 * while that server keeps running. A stubbed sessiond would pass that
 * trivially; only a daemon in another process holding the pipe proves it.
 *
 * SAFETY: the "server" here is a scripted fake that speaks the two things this
 * code path actually reads — the announce line's format and an SSE stream on
 * `/event`. The real `opencode` binary is never spawned, and the machine's live
 * opencode sessions are never touched. The endpoint is always a scratch path
 * under `tmpdir()`; `sessiondEndpoint()`, the real one, is never bound.
 */
import { afterEach, expect, test } from "bun:test";
import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOpencodeClient } from "@opencode-ai/sdk";
import { probeEndpoint, SessiondClient } from "../sessiond-client";
import {
  attachOpencodeServer,
  OPENCODE_SERVER_PROC_ID,
  parseServerAnnouncement,
} from "./opencode";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    cleanup();
  }
});

const scratch = (): string => mkdtempSync(join(tmpdir(), "opencode-sessiond-"));

/** sessiond, in its own process, on a socket that is nobody else's. */
const startDaemon = async (): Promise<string> => {
  const endpoint = join(scratch(), "sessiond.sock");
  const main = join(
    import.meta.dir,
    "..",
    "..",
    "..",
    "sessiond",
    "src",
    "main.ts"
  );
  const daemon: ChildProcess = spawn(process.execPath, [main], {
    env: { ...process.env, WHIFFLE_SESSIOND_ENDPOINT: endpoint },
    stdio: "ignore",
  });
  cleanups.push(() => daemon.kill("SIGKILL"));
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await probeEndpoint(endpoint, 200)) {
      return endpoint;
    }
    await Bun.sleep(25);
  }
  throw new Error(`sessiond never bound ${endpoint}`);
};

/**
 * A stand-in for `opencode serve`: binds an ephemeral port, announces it the
 * way the real binary does — the unsecured-server warning first, then the
 * listening line (verified against opencode 1.18.19) — and serves an SSE
 * stream on `/event`. `/subscriptions` reports how many times `/event` has been
 * opened, which is how the rebuild test proves the SECOND subscription is real
 * and not the first one still hanging around.
 */
const fakeServerScript = (dir: string): string => {
  const path = join(dir, "fake-opencode-serve.mjs");
  writeFileSync(
    path,
    [
      "import { createServer } from 'node:http';",
      "let subscriptions = 0;",
      "const server = createServer((req, res) => {",
      "  if (req.url && req.url.startsWith('/subscriptions')) {",
      "    res.writeHead(200, { 'content-type': 'application/json' });",
      "    res.end(JSON.stringify({ subscriptions }));",
      "    return;",
      "  }",
      "  if (req.url && req.url.startsWith('/event')) {",
      "    subscriptions++;",
      "    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });",
      "    const timer = setInterval(() => res.write(`data: ${JSON.stringify({ type: 'server.connected', subscription: subscriptions })}\\n\\n`), 20);",
      "    req.on('close', () => clearInterval(timer));",
      "    return;",
      "  }",
      "  res.writeHead(404);",
      "  res.end();",
      "});",
      "server.listen(0, '127.0.0.1', () => {",
      "  process.stdout.write('Warning: OPENCODE_SERVER_PASSWORD is not set; server is unsecured.\\n');",
      "  process.stdout.write(`opencode server listening on http://127.0.0.1:${server.address().port}\\n`);",
      "});",
    ].join("\n")
  );
  return path;
};

const serverSpec = (dir: string): { command: string; args: string[] } => ({
  command: process.execPath,
  args: [fakeServerScript(dir)],
});

/** One SSE frame off the real SDK client, or a throw. */
const firstEvent = async (
  client: ReturnType<typeof createOpencodeClient>,
  directory: string
): Promise<unknown> => {
  const { stream } = await client.event.subscribe({ query: { directory } });
  for await (const event of stream) {
    return event;
  }
  throw new Error("the SSE stream ended without an event");
};

// ---------------------------------------------------------------- the parser

test("the announced port is parsed agent-side, from the format the binary actually prints", () => {
  // Both lines exactly as opencode 1.18.19 printed them in this session.
  expect(
    parseServerAnnouncement(
      "Warning: OPENCODE_SERVER_PASSWORD is not set; server is unsecured."
    )
  ).toBeUndefined();
  expect(
    parseServerAnnouncement(
      "opencode server listening on http://127.0.0.1:43663"
    )
  ).toBe("http://127.0.0.1:43663");
  // Not a port line, and never mistaken for one.
  expect(parseServerAnnouncement("")).toBeUndefined();
  expect(parseServerAnnouncement("opencode server listening")).toBeUndefined();
});

// ------------------------------------------------------------------ G1 / G2

test("the server is spawned through sessiond, its port read from the ring, and one server is kept", async () => {
  const endpoint = await startDaemon();
  const dir = scratch();
  const client = await SessiondClient.connect(endpoint);
  cleanups.push(() => client.close());

  const url = await attachOpencodeServer({
    sessiond: client,
    spec: serverSpec(dir),
  });
  expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

  // sessiond owns it, not this process.
  const held = (await client.list()).procs.find(
    (proc) => proc.procId === OPENCODE_SERVER_PROC_ID
  );
  expect(held?.alive).toBe(true);
  expect(held!.pid).toBeGreaterThan(0);
  expect(held!.pid).not.toBe(process.pid);
  cleanups.push(() => {
    try {
      process.kill(held!.pid, "SIGKILL");
    } catch {
      /* already gone */
    }
  });

  // And it is a real server at that URL.
  const probe = await fetch(`${url}/subscriptions`);
  expect(probe.status).toBe(200);

  // A second attach finds the SAME child rather than starting a rival: the
  // announce line comes out of the replay ring, long after it was written.
  const again = await attachOpencodeServer({
    sessiond: client,
    spec: serverSpec(dir),
  });
  expect(again).toBe(url);
  const stillHeld = (await client.list()).procs.filter(
    (proc) => proc.procId === OPENCODE_SERVER_PROC_ID
  );
  expect(stillHeld).toHaveLength(1);
  expect(stillHeld[0]!.pid).toBe(held!.pid);
}, 30_000);

test("a torn-down agent side rebuilds onto the still-running server and re-subscribes SSE", async () => {
  const endpoint = await startDaemon();
  const dir = scratch();

  // ---- first life -------------------------------------------------------
  const first = await SessiondClient.connect(endpoint);
  const url = await attachOpencodeServer({
    sessiond: first,
    spec: serverSpec(dir),
  });
  const pid = (await first.list()).procs.find(
    (proc) => proc.procId === OPENCODE_SERVER_PROC_ID
  )!.pid;
  cleanups.push(() => {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* already gone */
    }
  });

  const firstClient = createOpencodeClient({ baseUrl: url });
  expect(await firstEvent(firstClient, dir)).toBeTruthy();
  expect(await (await fetch(`${url}/subscriptions`)).json()).toEqual({
    subscriptions: 1,
  });

  // ---- THE DEATH: everything the agent held goes away. The server does not.
  first.close();
  await Bun.sleep(250);

  // ---- second life ------------------------------------------------------
  const second = await SessiondClient.connect(endpoint);
  cleanups.push(() => second.close());
  const rebuilt = await attachOpencodeServer({
    sessiond: second,
    spec: serverSpec(dir),
  });
  // Same server, same process: no restart, no second server, no lost sessions.
  expect(rebuilt).toBe(url);
  const after = (await second.list()).procs.find(
    (proc) => proc.procId === OPENCODE_SERVER_PROC_ID
  );
  expect(after?.alive).toBe(true);
  expect(after!.pid).toBe(pid);

  // And the SSE pump re-subscribes: a SECOND, distinct subscription lands on
  // the same server — the thing `#pumpDirectory` does per directory after a
  // supervisor rebuild.
  const secondClient = createOpencodeClient({ baseUrl: rebuilt });
  expect(await firstEvent(secondClient, dir)).toBeTruthy();
  const counted = (await (await fetch(`${url}/subscriptions`)).json()) as {
    subscriptions: number;
  };
  expect(counted.subscriptions).toBeGreaterThanOrEqual(2);
}, 30_000);
