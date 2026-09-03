/**
 * The Ledger Protocol, end to end, in one process.
 *
 * Every other suite proves one half. This one proves the two halves COMPOSE:
 * a real `createServer` on an ephemeral port, a real daemon WebSocket feeding
 * it frames, and the dashboard store's real decision logic on the other end of
 * a real dashboard WebSocket — with the client's socket binding replicated
 * line for line from `client.svelte.ts`, because a `.svelte.ts` module cannot
 * be imported by `bun test` (which is why the decisions live in `stream.ts` at
 * all).
 *
 * WHAT IS REAL HERE
 * - `packages/hub/src/server.ts` — the whole hub, listening, over real sockets.
 * - `packages/hub/src/stream.ts` — its sequencer, its 512 ring, its acks.
 * - `packages/hub/src/db` — a real (scratch) sqlite database.
 * - `apps/dashboard/src/lib/whiffle/stream.ts` — every client-side decision:
 *   capability detection, cursors, gap/duplicate/backlog/reset handling, the
 *   command tracker.
 * - The wire: real `WebSocket`s, real JSON, the RAW top-level stream shapes.
 *
 * WHAT IS SCRIPTED HERE, AND WHY
 * - The registry (see {@link makeRegistry}) — `packages/hub/src/registry.ts`
 *   only exports its implementation through an Effect `Layer`, and `effect`
 *   does not resolve from `apps/dashboard`. The stand-in is the real one's
 *   maps with the real one's semantics.
 * - `pending` — a no-op; nothing here parks a permission request.
 * - The client's socket binding ({@link connect}) and the store chokepoint
 *   ({@link Client.ingest}) — replicated from `client.svelte.ts:1157` and
 *   `:1521`, in the same order, so the routing under test is the routing that
 *   ships. The store state they drive is the real module's.
 * - The daemon — a real socket speaking the real agent dialect, but scripted:
 *   it emits the frames a test asks for and answers controls on demand.
 */
import { afterAll, expect, test } from "bun:test";
import type { Envelope, FramePayload } from "@whiffle/core";
import { STREAM_V1 } from "@whiffle/core";
import { makeDb } from "../../../../../packages/hub/src/db";
import type { PendingShape } from "../../../../../packages/hub/src/pending";
import type {
  HubSocket,
  RegistryShape,
} from "../../../../../packages/hub/src/registry";
import { createServer } from "../../../../../packages/hub/src/server";
import {
  type CommandRecord,
  createStreamState,
  handleStreamMessage,
  noteCapabilities,
  noteDisconnect,
  type StreamHost,
  type StreamState,
  streamCarries,
  submitCommand,
  sweepCommands,
  syncStreamSubscriptions,
} from "./stream";

/* ------------------------------------------------------------------ *
 * The hub, for real
 * ------------------------------------------------------------------ */

const DB_FILE = `/tmp/whiffle-e2e-${crypto.randomUUID()}.db`;
const db = makeDb(DB_FILE);

const MACHINE = "e2e-machine";

/**
 * The real registry's maps with the real registry's semantics — a stand-in
 * only because `registry.ts` exports its implementation through an Effect
 * `Layer` and `effect` is not resolvable from this package. Agents are stored
 * by machine id, dashboards carry their subscription set, and requesters are
 * consumed once; nothing here is a simplification of the routing under test.
 */
const makeRegistry = (): RegistryShape => {
  const agents = new Map<string, HubSocket>();
  const dashboards = new Map<
    string,
    { socket: HubSocket; subscriptions: Set<string> }
  >();
  const requesters = new Map<string, HubSocket>();
  return {
    registerAgent: (machineId, socket) => {
      agents.set(machineId, socket);
    },
    dropAgent: (socketId) => {
      for (const [machineId, socket] of agents) {
        if (socket.id === socketId) {
          agents.delete(machineId);
          return machineId;
        }
      }
    },
    agent: (machineId) => agents.get(machineId),
    machineIds: () => [...agents.keys()],
    addDashboard: (socket) => {
      dashboards.set(socket.id, { socket, subscriptions: new Set() });
    },
    dropDashboard: (socket) => {
      dashboards.delete(socket.id);
      for (const [requestId, held] of requesters) {
        if (held.id === socket.id) {
          requesters.delete(requestId);
        }
      }
    },
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
    rememberRequester: (requestId, socket) => requesters.set(requestId, socket),
    takeRequester: (requestId) => {
      const socket = requesters.get(requestId);
      requesters.delete(requestId);
      return socket;
    },
    // The hub records where a dashboard says it was loaded from, so the
    // Telegram bridge can link to a URL that actually reached one. This fake
    // has no use for it, but the server calls it on every dashboard connect —
    // and an absent method throws there, which reads from here as every client
    // timing out on capability rather than as a missing stub.
    noteDashboardOrigin: () => {
      /* not exercised by these tests */
    },
    dashboardOrigin: () => undefined,
  };
};

const pending: PendingShape = {
  remember: () => {
    /* not exercised by these tests */
  },
  get: () => undefined,
  resolve: () => {
    /* not exercised by these tests */
  },
  forget: () => {
    /* not exercised by these tests */
  },
  list: () => [],
};

const registry = makeRegistry();
const app = createServer({ registry, db, pending }).listen(0);
const port = app.server?.port;
if (!port) {
  throw new Error("the hub did not listen");
}

const openSockets: WebSocket[] = [];

afterAll(async () => {
  for (const socket of openSockets) {
    try {
      socket.close();
    } catch {
      /* already gone */
    }
  }
  app.stop();
  // Three independent files, no shared state and no ordering between them.
  await Promise.all(
    ["", "-shm", "-wal"].map((suffix) =>
      Bun.file(`${DB_FILE}${suffix}`)
        .delete()
        .catch(() => {
          /* already gone */
        })
    )
  );
});

/* ------------------------------------------------------------------ *
 * Waiting
 * ------------------------------------------------------------------ */

/** Polls until a condition holds, or fails with what it was waiting for. */
const until = async (
  holds: () => boolean,
  label: string,
  budgetMs = 10_000
): Promise<void> => {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    if (holds()) {
      return;
    }
    // biome-ignore lint/performance/noAwaitInLoops: sequential by intent — a poll must re-check `holds()` between each wait, not fire every wait at once.
    await Bun.sleep(2);
  }
  throw new Error(`timed out waiting for ${label}`);
};

