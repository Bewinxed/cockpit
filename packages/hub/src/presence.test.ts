import { afterAll, expect, test } from "bun:test";
import type { AgentRow } from "@whiffle/core";
import { makeDb } from "./db";
import type { PendingShape } from "./pending";
import type { HubSocket, RegistryShape } from "./registry";
import { createServer } from "./server";

/**
 * Presence is the registry's; history is the database's.
 *
 * The defect this file fences: the hub had two sources of truth for "is this
 * machine reachable". Routing asked the in-memory socket registry; `/api/agents`
 * and every `instances` frame answered from the `agents.status` column, which is
 * only ever written `'offline'` by the socket close handler. A hub restart runs
 * no close handlers, so the column keeps saying `'online'` about machines the
 * new process has never held a socket for. Measured in exactly that window:
 * three machines reported `"status":"online"` with fresh `lastSeenAt`, while
 * every send came back `machine <id> is not connected`.
 *
 * The fix is a read-time overlay, and these tests are the statement of what it
 * means: `status` comes from the live registry, everything else on the row comes
 * from the database, and the two emission points cannot disagree.
 *
 * A scratch database, for the reason every other suite here keeps one: `bun
 * test` runs every file in one process, so a shared path is a shared race.
 */
const DB_FILE = `/tmp/whiffle-presence-${crypto.randomUUID()}.db`;
const db = makeDb(DB_FILE);

const LIVE = "machine-live";
const DROPPED = "machine-dropped";

/**
 * Faithful enough to route, and — unlike the other suites' stubs — *mutable*:
 * this file's whole subject is what happens when a socket goes away without the
 * database being told, so connecting and dropping has to be something a test
 * can do between two reads.
 */
const makeTestRegistry = (): RegistryShape & {
  readonly sockets: Map<string, HubSocket>;
} => {
  const sockets = new Map<string, HubSocket>();
  const dashboards = new Map<
    string,
    { socket: HubSocket; subscriptions: Set<string> }
  >();
  const requesters = new Map<string, HubSocket>();
  return {
    sockets,
    registerAgent: (machineId, socket) => sockets.set(machineId, socket),
    dropAgent: (socketId) => {
      for (const [machineId, socket] of sockets) {
        if (socket.id === socketId) {
          sockets.delete(machineId);
          return machineId;
        }
      }
    },
    agent: (machineId) => sockets.get(machineId),
    machineIds: () => [...sockets.keys()],
    addDashboard: (socket) =>
      dashboards.set(socket.id, { socket, subscriptions: new Set() }),
    dropDashboard: (socket) => dashboards.delete(socket.id),
    broadcast: (envelope) => {
      for (const { socket } of dashboards.values()) {
        socket.send(envelope);
      }
    },
    broadcastFrame: (envelope, instanceId) => {
      for (const { socket, subscriptions } of dashboards.values()) {
        if (subscriptions.has(instanceId)) {
          socket.send(envelope);
        }
      }
    },
    setSubscriptions: (socket, instanceIds) => {
      const entry = dashboards.get(socket.id);
      if (entry) {
        entry.subscriptions = new Set(instanceIds);
      }
    },
    noteDashboardOrigin: () => {},
    dashboardOrigin: () => undefined,
    rememberRequester: (requestId, socket) => requesters.set(requestId, socket),
    takeRequester: (requestId) => {
      const socket = requesters.get(requestId);
      requesters.delete(requestId);
      return socket;
    },
  };
};

const pending: PendingShape = {
  remember: () => {},
  get: () => undefined,
  resolve: () => {},
  forget: () => {},
  list: () => [],
};

const registry = makeTestRegistry();
const app = createServer({ registry, db, pending }).listen(0);
const port = app.server?.port;

// Registered AFTER `createServer`, deliberately: the server clears every stored
// `online` on the way up, so a row written before it would be reset by boot
// rather than by anything these tests are testing.
db.upsertAgent({
  machineId: LIVE,
  hostname: "live-box",
  os: "linux",
  auth: "authenticated",
  build: {
    version: "1.2.3",
    commit: "abc1234",
    dirty: false,
    startedAt: 1_700_000_000_000,
  },
});
db.upsertAgent({
  machineId: DROPPED,
  hostname: "dropped-box",
  os: "darwin",
  auth: "unknown",
});

const socketFor = (machineId: string): HubSocket => ({
  id: `sock-${machineId}`,
  send: () => {},
});
registry.registerAgent(LIVE, socketFor(LIVE));
registry.registerAgent(DROPPED, socketFor(DROPPED));

afterAll(async () => {
  app.stop();
  for (const suffix of ["", "-shm", "-wal"]) {
    await Bun.file(`${DB_FILE}${suffix}`)
      .delete()
      .catch(() => {});
  }
});

const readAgents = async (): Promise<AgentRow[]> => {
  const response = await fetch(`http://localhost:${port}/api/agents`);
  expect(response.status).toBe(200);
  return (await response.json()) as AgentRow[];
};

const rowFor = (rows: AgentRow[], machineId: string): AgentRow => {
  const row = rows.find((candidate) => candidate.machineId === machineId);
  if (!row) {
    throw new Error(`no row for ${machineId} in ${JSON.stringify(rows)}`);
  }
  return row;
};