/** A moment for anything already in flight to land, when the assertion is a NEGATIVE. */
const quiet = (): Promise<void> => Bun.sleep(60);

/**
 * Opens a socket with its message handler already attached.
 *
 * The listener goes on BEFORE `open` is awaited on purpose: the hub's very
 * first message — the `instances` snapshot that carries `capabilities` — is
 * sent from the server's own `open` callback, and a handler attached after the
 * client's open event has already resolved can miss it entirely. That is not a
 * hypothetical: it is what this harness did on its first run, and the
 * capability handshake never arrived.
 */
const openWebSocket = (
  path: string,
  onMessage: (data: string) => void
): { socket: WebSocket; ready: Promise<void> } => {
  const socket = new WebSocket(`ws://localhost:${port}${path}`);
  openSockets.push(socket);
  socket.addEventListener("message", (event) => onMessage(String(event.data)));
  const ready = new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener(
      "error",
      () => reject(new Error(`could not open ${path}`)),
      {
        once: true,
      }
    );
  });
  return { socket, ready };
};

/* ------------------------------------------------------------------ *
 * The daemon: a real agent socket, scripted
 * ------------------------------------------------------------------ */

interface Daemon {
  /** The reply that settles a control command. */
  // biome-ignore lint/style/useConsistentMethodSignatures: property-style signatures check contravariantly; openDaemon below returns an object literal implementing this port and a switch could reject that assignment.
  answerControl(requestId: string, ok: boolean, error?: string): void;
  // biome-ignore lint/style/useConsistentMethodSignatures: property-style signatures check contravariantly; openDaemon below returns an object literal implementing this port and a switch could reject that assignment.
  close(): void;
  /** Emits one sequenced transcript frame for a session; returns its ordinal. */
  // biome-ignore lint/style/useConsistentMethodSignatures: property-style signatures check contravariantly; openDaemon below returns an object literal implementing this port and a switch could reject that assignment.
  emit(sessionId: string, ordinal: number): void;
  // biome-ignore lint/style/useConsistentMethodSignatures: property-style signatures check contravariantly; openDaemon below returns an object literal implementing this port and a switch could reject that assignment.
  raw(envelope: unknown): void;
  readonly received: Envelope[];
}

/** The transcript frame shape the relay actually carries, with an ordinal in it. */
const frameFor = (
  sessionId: string,
  ordinal: number
): Record<string, unknown> => ({
  kind: "frame",
  instanceId: sessionId,
  harness: "claude",
  message: {
    type: "assistant",
    message: {
      role: "assistant",
      content: [{ type: "text", text: `e-${ordinal}` }],
    },
  },
});

/** The ordinal a frame carries, or -1 when it is not one of ours. */
const ordinalOf = (frame: unknown): number => {
  const text = (
    frame as
      | { message?: { message?: { content?: { text?: string }[] } } }
      | undefined
  )?.message?.message?.content?.[0]?.text;
  if (typeof text !== "string" || !text.startsWith("e-")) {
    return -1;
  }
  return Number(text.slice(2));
};

const openDaemon = async (machineId: string): Promise<Daemon> => {
  const received: Envelope[] = [];
  const { socket, ready } = openWebSocket("/ws", (data) => {
    received.push(JSON.parse(data) as Envelope);
  });
  await ready;
  const send = (envelope: unknown): void =>
    socket.send(JSON.stringify(envelope));
  send({
    verb: "register",
    machineId,
    payload: {
      hostname: "e2e",
      os: "linux",
      auth: "authenticated",
      instances: [],
    },
  });
  await until(
    () => registry.agent(machineId) !== undefined,
    `${machineId} to register`
  );
  return {
    received,
    emit: (sessionId, ordinal) =>
      send({
        verb: "frames",
        machineId,
        instanceId: sessionId,
        payload: frameFor(sessionId, ordinal),
      }),
    answerControl: (requestId, ok, error) =>
      send({
        verb: "frames",
        machineId,
        requestId,
        payload: {
          kind: "control_result",
          requestId,
          ok,
          ...(error ? { error } : {}),
        },
      }),
    raw: send,
    close: () => socket.close(),
  };
};

/* ------------------------------------------------------------------ *
 * The dashboard client: the real store logic on a real socket
 * ------------------------------------------------------------------ */

/** One frame as it reached the store's chokepoint, and by which road. */
interface Applied {
  frame: FramePayload;
  sessionId: string | undefined;
  source: "legacy" | "stream";
}

interface Client {
  /** Every frame that reached the chokepoint, in order. */
  readonly applied: Applied[];
  // biome-ignore lint/style/useConsistentMethodSignatures: property-style signatures check contravariantly; makeClient below returns an object literal implementing this port and a switch could reject that assignment.
  connect(): Promise<void>;
  /** Closes the socket and runs the store's disconnect bookkeeping. */
  // biome-ignore lint/style/useConsistentMethodSignatures: property-style signatures check contravariantly; makeClient below returns an object literal implementing this port and a switch could reject that assignment.
  disconnect(): Promise<void>;
  /** Every command the ledger announced as failed, through `StreamHost.noteFailure`. */
  readonly failures: CommandRecord[];
  readonly host: StreamHost;
  /** Every inbound socket message, parsed — for asserting on the wire itself. */
  readonly inbox: Record<string, unknown>[];
  // biome-ignore lint/style/useConsistentMethodSignatures: property-style signatures check contravariantly; makeClient below returns an object literal implementing this port and a switch could reject that assignment.
  isOpen(): boolean;
  /** Every message the STORE put on the wire — how "one resume per gap" is counted. */
  readonly outbox: Record<string, unknown>[];
  readonly rereads: string[];
  // biome-ignore lint/style/useConsistentMethodSignatures: property-style signatures check contravariantly; makeClient below returns an object literal implementing this port and a switch could reject that assignment.
  send(message: unknown): void;
  readonly state: StreamState;
  /** The ordered transcript this client believes for a session. */
  // biome-ignore lint/style/useConsistentMethodSignatures: property-style signatures check contravariantly; makeClient below returns an object literal implementing this port and a switch could reject that assignment.
  transcript(sessionId: string): number[];
  readonly warnings: { message: string; detail: unknown }[];
  // biome-ignore lint/style/useConsistentMethodSignatures: property-style signatures check contravariantly; makeClient below returns an object literal implementing this port and a switch could reject that assignment.
  watch(sessionIds: string[]): void;
  /** The sessions this dashboard is watching; drives both dialects, as the real one does. */
  watched: string[];
}

const makeClient = (): Client => {
  const state = createStreamState();
  const applied: Applied[] = [];
  const rereads: string[] = [];
  const warnings: { message: string; detail: unknown }[] = [];
  const inbox: Record<string, unknown>[] = [];
  const outbox: Record<string, unknown>[] = [];
  const failures: CommandRecord[] = [];
  let socket: WebSocket | undefined;

  /**
   * `client.svelte.ts:1157` — THE CHOKEPOINT, replicated: one place a frame
   * becomes state, and the learnt duplicate guard on the legacy road.
   */
  const ingest = (
    sessionId: string | undefined,
    frame: FramePayload,
    source: "legacy" | "stream"
  ): void => {
    if (
      source === "legacy" &&
      sessionId &&
      streamCarries(state, sessionId, frame.kind)
    ) {
      return;
    }
    applied.push({ sessionId, frame, source });
  };

  const sessionOf = (frame: FramePayload): string | undefined =>
    (frame as { instanceId?: string }).instanceId;

  const client: Client = {
    state,
    applied,
    rereads,
    warnings,
    inbox,
    outbox,
    failures,
    watched: [],
    host: {
      applyFrame: (sessionId, frame) =>
        ingest(sessionId, frame as FramePayload, "stream"),
      rereadHistory: (sessionId) => rereads.push(sessionId),
      sendToHub: (message) => {
        if (!socket || socket.readyState !== WebSocket.OPEN) {
          return false;
        }
        outbox.push(message as unknown as Record<string, unknown>);
        socket.send(JSON.stringify(message));
        return true;
      },
      now: () => Date.now(),
      warn: (message, detail) => warnings.push({ message, detail }),
      // The client's failure port, replicated: `client.svelte.ts` builds one on
      // its `streamHost`, so a harness without it would be testing a quieter
      // dashboard than the one that ships.
      noteFailure: (failedRecord) => failures.push(failedRecord),
    },
    isOpen: () => socket?.readyState === WebSocket.OPEN,
    send: (message) => socket?.send(JSON.stringify(message)),
    watch: (sessionIds) => {
      client.watched = sessionIds;
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        return;
      }
      // `syncSubscriptions` (client.svelte.ts:1384): the legacy set first, then
      // the stream — a no-op against a hub that has not advertised yet.
      socket.send(
        JSON.stringify({
          verb: "subscribe",
          machineId: "",
          payload: { instanceIds: sessionIds },
        })
      );
      syncStreamSubscriptions(state, client.host, sessionIds);
    },
    connect: async () => {
      // `bind` (client.svelte.ts:1521), verbatim in order: capability off ANY
      // message, then the stream's own raw shapes, then the legacy envelope.
      const opened = openWebSocket("/ws/dashboard", (data) => {
        const message = JSON.parse(data) as unknown;
        inbox.push(message as Record<string, unknown>);
        const wasCapable = state.capable;
        // No compensation: since the E-1 fix, `noteCapabilities` itself reads
        // the payload nesting the hub actually uses. This is the shipping path.
        noteCapabilities(state, message);
        const consumed = handleStreamMessage(state, client.host, message);
        if (!wasCapable && state.capable) {
          syncStreamSubscriptions(state, client.host, client.watched);
        }
        if (consumed) {
          return;
        }
        const envelope = message as Envelope<FramePayload>;
        if (envelope.verb !== "frames") {
          return;
        }
        ingest(sessionOf(envelope.payload), envelope.payload, "legacy");
      });
      // Assigned before the first message can be routed: `sendToHub` reads it,
      // and a `stream.subscribe` that never left is a client that never follows.
      ({ socket } = opened);
      await opened.ready;
      // `onopen` re-declares the subscription set on every connection.
      if (client.watched.length > 0) {
        client.watch(client.watched);
      }
    },
    disconnect: async () => {
      const closing = socket;
      socket = undefined;
      closing?.close();
      // `onclose` (client.svelte.ts:1548): cursors keep their `lastSeq`,
      // everything else dies with the connection. (This call was the target of
      // mutation check 2 — removing it correctly failed 5 tests, which is the
      // suite proving it bites.)
      noteDisconnect(state, Date.now(), client.host);
      await Bun.sleep(20);
    },
    transcript: (sessionId) =>
      applied
        .filter(
          (entry) =>
            entry.sessionId === sessionId && entry.frame.kind === "frame"
        )
        .map((entry) => ordinalOf(entry.frame)),
  };
  return client;
};

/** Emits `count` frames starting at `from`, and waits for a witness to see them all. */
const emitRun = async (
  daemon: Daemon,
  sessionId: string,
  from: number,
  count: number,
  witness?: () => number
): Promise<number> => {
  for (let index = 0; index < count; index += 1) {
    daemon.emit(sessionId, from + index);
    // The socket is not a firehose: yielding keeps 500 frames from queueing
    // behind one another and lets the hub sequence as they arrive.
    if (index % 64 === 63) {
      // biome-ignore lint/performance/noAwaitInLoops: sequential by intent — this yield is what paces emission; batching it away would re-introduce the queueing this loop exists to avoid.
      await Bun.sleep(1);
    }
  }
  if (witness) {
    const target = count;
    await until(() => witness() >= target, `${count} frames on ${sessionId}`);
  }
  return from + count;
};

const session = (label: string): string =>
  `${label}-${crypto.randomUUID().slice(0, 8)}`;

const contiguousFrom = (ordinals: number[], first: number): boolean =>
  ordinals.every((value, index) => value === first + index);

/* ------------------------------------------------------------------ *
 * Composition: does the store's routing even receive the hub's shapes?
 * ------------------------------------------------------------------ */