test("a machine the hub is holding a socket for reads online", async () => {
  expect(rowFor(await readAgents(), LIVE).status).toBe("online");
});

test("a machine whose socket dropped reads offline even though its heartbeat row is fresh", async () => {
  // The database is told the machine is here, and *is not* told it left — the
  // exact state a hub restart or an un-closed socket leaves behind.
  db.touchAgent(DROPPED);
  expect(db.listAgents().find((row) => row.machineId === DROPPED)?.status).toBe(
    "online"
  );

  registry.sockets.delete(DROPPED);

  // The very next read tells the truth, with no heartbeat expiry to wait out.
  const rows = await readAgents();
  expect(rowFor(rows, DROPPED).status).toBe("offline");
  // And the fresh `lastSeenAt` survives: presence changed, history did not.
  expect(rowFor(rows, DROPPED).lastSeenAt).not.toBeNull();
  // The neighbour is unaffected — this is per-machine, not a global flip.
  expect(rowFor(rows, LIVE).status).toBe("online");
});

test("the registry outranks the column in the other direction too", async () => {
  // A row explicitly stored `offline` while a socket is live must read `online`:
  // it proves the overlay is authoritative rather than merely pessimistic, which
  // a "downgrade only" implementation would also pass.
  db.markAgentOffline(LIVE);
  expect(db.listAgents().find((row) => row.machineId === LIVE)?.status).toBe(
    "offline"
  );

  expect(rowFor(await readAgents(), LIVE).status).toBe("online");
});

test("the overlay passes every non-presence field through untouched", async () => {
  const stored = db.listAgents().find((row) => row.machineId === LIVE);
  const served = rowFor(await readAgents(), LIVE);

  expect(served.hostname).toBe("live-box");
  expect(served.os).toBe("linux");
  expect(served.auth).toBe("authenticated");
  expect(served.build).toEqual({
    version: "1.2.3",
    commit: "abc1234",
    dirty: false,
    startedAt: 1_700_000_000_000,
  });
  // Everything but `status` is the stored row, key for key — the overlay is a
  // single-field derivation, not a projection that quietly drops what it does
  // not understand.
  // Through JSON on both sides: the stored row carries real `Date`s that the
  // route serialises to strings, and that difference is the transport's, not
  // the overlay's.
  const strip = (row: object): object => {
    const {
      status: _status,
      lastSeenAt: _lastSeenAt,
      ...rest
    } = JSON.parse(JSON.stringify(row));
    return rest;
  };
  expect(strip(served)).toEqual(strip(stored ?? {}));
});

test("the instances frame and /api/agents say the same thing about the same machine", async () => {
  const socket = new WebSocket(`ws://localhost:${port}/ws/dashboard`);
  const inbox: Record<string, unknown>[] = [];
  socket.addEventListener("message", (event) => {
    inbox.push(JSON.parse(String(event.data)) as Record<string, unknown>);
  });
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener(
      "error",
      () => reject(new Error("could not open the dashboard socket")),
      {
        once: true,
      }
    );
  });

  let frame: Record<string, unknown> | undefined;
  for (let waited = 0; waited < 400 && !frame; waited++) {
    frame = inbox.find((message) => message.verb === "frames");
    if (!frame) {
      await Bun.sleep(5);
    }
  }
  socket.close();
  if (!frame) {
    throw new Error(`no opening snapshot; inbox: ${JSON.stringify(inbox)}`);
  }

  const framed = (frame.payload as { agents: AgentRow[] }).agents;
  const served = await readAgents();
  // Both emission points go through one helper, so this is the assertion that
  // they cannot drift apart again.
  expect(rowFor(framed, LIVE).status).toBe(rowFor(served, LIVE).status);
  expect(rowFor(framed, LIVE).status).toBe("online");
  expect(rowFor(framed, DROPPED).status).toBe(rowFor(served, DROPPED).status);
  expect(rowFor(framed, DROPPED).status).toBe("offline");
});

test("hub boot clears rows left claiming online by a previous process", () => {
  // Both machines are stored `online` — the state a hub that was killed leaves
  // behind, since only the close handler ever writes `offline`.
  db.upsertAgent({
    machineId: LIVE,
    hostname: "live-box",
    os: "linux",
    auth: "authenticated",
  });
  db.upsertAgent({
    machineId: DROPPED,
    hostname: "dropped-box",
    os: "darwin",
    auth: "unknown",
  });
  expect(db.listAgents().every((row) => row.status === "online")).toBe(true);
  const seenBefore = new Map(
    db.listAgents().map((row) => [row.machineId, row.lastSeenAt])
  );

  // A new hub process comes up on the same database. It is not listened on:
  // constructing the server is the moment that matters.
  createServer({ registry: makeTestRegistry(), db, pending });

  expect(db.listAgents().some((row) => row.status === "online")).toBe(false);
  // History is not rewritten by the reset — only reachability is.
  for (const row of db.listAgents()) {
    expect(row.lastSeenAt).toEqual(seenBefore.get(row.machineId) ?? null);
  }
});