test("the hub advertises stream.v1 on the opening frame and the store flips capable", async () => {
  const client = makeClient();
  await client.connect();
  await until(() => client.state.capable, "the capability handshake");

  const first = client.inbox[0] as {
    verb?: string;
    payload?: { capabilities?: string[] };
  };
  expect(first.verb).toBe("frames");
  expect(first.payload?.capabilities).toEqual([STREAM_V1]);
  await client.disconnect();
});

/**
 * Regression for DEFECT E-1 (found by this suite, fixed in stream.ts): the hub
 * advertises `capabilities` inside the `instances` frame's PAYLOAD
 * (`packages/hub/src/server.ts:865`, sent at `:2951`); `noteCapabilities` must
 * read that nesting, or the handshake silently never fires against the real
 * hub and the Ledger Protocol never engages. This test holds the fix against
 * the REAL first message the hub sends — inverted from the tripwire the
 * defect's discovery left behind, exactly as that tripwire instructed.
 */
test("the handshake fires on the real opening frame: capabilities read from the payload nesting", async () => {
  const client = makeClient();
  await client.connect();
  await until(() => client.inbox.length > 0, "the opening frame");
  const [first] = client.inbox;

  // Where the hub actually puts it.
  expect((first.payload as { capabilities?: string[] }).capabilities).toEqual([
    STREAM_V1,
  ]);
  // The store's detection fires on that real message, unassisted.
  expect(noteCapabilities(createStreamState(), first)).toBe(true);
  // And the live client that connected above flipped for real.
  expect(client.state.capable).toBe(true);

  await client.disconnect();
});

test("the store consumes the raw top-level stream shapes the hub actually sends", async () => {
  const daemon = await openDaemon(MACHINE);
  const id = session("raw");
  const client = makeClient();
  await client.connect();
  await until(() => client.state.capable, "capability");
  client.watch([id]);
  await until(
    () => client.state.cursors[id]?.subscribed === true,
    "the stream subscription"
  );

  daemon.emit(id, 1);
  await until(
    () => client.transcript(id).length === 1,
    "the first sequenced frame"
  );

  // The hub sent `{type:'stream.event', event:{...}}` at the top level, NOT an
  // Envelope — and the store's routing took it before the envelope check.
  const delta = client.inbox.find((m) => m.type === "stream.event") as
    | { event?: { seq?: number; sessionId?: string; frame?: unknown } }
    | undefined;
  expect(delta?.event?.seq).toBe(1);
  expect(delta?.event?.sessionId).toBe(id);
  expect(delta?.event?.frame).toEqual(frameFor(id, 1));
  expect(client.state.cursors[id]?.lastSeq).toBe(1);
  // The stream carries `kind:'frame'` payloads: what reached the chokepoint is
  // the frame, never the envelope around it.
  expect(client.applied.at(-1)).toEqual({
    sessionId: id,
    frame: frameFor(id, 1) as FramePayload,
    source: "stream",
  });

  await client.disconnect();
  daemon.close();
});

test("a stream-followed session is not also delivered in the legacy dialect", async () => {
  const daemon = await openDaemon(MACHINE);
  const id = session("nodupe");
  const client = makeClient();
  await client.connect();
  await until(() => client.state.capable, "capability");
  client.watch([id]);
  await until(
    () => client.state.cursors[id]?.subscribed === true,
    "subscription"
  );

  await emitRun(daemon, id, 1, 20, () => client.transcript(id).length);
  await quiet();

  expect(client.transcript(id)).toEqual(
    Array.from({ length: 20 }, (_, i) => i + 1)
  );
  expect(
    client.applied.filter((e) => e.sessionId === id && e.source === "legacy")
  ).toEqual([]);
  await client.disconnect();
  daemon.close();
});

/* ------------------------------------------------------------------ *
 * G1 — 500 events across an induced disconnect
 * ------------------------------------------------------------------ */

test("G1 500 events with a mid-stream disconnect and resubscribe equal the uninterrupted control run", async () => {
  const daemon = await openDaemon(MACHINE);
  const id = session("g1");

  const control = makeClient();
  await control.connect();
  await until(() => control.state.capable, "control capability");
  control.watch([id]);
  await until(
    () => control.state.cursors[id]?.subscribed === true,
    "control subscription"
  );

  const flaky = makeClient();
  await flaky.connect();
  await until(() => flaky.state.capable, "flaky capability");
  flaky.watch([id]);
  await until(
    () => flaky.state.cursors[id]?.subscribed === true,
    "flaky subscription"
  );

  // 1..180 with both connected.
  await emitRun(daemon, id, 1, 180, () => flaky.transcript(id).length);
  const atDrop = flaky.state.cursors[id].lastSeq;
  expect(atDrop).toBe(180);

  // The socket dies. The cursor survives it — that number is what the ring is for.
  await flaky.disconnect();
  expect(flaky.state.capable).toBe(false);
  expect(flaky.state.cursors[id].subscribed).toBe(false);
  expect(flaky.state.cursors[id].lastSeq).toBe(180);

  // 181..320 arrive while it is away; only the control sees them live.
  await emitRun(
    daemon,
    id,
    181,
    140,
    () => control.transcript(id).length - 180
  );
  expect(flaky.transcript(id).length).toBe(180);

  // Reconnect: the opening snapshot re-advertises, the flip resumes from 180.
  await flaky.connect();
  await until(
    () => flaky.transcript(id).length === 320,
    "the replayed backlog"
  );

  const resume = flaky.inbox.find((m) => m.type === "stream.backlog") as
    | { events?: { seq: number }[] }
    | undefined;
  expect(resume?.events?.[0]?.seq).toBe(181);
  expect(resume?.events?.at(-1)?.seq).toBe(320);

  // 321..500 live again, on the new socket.
  await emitRun(daemon, id, 321, 180, () => flaky.transcript(id).length - 320);
  await until(() => control.transcript(id).length === 500, "the control run");
  await quiet();

  const ordinals = flaky.transcript(id);
  expect(ordinals.length).toBe(500);
  expect(contiguousFrom(ordinals, 1)).toBe(true);
  expect(new Set(ordinals).size).toBe(500);
  // The whole gate: the interrupted client's state IS the uninterrupted one's.
  expect(flaky.applied.filter((e) => e.sessionId === id)).toEqual(
    control.applied.filter((e) => e.sessionId === id)
  );
  expect(flaky.state.cursors[id].lastSeq).toBe(500);
  expect(flaky.rereads).toEqual([]);
  expect(flaky.warnings).toEqual([]);
  // Exactly two subscribes across the whole run: the fresh join, and the one
  // resume that names what it actually had. No gap-storm, no re-ask.
  const subscribes = flaky.outbox.filter(
    (m) => m.type === "stream.subscribe" && m.sessionId === id
  );
  expect(subscribes).toEqual([
    { type: "stream.subscribe", sessionId: id },
    { type: "stream.subscribe", sessionId: id, afterSeq: 180 },
  ]);

  await flaky.disconnect();
  await control.disconnect();
  daemon.close();
}, 30_000);

/* ------------------------------------------------------------------ *
 * G2 — late join
 * ------------------------------------------------------------------ */

test("G2 a late join resuming from the start converges on the from-start follower", async () => {
  const daemon = await openDaemon(MACHINE);
  const id = session("g2");

  const early = makeClient();
  await early.connect();
  await until(() => early.state.capable, "early capability");
  early.watch([id]);
  await until(
    () => early.state.cursors[id]?.subscribed === true,
    "early subscription"
  );

  await emitRun(daemon, id, 1, 300, () => early.transcript(id).length);

  // A tab opened after the fact, with nothing of its own: it asks for the
  // whole sequence, and the ring (512) can still answer.
  const late = makeClient();
  await late.connect();
  await until(() => late.state.capable, "late capability");
  late.send({ type: "stream.subscribe", sessionId: id, afterSeq: 0 });
  await until(
    () => late.transcript(id).length === 300,
    "the late join backlog"
  );

  // Both now follow live, and stay identical.
  await emitRun(daemon, id, 301, 40, () => late.transcript(id).length - 300);
  await until(() => early.transcript(id).length === 340, "the early follower");
  await quiet();

  expect(late.transcript(id)).toEqual(early.transcript(id));
  expect(contiguousFrom(late.transcript(id), 1)).toBe(true);
  expect(late.state.cursors[id].lastSeq).toBe(340);
  expect(early.state.cursors[id].lastSeq).toBe(340);
  expect(late.warnings).toEqual([]);

  await late.disconnect();
  await early.disconnect();
  daemon.close();
}, 30_000);

test("G2 a fresh late join with no afterSeq follows from now and converges on the tail", async () => {
  const daemon = await openDaemon(MACHINE);
  const id = session("g2-fresh");

  const early = makeClient();
  await early.connect();
  await until(() => early.state.capable, "early capability");
  early.watch([id]);
  await until(
    () => early.state.cursors[id]?.subscribed === true,
    "early subscription"
  );

  await emitRun(daemon, id, 1, 300, () => early.transcript(id).length);

  const late = makeClient();
  await late.connect();
  await until(() => late.state.capable, "late capability");
  // No cursor, so `subscribeSession` sends no `afterSeq`: "start me from now",
  // history arriving through the read paths as it always has.
  late.watch([id]);
  await until(
    () => late.state.cursors[id]?.subscribed === true,
    "late subscription"
  );
  await quiet();

  const subscribe = late.inbox.find((m) => m.type === "stream.backlog");
  expect(subscribe).toBeUndefined();
  expect(late.transcript(id)).toEqual([]);

  // From here the two are the same stream, and the late one adopts the hub's
  // first seq as its origin rather than demanding a replay back to 1.
  await emitRun(daemon, id, 301, 40, () => late.transcript(id).length);
  await until(() => early.transcript(id).length === 340, "the early follower");
  await quiet();

  expect(late.transcript(id)).toEqual(early.transcript(id).slice(300));
  expect(late.state.cursors[id].lastSeq).toBe(340);
  expect(early.state.cursors[id].lastSeq).toBe(340);
  expect(late.warnings).toEqual([]);
  expect(late.rereads).toEqual([]);

  await late.disconnect();
  await early.disconnect();
  daemon.close();
}, 30_000);

/* ------------------------------------------------------------------ *
 * G3 — commands, round trip
 * ------------------------------------------------------------------ */

const record = (client: Client, commandId: string): CommandRecord => {
  const found = client.state.commands[commandId];
  if (!found) {
    throw new Error(`no command record for ${commandId}`);
  }
  return found;
};

test("G3 a send command is accepted by the hub and its reflecting frame arrives on the stream", async () => {
  const daemon = await openDaemon(MACHINE);
  const id = session("g3-send");
  const client = makeClient();
  await client.connect();
  await until(() => client.state.capable, "capability");
  client.watch([id]);
  await until(
    () => client.state.cursors[id]?.subscribed === true,
    "subscription"
  );

  const commandId = `cmd-${crypto.randomUUID()}`;
  const message = { type: "user", message: { role: "user", content: "hello" } };
  submitCommand(client.state, client.host, {
    commandId,
    sessionId: id,
    machineId: MACHINE,
    kind: "send",

    settlesAt: "accepted",
    payload: { instanceId: id, message },
    legacy: () => {
      throw new Error("the legacy path must not run against a capable hub");
    },
  });
  expect(record(client, commandId).stage).toBe("submitted");

  // The hub validated it, found the machine, and relayed it as the `send` op.
  await until(
    () => record(client, commandId).stage === "accepted",
    "the accepted ack"
  );
  const relayed = daemon.received.find(
    (e) => e.verb === "send" && e.instanceId === id
  );
  expect(relayed?.machineId).toBe(MACHINE);
  expect(
    (relayed?.payload as { message?: unknown } | undefined)?.message
  ).toEqual(message);

  // Nothing the daemon returns confirms a `send`, so the hub must not claim it.
  await quiet();
  expect(record(client, commandId).stage).toBe("accepted");

  // The turn the command started comes back the only way it can be proven:
  // as a sequenced frame on the session's stream.
  daemon.emit(id, 1);
  await until(() => client.transcript(id).length === 1, "the reflecting frame");
  expect(client.applied.at(-1)?.source).toBe("stream");
  expect(client.state.cursors[id].lastSeq).toBe(1);

  await client.disconnect();
  daemon.close();
});

test("G3 a delivered send is finished at accepted, and the timeout sweep leaves it alone", async () => {
  const daemon = await openDaemon(MACHINE);
  const id = session("g3-settled");
  const client = makeClient();
  await client.connect();
  await until(() => client.state.capable, "capability");

  const commandId = `cmd-${crypto.randomUUID()}`;
  submitCommand(client.state, client.host, {
    commandId,
    sessionId: id,
    machineId: MACHINE,
    kind: "send",
    settlesAt: "accepted",
    payload: {
      instanceId: id,
      message: { type: "user", message: { role: "user", content: "hi" } },
    },
    legacy: () => {
      throw new Error("the legacy path must not run against a capable hub");
    },
  });
  await until(
    () => record(client, commandId).stage === "accepted",
    "the accepted ack"
  );

  // Long past the ack timeout. `accepted` is the hub's last word on a send —
  // nothing further is owed — so a sweep run here must not retro-declare a
  // message that landed a failure, and must not announce one either.
  sweepCommands(client.state, Date.now() + 60_000, client.host);
  expect(record(client, commandId).stage).toBe("accepted");
  expect(client.failures).toEqual([]);

  await client.disconnect();
  daemon.close();
});

test("G3 a control command with no answer IS called off by the sweep, and announced once", async () => {
  const daemon = await openDaemon(MACHINE);
  const id = session("g3-unanswered");
  const client = makeClient();
  await client.connect();
  await until(() => client.state.capable, "capability");

  const commandId = `cmd-${crypto.randomUUID()}`;
  submitCommand(client.state, client.host, {
    commandId,
    sessionId: id,
    machineId: MACHINE,
    kind: "set-model",
    settlesAt: "applied",
    payload: { args: ["opus"] },
    legacy: () => {
      throw new Error("the legacy path must not run against a capable hub");
    },
  });
  await until(() => record(client, commandId).stage === "accepted", "accepted");

  // The daemon never answers. A control command's last word is `applied`, so
  // this one really is unanswered and the sweep is right to end it.
  sweepCommands(client.state, Date.now() + 60_000, client.host);
  expect(record(client, commandId).stage).toBe("failed");
  expect(record(client, commandId).reason).toBe(
    "The hub never acknowledged that."
  );
  expect(client.failures.map((r) => r.commandId)).toEqual([commandId]);

  await client.disconnect();
  daemon.close();
});

test("G3 a send with no socket fails saying so, and says it exactly once", async () => {
  const id = session("g3-nosocket");
  const client = makeClient();
  await client.connect();
  await until(() => client.state.capable, "capability");
  // The hub is gone as far as this tab is concerned: the dispatch cannot leave.
  // The capability flag is put back deliberately — that is the real window this
  // covers: a tab that has already learnt the hub speaks the protocol, sending
  // between a dropped socket and the reconnect. Without it the submission would
  // take the legacy road and test a different failure.
  await client.disconnect();
  client.state.capable = true;

  const commandId = `cmd-${crypto.randomUUID()}`;
  submitCommand(client.state, client.host, {
    commandId,
    sessionId: id,
    machineId: MACHINE,
    kind: "send",
    settlesAt: "accepted",
    payload: {
      instanceId: id,
      message: { type: "user", message: { role: "user", content: "hi" } },
    },
    legacy: () => {
      throw new Error("the legacy path must not run against a capable hub");
    },
  });

  expect(record(client, commandId).stage).toBe("failed");
  expect(record(client, commandId).reason).toContain("Not connected");
  expect(client.failures.map((r) => r.commandId)).toEqual([commandId]);

  // Terminal is terminal, and announced once: a later sweep must not re-report it.
  sweepCommands(client.state, Date.now() + 60_000, client.host);
  expect(client.failures.length).toBe(1);
});

test("G3 a control command reaches applied only when the daemon answers it", async () => {
  const daemon = await openDaemon(MACHINE);
  const id = session("g3-ctl");
  const client = makeClient();
  await client.connect();
  await until(() => client.state.capable, "capability");
  client.watch([id]);
  await until(
    () => client.state.cursors[id]?.subscribed === true,
    "subscription"
  );

  const commandId = `cmd-${crypto.randomUUID()}`;
  submitCommand(client.state, client.host, {
    commandId,
    sessionId: id,
    machineId: MACHINE,
    kind: "interrupt",

    settlesAt: "applied",
    payload: { args: [] },
    legacy: () => {
      throw new Error("the legacy path must not run against a capable hub");
    },
  });

  await until(
    () => record(client, commandId).stage === "accepted",
    "the accepted ack"
  );
  const control = daemon.received.find(
    (e) => e.verb === "control" && e.instanceId === id
  );
  expect((control?.payload as { method?: string } | undefined)?.method).toBe(
    "interrupt"
  );
  const requestId = control?.requestId;
  expect(typeof requestId).toBe("string");

  // Still `accepted` until the machine says otherwise.
  await quiet();
  expect(record(client, commandId).stage).toBe("accepted");

  daemon.answerControl(requestId as string, true);
  await until(
    () => record(client, commandId).stage === "applied",
    "the applied ack"
  );

  // The reply answered a command; it is not fleet news broadcast at everyone.
  expect(client.applied.some((e) => e.frame.kind === "control_result")).toBe(
    false
  );

  await client.disconnect();
  daemon.close();
});

test("G3 a command the machine refuses ends failed with the reason, and stays failed", async () => {
  const daemon = await openDaemon(MACHINE);
  const id = session("g3-fail");
  const client = makeClient();
  await client.connect();
  await until(() => client.state.capable, "capability");

  const commandId = `cmd-${crypto.randomUUID()}`;
  submitCommand(client.state, client.host, {
    commandId,
    sessionId: id,
    machineId: MACHINE,
    kind: "set-model",

    settlesAt: "applied",
    payload: { args: ["opus"] },
    legacy: () => {
      throw new Error("the legacy path must not run against a capable hub");
    },
  });
  await until(() => record(client, commandId).stage === "accepted", "accepted");
  const control = daemon.received.find(
    (e) =>
      e.verb === "control" &&
      (e.payload as { method?: string }).method === "setModel"
  );
  daemon.answerControl(
    control?.requestId as string,
    false,
    "that model is not installed"
  );
  await until(
    () => record(client, commandId).stage === "failed",
    "the failed ack"
  );
  expect(record(client, commandId).reason).toBe("that model is not installed");

  await client.disconnect();
  daemon.close();
});

test("G3 a command for a machine that is not connected fails with the hub reason", async () => {
  const id = session("g3-offline");
  const client = makeClient();
  await client.connect();
  await until(() => client.state.capable, "capability");

  const commandId = `cmd-${crypto.randomUUID()}`;
  submitCommand(client.state, client.host, {
    commandId,
    sessionId: id,
    machineId: "no-such-machine",
    kind: "interrupt",

    settlesAt: "applied",
    payload: { args: [] },
    legacy: () => {
      throw new Error("the legacy path must not run against a capable hub");
    },
  });
  await until(
    () => record(client, commandId).stage === "failed",
    "the failure ack"
  );
  expect(record(client, commandId).reason).toContain("no-such-machine");
  await client.disconnect();
});

test("G3 a command outstanding when the socket dies is failed rather than left spinning", async () => {
  const daemon = await openDaemon(MACHINE);
  const id = session("g3-drop");
  const client = makeClient();
  await client.connect();
  await until(() => client.state.capable, "capability");

  const commandId = `cmd-${crypto.randomUUID()}`;
  submitCommand(client.state, client.host, {
    commandId,
    sessionId: id,
    machineId: MACHINE,
    kind: "interrupt",

    settlesAt: "applied",
    payload: { args: [] },
    legacy: () => {
      throw new Error("the legacy path must not run against a capable hub");
    },
  });
  await until(() => record(client, commandId).stage === "accepted", "accepted");

  await client.disconnect();
  expect(record(client, commandId).stage).toBe("failed");

  // A late `applied` for a command the hub can no longer deliver must not walk
  // a terminal stage backwards.
  const control = daemon.received.find(
    (e) => e.verb === "control" && e.instanceId === id
  );
  daemon.answerControl(control?.requestId as string, true);
  await quiet();
  expect(record(client, commandId).stage).toBe("failed");
  daemon.close();
});

/* ------------------------------------------------------------------ *
 * Pass 3: the seams a protocol like this actually breaks at
 * ------------------------------------------------------------------ */

test("the backlog/live boundary holds when frames keep arriving during the resubscribe", async () => {
  const daemon = await openDaemon(MACHINE);
  const id = session("boundary");
  const client = makeClient();
  await client.connect();
  await until(() => client.state.capable, "capability");
  client.watch([id]);
  await until(
    () => client.state.cursors[id]?.subscribed === true,
    "subscription"
  );

  await emitRun(daemon, id, 1, 40, () => client.transcript(id).length);
  await client.disconnect();
  await emitRun(daemon, id, 41, 40);

  // Reconnect and keep the daemon talking THROUGH the resume: the events
  // either side of the boundary seq must arrive exactly once each.
  const reconnected = client.connect();
  for (let ordinal = 81; ordinal <= 140; ordinal += 1) {
    daemon.emit(id, ordinal);
  }
  await reconnected;
  await emitRun(daemon, id, 141, 40);
  await until(
    () => client.transcript(id).length === 180,
    "every event either side of the seam"
  );
  await quiet();

  const ordinals = client.transcript(id);
  expect(ordinals.length).toBe(180);
  expect(contiguousFrom(ordinals, 1)).toBe(true);
  expect(client.state.cursors[id].lastSeq).toBe(180);
  expect(client.warnings).toEqual([]);

  await client.disconnect();
  daemon.close();
}, 30_000);

test("a resume whose afterSeq is exactly the ring floor replays whole", async () => {
  const daemon = await openDaemon(MACHINE);
  const id = session("floor");

  // A witness that never disconnects, so the test can know the hub's head.
  const witness = makeClient();
  await witness.connect();
  await until(() => witness.state.capable, "witness capability");
  witness.watch([id]);
  await until(
    () => witness.state.cursors[id]?.subscribed === true,
    "witness subscription"
  );

  const client = makeClient();
  await client.connect();
  await until(() => client.state.capable, "capability");
  client.watch([id]);
  await until(
    () => client.state.cursors[id]?.subscribed === true,
    "subscription"
  );

  await emitRun(daemon, id, 1, 5, () => client.transcript(id).length);
  await client.disconnect();
  expect(client.state.cursors[id].lastSeq).toBe(5);

  // RING_SIZE more: head 517, oldest 6 — the resume asks for exactly the
  // oldest event the ring still holds.
  await emitRun(daemon, id, 6, 512, () => witness.transcript(id).length - 5);

  await client.connect();
  await until(() => client.transcript(id).length === 517, "the whole replay");
  await quiet();
  expect(contiguousFrom(client.transcript(id), 1)).toBe(true);
  expect(client.inbox.some((m) => m.type === "stream.reset")).toBe(false);
  expect(client.rereads).toEqual([]);

  await client.disconnect();
  await witness.disconnect();
  daemon.close();
}, 40_000);

test("a resume one event below the ring floor is refused with a reset and healed by a re-read", async () => {
  const daemon = await openDaemon(MACHINE);
  const id = session("evicted");

  const witness = makeClient();
  await witness.connect();
  await until(() => witness.state.capable, "witness capability");
  witness.watch([id]);
  await until(
    () => witness.state.cursors[id]?.subscribed === true,
    "witness subscription"
  );

  const client = makeClient();
  await client.connect();
  await until(() => client.state.capable, "capability");
  client.watch([id]);
  await until(
    () => client.state.cursors[id]?.subscribed === true,
    "subscription"
  );

  await emitRun(daemon, id, 1, 5, () => client.transcript(id).length);
  await client.disconnect();

  // One past the floor: head 518, oldest 7, and the client is holding 5.
  await emitRun(daemon, id, 6, 513, () => witness.transcript(id).length - 5);

  await client.connect();
  await until(
    () => client.rereads.length === 1,
    "the honest refusal and its re-read"
  );
  const reset = client.inbox.find((m) => m.type === "stream.reset") as
    | { sessionId?: string; nextSeq?: number }
    | undefined;
  expect(reset?.sessionId).toBe(id);
  expect(reset?.nextSeq).toBe(519);
  // NOTHING was invented in between: the cursor jumped to the hub's truth.
  expect(client.state.cursors[id].lastSeq).toBe(518);
  expect(client.transcript(id)).toEqual([1, 2, 3, 4, 5]);

  // Deltas racing the re-read are contiguous with `nextSeq` and apply at once.
  await emitRun(daemon, id, 519, 10, () => client.transcript(id).length - 5);
  await quiet();
  expect(client.transcript(id)).toEqual([
    1,
    2,
    3,
    4,
    5,
    ...Array.from({ length: 10 }, (_, i) => 519 + i),
  ]);
  expect(client.state.cursors[id].lastSeq).toBe(528);
  expect(client.rereads).toEqual([id]);

  await client.disconnect();
  await witness.disconnect();
  daemon.close();
}, 40_000);

test("a gap invented on the wire is healed by exactly one resubscribe, not fifty", async () => {
  const daemon = await openDaemon(MACHINE);
  const id = session("gap");
  const client = makeClient();
  await client.connect();
  await until(() => client.state.capable, "capability");
  client.watch([id]);
  await until(
    () => client.state.cursors[id]?.subscribed === true,
    "subscription"
  );

  await emitRun(daemon, id, 1, 10, () => client.transcript(id).length);

  // A burst the client never sees, simulated by feeding its own routing deltas
  // from beyond the cursor — the hub's ring still holds the truth, so the
  // resubscribe this provokes is answered for real.
  const before = client.transcript(id).length;
  for (let seq = 20; seq < 30; seq += 1) {
    handleStreamMessage(client.state, client.host, {
      type: "stream.event",
      event: { seq, sessionId: id, frame: frameFor(id, seq) },
    });
  }
  await quiet();

  // One hole, one resume — ten out-of-order deltas are one hole, not ten asks.
  expect(
    client.outbox.filter(
      (m) => m.type === "stream.subscribe" && m.afterSeq === 10
    )
  ).toEqual([{ type: "stream.subscribe", sessionId: id, afterSeq: 10 }]);
  // And the hub answered it: an empty backlog, which heals the resync state.
  expect(client.state.cursors[id].resyncAfter).toBe(null);
  expect(client.transcript(id).length).toBe(before);
  expect(client.state.cursors[id].lastSeq).toBe(10);

  // And it is still following: the next real frame applies.
  daemon.emit(id, 11);
  await until(() => client.transcript(id).length === 11, "the next live frame");
  expect(contiguousFrom(client.transcript(id), 1)).toBe(true);

  await client.disconnect();
  daemon.close();
});

test("a broadcast kind the stream never carries still reaches the store on the legacy road", async () => {
  const daemon = await openDaemon(MACHINE);
  const id = session("learnt");
  const client = makeClient();
  await client.connect();
  await until(() => client.state.capable, "capability");
  client.watch([id]);
  await until(
    () => client.state.cursors[id]?.subscribed === true,
    "subscription"
  );

  await emitRun(daemon, id, 1, 3, () => client.transcript(id).length);
  // The stream has carried `frame` for this session, so the legacy copy of a
  // `frame` is now a duplicate...
  expect(client.state.cursors[id].streamed.has("frame")).toBe(true);

  // ...but a `permission_request` broadcasts rather than going through the
  // per-session relay the stream wraps, so it has NEVER been on the stream and
  // suppressing it would starve the rail. This is the whole reason the guard is
  // learnt per kind rather than assumed per session.
  daemon.raw({
    verb: "frames",
    machineId: MACHINE,
    instanceId: id,
    requestId: `ask-${crypto.randomUUID()}`,
    payload: {
      kind: "permission_request",
      instanceId: id,
      tool: "Bash",
      input: {},
    },
  });
  await until(
    () => client.applied.some((e) => e.frame.kind === "permission_request"),
    "the broadcast ask"
  );
  expect(
    client.applied.find((e) => e.frame.kind === "permission_request")?.source
  ).toBe("legacy");
  expect(client.state.cursors[id].streamed.has("permission_request")).toBe(
    false
  );
  // And it did not disturb the sequence.
  expect(client.state.cursors[id].lastSeq).toBe(3);

  await client.disconnect();
  daemon.close();
});

test("two sessions on one socket keep independent sequences", async () => {
  const daemon = await openDaemon(MACHINE);
  const first = session("pair-a");
  const second = session("pair-b");
  const client = makeClient();
  await client.connect();
  await until(() => client.state.capable, "capability");
  client.watch([first, second]);
  await until(
    () =>
      client.state.cursors[first]?.subscribed === true &&
      client.state.cursors[second]?.subscribed === true,
    "both subscriptions"
  );

  for (let ordinal = 1; ordinal <= 40; ordinal += 1) {
    daemon.emit(first, ordinal);
    daemon.emit(second, ordinal);
  }
  await until(
    () =>
      client.transcript(first).length === 40 &&
      client.transcript(second).length === 40,
    "both sessions"
  );
  await quiet();

  expect(contiguousFrom(client.transcript(first), 1)).toBe(true);
  expect(contiguousFrom(client.transcript(second), 1)).toBe(true);
  expect(client.state.cursors[first].lastSeq).toBe(40);
  expect(client.state.cursors[second].lastSeq).toBe(40);
  // Interleaved on one socket, and neither session ever saw the other's seq.
  expect(client.warnings).toEqual([]);

  await client.disconnect();
  daemon.close();
});

test("two dashboards following one session see byte-identical streams", async () => {
  const daemon = await openDaemon(MACHINE);
  const id = session("fanout");
  const a = makeClient();
  const b = makeClient();
  // a and b are independent clients with no shared state, so each one's
  // connect-then-subscribe sequence can run concurrently with the other's.
  await Promise.all(
    [a, b].map(async (client) => {
      await client.connect();
      await until(() => client.state.capable, "capability");
      client.watch([id]);
      await until(
        () => client.state.cursors[id]?.subscribed === true,
        "subscription"
      );
    })
  );

  await emitRun(daemon, id, 1, 60, () =>
    Math.min(a.transcript(id).length, b.transcript(id).length)
  );
  await quiet();

  expect(a.transcript(id)).toEqual(b.transcript(id));
  expect(a.applied.filter((e) => e.sessionId === id)).toEqual(
    b.applied.filter((e) => e.sessionId === id)
  );
  expect(a.state.cursors[id].lastSeq).toBe(b.state.cursors[id].lastSeq);

  await a.disconnect();
  await b.disconnect();
  daemon.close();
});
