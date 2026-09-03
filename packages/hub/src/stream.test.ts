import { afterAll, expect, test } from "bun:test";
import type {
  ControlPayload,
  Envelope,
  SendPayload,
  SessionStreamEvent,
} from "@whiffle/core";
import { RESOLVE_PERMISSION, STREAM_V1 } from "@whiffle/core";
import { makeDb } from "./db";
import type { PendingShape } from "./pending";
import type { HubSocket, RegistryShape } from "./registry";
import { createServer } from "./server";
import {
  type ControlResultFrame,
  createStreamHub,
  RING_SIZE,
  type StreamPorts,
} from "./stream";

/**
 * The Ledger Protocol's hub half, on both levels it has to be right on:
 * the sequencer/ring/subscription machinery on its own, and the whole wired
 * hub — a real socket sending a real `stream.subscribe` and real command
 * envelopes at a real `createServer`.
 *
 * A scratch database, for the reason every other suite here keeps one: `bun
 * test` runs every file in one process, so a shared path is a shared race.
 */
const DB_FILE = `/tmp/whiffle-stream-${crypto.randomUUID()}.db`;
const db = makeDb(DB_FILE);

const MACHINE = "machine-1";
const OFFLINE = "machine-gone";
const SESSION = "session-1";

db.upsertAgent({
  machineId: MACHINE,
  hostname: "box",
  os: "linux",
  auth: "authenticated",
});

// ---------------------------------------------------------------------------
// Level 1: the module on its own.
// ---------------------------------------------------------------------------

interface FakeSocket extends HubSocket {
  readonly sent: unknown[];
}

const fakeSocket = (id: string, throwOnSend = false): FakeSocket => {
  const sent: unknown[] = [];
  return {
    id,
    sent,
    send: (data: unknown) => {
      if (throwOnSend) {
        throw new Error("socket is closed");
      }
      sent.push(data);
    },
  };
};

interface Harness {
  readonly connected: Set<string>;
  readonly hub: ReturnType<typeof createStreamHub>;
  readonly legacy: Map<string, string[]>;
  /** Makes the next relay refuse, the way `forward` does for a dead machine. */
  refuse: boolean;
  readonly relayed: { kind: "send" | "control"; envelope: Envelope }[];
}

const harness = (): Harness => {
  const legacy = new Map<string, string[]>();
  const relayed: { kind: "send" | "control"; envelope: Envelope }[] = [];
  const connected = new Set([MACHINE]);
  const state = { refuse: false };
  const ports: StreamPorts = {
    setLegacySubscriptions: (socket, ids) => legacy.set(socket.id, ids),
    isMachineConnected: (machineId) => connected.has(machineId),
    relaySend: (envelope) => {
      // biome-ignore lint/suspicious/noUnnecessaryConditions: `state.refuse` is mutated through the `refuse` setter on the returned harness, invisible to narrowing from this closure's initializer alone.
      if (state.refuse) {
        return false;
      }
      relayed.push({ kind: "send", envelope: envelope as Envelope });
      return true;
    },
    relayControl: (envelope) => {
      // biome-ignore lint/suspicious/noUnnecessaryConditions: `state.refuse` is mutated through the `refuse` setter on the returned harness, invisible to narrowing from this closure's initializer alone.
      if (state.refuse) {
        return false;
      }
      relayed.push({ kind: "control", envelope: envelope as Envelope });
      return true;
    },
  };
  const hub = createStreamHub(ports);
  hubs.push(hub);
  return {
    hub,
    legacy,
    relayed,
    connected,
    get refuse() {
      return state.refuse;
    },
    set refuse(value: boolean) {
      state.refuse = value;
    },
  };
};

const hubs: ReturnType<typeof createStreamHub>[] = [];

interface Delta {
  event: SessionStreamEvent;
  type: "stream.event";
}
interface Backlog {
  events: SessionStreamEvent[];
  sessionId: string;
  type: "stream.backlog";
}

/** Every message this socket was sent, in order, with its `type` narrowed. */
const typed = <T extends { type: string }>(
  socket: FakeSocket,
  type: T["type"]
): T[] =>
  socket.sent.filter((m): m is T => (m as { type?: string }).type === type);

test("the sequencer stamps 1..N per session and counts each session on its own", () => {
  const { hub } = harness();

  expect(hub.sequence("a", { n: 1 }).seq).toBe(1);
  expect(hub.sequence("a", { n: 2 }).seq).toBe(2);
  expect(hub.sequence("b", { n: 1 }).seq).toBe(1);
  expect(hub.sequence("a", { n: 3 }).seq).toBe(3);
  expect(hub.sequence("b", { n: 2 }).seq).toBe(2);

  expect(hub.head("a")).toBe(3);
  expect(hub.head("b")).toBe(2);
  expect(hub.head("never-relayed")).toBe(0);
  // The event carries the session it belongs to and the frame verbatim.
  expect(hub.sequence("a", { n: 4 })).toEqual({
    seq: 4,
    sessionId: "a",
    frame: { n: 4 },
  });
});

test("a session is sequenced whether or not anybody is following it", () => {
  const { hub } = harness();
  for (let n = 0; n < 3; n += 1) {
    hub.sequence(SESSION, { n });
  }

  const socket = fakeSocket("late");
  hub.handleClientMessage(socket, {
    type: "stream.subscribe",
    sessionId: SESSION,
  });

  // A fresh join asks for nothing and is told nothing: history comes through
  // the existing read paths.
  expect(socket.sent).toEqual([]);
  hub.sequence(SESSION, { n: 3 });
  expect(typed<Delta>(socket, "stream.event")).toEqual([
    {
      type: "stream.event",
      event: { seq: 4, sessionId: SESSION, frame: { n: 3 } },
    },
  ]);
});

test("a resume inside the ring answers with a contiguous backlog from afterSeq + 1", () => {
  const { hub } = harness();
  for (let n = 1; n <= 5; n += 1) {
    hub.sequence(SESSION, { n });
  }

  const socket = fakeSocket("resumer");
  hub.handleClientMessage(socket, {
    type: "stream.subscribe",
    sessionId: SESSION,
    afterSeq: 2,
  });

  const [backlog] = typed<Backlog>(socket, "stream.backlog");
  expect(backlog?.events.map((event) => event.seq)).toEqual([3, 4, 5]);
  expect(socket.sent.length).toBe(1);
});

test("a client already current gets an empty backlog rather than silence", () => {
  const { hub } = harness();
  hub.sequence(SESSION, { n: 1 });

  const socket = fakeSocket("current");
  hub.handleClientMessage(socket, {
    type: "stream.subscribe",
    sessionId: SESSION,
    afterSeq: 1,
  });

  expect(socket.sent).toEqual([
    { type: "stream.backlog", sessionId: SESSION, events: [] },
  ]);
});

test("a resume older than the ring answers with a reset naming the next seq", () => {
  const { hub } = harness();
  for (let n = 1; n <= RING_SIZE + 10; n += 1) {
    hub.sequence(SESSION, { n });
  }

  const socket = fakeSocket("too-old");
  // head = 522, so the oldest event still held is 11 and a client that has 9
  // is asking for an event that has been overwritten.
  hub.handleClientMessage(socket, {
    type: "stream.subscribe",
    sessionId: SESSION,
    afterSeq: 9,
  });

  expect(socket.sent).toEqual([
    { type: "stream.reset", sessionId: SESSION, nextSeq: RING_SIZE + 11 },
  ]);
});

test("the ring wraps without dropping a seq: the last RING_SIZE events still replay whole", () => {
  const { hub } = harness();
  for (let n = 1; n <= RING_SIZE + 10; n += 1) {
    hub.sequence(SESSION, { n });
  }

  const socket = fakeSocket("edge");
  // Exactly the oldest event the ring can still answer for.
  hub.handleClientMessage(socket, {
    type: "stream.subscribe",
    sessionId: SESSION,
    afterSeq: 10,
  });

  const [backlog] = typed<Backlog>(socket, "stream.backlog");
  expect(backlog?.events.length).toBe(RING_SIZE);
  expect(backlog?.events[0]).toEqual({
    seq: 11,
    sessionId: SESSION,
    frame: { n: 11 },
  });
  expect(backlog?.events.at(-1)?.seq).toBe(RING_SIZE + 10);
  // Contiguous ascending, no hole where the write pointer wrapped.
  const seqs = backlog?.events.map((event) => event.seq) ?? [];
  expect(
    seqs.every(
      (seq, index) =>
        index === 0 ||
        // biome-ignore lint/style/noNonNullAssertion: `index === 0 ||` short-circuits before this runs, so index - 1 is always a valid seqs index.
        seq === seqs[index - 1]! + 1
    )
  ).toBe(true);
});

test("a resume from a dead epoch — afterSeq past the head — answers with a reset, not a backlog", () => {
  const { hub } = harness();
  // A restarted hub counts from 1 again; the client still holds seq 900.
  for (let n = 1; n <= 3; n += 1) {
    hub.sequence(SESSION, { n });
  }

  const socket = fakeSocket("stale-epoch");
  hub.handleClientMessage(socket, {
    type: "stream.subscribe",
    sessionId: SESSION,
    afterSeq: 900,
  });

  expect(socket.sent).toEqual([
    { type: "stream.reset", sessionId: SESSION, nextSeq: 4 },
  ]);
});

test("a resume the client cannot express — a malformed afterSeq — answers with a reset", () => {
  const { hub } = harness();
  hub.sequence(SESSION, { n: 1 });

  const socket = fakeSocket("garbled");
  hub.handleClientMessage(socket, {
    type: "stream.subscribe",
    sessionId: SESSION,
    afterSeq: "two",
  });

  // Never silently re-joined from now: that would lose history the client
  // believes it is about to be handed.
  expect(socket.sent).toEqual([
    { type: "stream.reset", sessionId: SESSION, nextSeq: 2 },
  ]);
});

test("backlog and live delivery meet with no duplicate and no gap", () => {
  const { hub } = harness();
  for (let n = 1; n <= 5; n += 1) {
    hub.sequence(SESSION, { n });
  }

  const socket = fakeSocket("joiner");
  hub.handleClientMessage(socket, {
    type: "stream.subscribe",
    sessionId: SESSION,
    afterSeq: 2,
  });
  for (let n = 6; n <= 8; n += 1) {
    hub.sequence(SESSION, { n });
  }

  // What the client actually applies, in the order it arrives: the backlog's
  // events flattened, then every live delta.
  const applied: number[] = [];
  for (const message of socket.sent as (
    | { type: "stream.backlog"; events: { seq: number }[] }
    | { type: "stream.event"; event: { seq: number } }
  )[]) {
    if (message.type === "stream.backlog") {
      applied.push(...message.events.map((e) => e.seq));
    }
    if (message.type === "stream.event") {
      applied.push(message.event.seq);
    }
  }
  expect(applied).toEqual([3, 4, 5, 6, 7, 8]);
});

test("two sockets follow one session and each is told every event exactly once", () => {
  const { hub } = harness();
  hub.sequence(SESSION, { n: 1 });

  const first = fakeSocket("first");
  const second = fakeSocket("second");
  hub.handleClientMessage(first, {
    type: "stream.subscribe",
    sessionId: SESSION,
    afterSeq: 1,
  });
  hub.handleClientMessage(second, {
    type: "stream.subscribe",
    sessionId: SESSION,
  });
  // The same socket asking twice is still one follower.
  hub.handleClientMessage(second, {
    type: "stream.subscribe",
    sessionId: SESSION,
  });
  expect(hub.followerCount(SESSION)).toBe(2);

  hub.sequence(SESSION, { n: 2 });
  expect(typed(first, "stream.event").length).toBe(1);
  expect(typed(second, "stream.event").length).toBe(1);
  // And a session neither of them asked for reaches nobody.
  hub.sequence("other", { n: 1 });
  expect(typed(first, "stream.event").length).toBe(1);
});

test("a socket that closed stops following, and one that throws is dropped mid fan-out", () => {
  const { hub } = harness();
  const alive = fakeSocket("alive");
  const closing = fakeSocket("closing");
  const dead = fakeSocket("dead", true);

  for (const socket of [alive, closing, dead]) {
    hub.handleClientMessage(socket, {
      type: "stream.subscribe",
      sessionId: SESSION,
    });
  }
  expect(hub.followerCount(SESSION)).toBe(3);

  hub.dropSocket(closing.id);
  expect(hub.followerCount(SESSION)).toBe(2);

  // The throwing socket must not take the fan-out down with it.
  hub.sequence(SESSION, { n: 1 });
  expect(typed(alive, "stream.event").length).toBe(1);
  expect(closing.sent.length).toBe(0);
  expect(hub.followerCount(SESSION)).toBe(1);
});

test("a streamed session is subtracted from the legacy subscription set, both orders", () => {
  const { hub, legacy } = harness();
  const socket = fakeSocket("mixed");

  // Legacy set first, then the upgrade.
  expect(hub.noteLegacySubscriptions(socket, [SESSION, "other"])).toEqual([
    SESSION,
    "other",
  ]);
  hub.handleClientMessage(socket, {
    type: "stream.subscribe",
    sessionId: SESSION,
  });
  expect(legacy.get(socket.id)).toEqual(["other"]);

  // And a later re-statement of the whole set stays subtracted.
  expect(
    hub.noteLegacySubscriptions(socket, [SESSION, "other", "third"])
  ).toEqual(["other", "third"]);
});

test("a legacy subscribe that omits a streamed session does not silently unsubscribe it", () => {
  const { hub } = harness();
  const socket = fakeSocket("quiet");

  hub.handleClientMessage(socket, {
    type: "stream.subscribe",
    sessionId: SESSION,
  });
  // A client that follows the stream is free to stop declaring the legacy
  // subscription; reading that as "unsubscribe" would starve it in silence.
  expect(hub.noteLegacySubscriptions(socket, [])).toEqual([]);
  hub.sequence(SESSION, { n: 1 });

  expect(typed(socket, "stream.event").length).toBe(1);
});

test("a session gone quiet loses its replay window but never its sequence", () => {
  const { hub } = harness();
  for (let n = 1; n <= 5; n += 1) {
    hub.sequence(SESSION, { n });
  }

  // Far enough in the future that the ring has been silent past its idle life.
  expect(hub.sweepStale(Date.now() + 60 * 60_000)).toBe(1);
  // Twice is not twice the work: an already-empty ring is left alone.
  expect(hub.sweepStale(Date.now() + 60 * 60_000)).toBe(0);

  // The sequence carries on where it was — a follower never sees seq go
  // backwards because the hub tidied up behind it.
  expect(hub.sequence(SESSION, { n: 6 }).seq).toBe(6);

  const behind = fakeSocket("behind");
  hub.handleClientMessage(behind, {
    type: "stream.subscribe",
    sessionId: SESSION,
    afterSeq: 3,
  });
  expect(behind.sent).toEqual([
    { type: "stream.reset", sessionId: SESSION, nextSeq: 7 },
  ]);

  // And what survived the sweep still replays.
  const current = fakeSocket("current-after-sweep");
  hub.handleClientMessage(current, {
    type: "stream.subscribe",
    sessionId: SESSION,
    afterSeq: 5,
  });
  expect(
    typed<Backlog>(current, "stream.backlog")[0]?.events.map((e) => e.seq)
  ).toEqual([6]);
});

test("a command envelope of an unknown kind is refused by name", () => {
  const { hub } = harness();
  const socket = fakeSocket("bad-kind");

  expect(
    hub.handleClientMessage(socket, {
      type: "command",
      commandId: "c1",
      sessionId: SESSION,
      machineId: MACHINE,
      kind: "delete-everything",
      payload: {},
    })
  ).toBe(true);
  expect(socket.sent).toEqual([
    {
      type: "command.ack",
      commandId: "c1",
      stage: "failed",
      reason: "unknown command kind delete-everything",
    },
  ]);
});

test("a command may not smuggle a method its kind does not name", () => {
  const { hub, relayed } = harness();
  const socket = fakeSocket("smuggler");

  hub.handleClientMessage(socket, {
    type: "command",
    commandId: "c2",
    sessionId: SESSION,
    machineId: MACHINE,
    kind: "set-effort",
    payload: { method: "deleteSession", args: ["everything"] },
  });

  expect(socket.sent).toEqual([
    {
      type: "command.ack",
      commandId: "c2",
      stage: "failed",
      reason: "a set-effort command may not call deleteSession",
    },
  ]);
  expect(relayed).toEqual([]);
});

test("a command whose relay refuses it fails rather than sitting on an accepted it never earned", () => {
  const h = harness();
  const socket = fakeSocket("refused");
  h.refuse = true;

  h.hub.handleClientMessage(socket, {
    type: "command",
    commandId: "c3",
    sessionId: SESSION,
    machineId: MACHINE,
    kind: "interrupt",
    payload: {},
  });

  expect(socket.sent).toEqual([
    {
      type: "command.ack",
      commandId: "c3",
      stage: "failed",
      reason: `machine ${MACHINE} is not connected`,
    },
  ]);
  // And nothing is left waiting for a reply that can never come.
  expect(
    h.hub.settleCommand("any", {
      kind: "control_result",
      requestId: "any",
      ok: true,
    })
  ).toBe(false);
});

test("a command from a socket that follows no stream is still acknowledged, twice over", () => {
  const h = harness();
  // A dashboard that only ever commands: it has sent no `stream.subscribe` and
  // no legacy `subscribe`, so nothing else would have made the hub know it.
  const socket = fakeSocket("commands-only");

  h.hub.handleClientMessage(socket, {
    type: "command",
    commandId: "c5",
    sessionId: SESSION,
    machineId: MACHINE,
    kind: "set-permission-mode",
    payload: { args: ["plan"] },
  });
  // biome-ignore lint/correctness/noUnsafeOptionalChaining: h.relayed[0] is guaranteed to exist — the command dispatched immediately above is the only thing that can populate it.
  const { requestId } = h.relayed[0]?.envelope.payload as ControlPayload;
  expect(
    h.hub.settleCommand(requestId, {
      kind: "control_result",
      requestId,
      ok: true,
    })
  ).toBe(true);

  expect(socket.sent).toEqual([
    { type: "command.ack", commandId: "c5", stage: "accepted" },
    { type: "command.ack", commandId: "c5", stage: "applied" },
  ]);
});

test("the same permission answered twice in flight is refused the second time", () => {
  const h = harness();
  const socket = fakeSocket("double-click");
  const answer = {
    type: "command",
    sessionId: SESSION,
    machineId: MACHINE,
    kind: "permission.answer",
    payload: { requestId: "ask-1", args: ["ask-1", { behavior: "allow" }] },
  };

  h.hub.handleClientMessage(socket, { ...answer, commandId: "first" });
  h.hub.handleClientMessage(socket, { ...answer, commandId: "second" });

  expect(socket.sent).toEqual([
    { type: "command.ack", commandId: "first", stage: "accepted" },
    {
      type: "command.ack",
      commandId: "second",
      stage: "failed",
      reason: "that request is already being answered",
    },
  ]);
  // Dispatched once, so the parked ask is settled once.
  expect(h.relayed.length).toBe(1);

  // And once it has landed, answering again is the client's business, not a
  // collision: the ask is gone, so the machine's own refusal is the answer.
  h.hub.settleCommand("ask-1", {
    kind: "control_result",
    requestId: "ask-1",
    ok: true,
  });
  h.hub.handleClientMessage(socket, { ...answer, commandId: "third" });
  expect(socket.sent.at(-1)).toEqual({
    type: "command.ack",
    commandId: "third",
    stage: "accepted",
  });
});

test("a command whose socket dies before the daemon answers is consumed, not broadcast", () => {
  const h = harness();
  const socket = fakeSocket("vanishing");

  h.hub.handleClientMessage(socket, {
    type: "command",
    commandId: "c4",
    sessionId: SESSION,
    machineId: MACHINE,
    kind: "set-model",
    payload: { args: ["opus"] },
  });
  // biome-ignore lint/correctness/noUnsafeOptionalChaining: h.relayed[0] is guaranteed to exist — the command dispatched immediately above is the only thing that can populate it.
  const { requestId } = h.relayed[0]?.envelope.payload as ControlPayload;
  h.hub.dropSocket(socket.id);

  // Dropping the socket forgets what it was waiting for, so the reply falls
  // through to the legacy fan-out exactly as an unrouted control result does.
  const result: ControlResultFrame = {
    kind: "control_result",
    requestId,
    ok: true,
  };
  expect(h.hub.settleCommand(requestId, result)).toBe(false);
});

// ---------------------------------------------------------------------------
// Level 2: the wired hub — a real socket at a real `createServer`.
// ---------------------------------------------------------------------------

/** Faithful enough to route: the same semantics as the real registry's maps. */
const makeTestRegistry = (): RegistryShape & {
  readonly forwarded: Envelope[];
} => {
  const forwarded: Envelope[] = [];
  const agentSocket: HubSocket = {
    id: "agent-stub",
    send: (data: unknown) => forwarded.push(data as Envelope),
  };
  const dashboards = new Map<
    string,
    { socket: HubSocket; subscriptions: Set<string> }
  >();
  const requesters = new Map<string, HubSocket>();
  return {
    forwarded,
    registerAgent: () => {
      // stub: this suite routes by machineId → agentSocket directly, not the registry
    },
    dropAgent: () => undefined,
    agent: (machineId) => (machineId === MACHINE ? agentSocket : undefined),
    machineIds: () => [MACHINE],
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
    noteDashboardOrigin: () => {
      // stub: this suite never asserts on the dashboard origin
    },
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
  remember: () => {
    // stub: this suite never exercises pending-permission tracking
  },
  get: () => undefined,
  resolve: () => {
    // stub: this suite never exercises pending-permission tracking
  },
  forget: () => {
    // stub: this suite never exercises pending-permission tracking
  },
  list: () => [],
};

const registry = makeTestRegistry();
const app = createServer({ registry, db, pending }).listen(0);
const port = app.server?.port;

afterAll(async () => {
  for (const hub of hubs) {
    hub.stop();
  }
  app.stop();
  for (const suffix of ["", "-shm", "-wal"]) {
    // biome-ignore lint/performance/noAwaitInLoops: three fixed cleanup paths, sequential for simplicity in a teardown that runs once.
    await Bun.file(`${DB_FILE}${suffix}`)
      .delete()
      .catch(() => {
        // best effort: the file may never have been created (e.g. no -wal)
      });
  }
});

interface Wire {
  close: () => void;
  readonly inbox: Record<string, unknown>[];
  /** Waits for the first inbound message matching, and returns it. */
  next: (
    match: (message: Record<string, unknown>) => boolean,
    label: string
  ) => Promise<Record<string, unknown>>;
  send: (message: unknown) => void;
  readonly socket: WebSocket;
}

const openSocket = async (path: string): Promise<Wire> => {
  const socket = new WebSocket(`ws://localhost:${port}${path}`);
  const inbox: Record<string, unknown>[] = [];
  socket.addEventListener("message", (event) => {
    inbox.push(JSON.parse(String(event.data)) as Record<string, unknown>);
  });
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener(
      "error",
      () => reject(new Error(`could not open ${path}`)),
      {
        once: true,
      }
    );
  });
  return {
    inbox,
    socket,
    send: (message) => socket.send(JSON.stringify(message)),
    next: async (match, label) => {
      for (let waited = 0; waited < 400; waited += 1) {
        const found = inbox.find(match);
        if (found) {
          return found;
        }
        // biome-ignore lint/performance/noAwaitInLoops: polling loop — each wait must observe the inbox again before deciding whether to wait once more.
        await Bun.sleep(5);
      }
      throw new Error(
        `timed out waiting for ${label}; inbox: ${JSON.stringify(inbox)}`
      );
    },
    close: () => socket.close(),
  };
};

const isAck =
  (commandId: string, stage: string) => (message: Record<string, unknown>) =>
    message.type === "command.ack" &&
    message.commandId === commandId &&
    message.stage === stage;

test("the first message a dashboard receives carries the hub capabilities", async () => {
  const dashboard = await openSocket("/ws/dashboard");
  const first = await dashboard.next(
    (m) => m.verb === "frames",
    "the opening snapshot"
  );

  const payload = first.payload as {
    kind: string;
    capabilities?: string[];
    instances?: unknown[];
  };
  expect(payload.kind).toBe("instances");
  expect(payload.capabilities).toEqual([STREAM_V1]);
  // Unchanged in every other respect — a legacy client reads exactly the frame
  // it has always read.
  expect(Array.isArray(payload.instances)).toBe(true);
  dashboard.close();
});

test("a live frame reaches a stream subscriber sequenced, and a legacy subscriber unchanged", async () => {
  const modern = await openSocket("/ws/dashboard");
  const legacy = await openSocket("/ws/dashboard");
  const agent = await openSocket("/ws");
  await modern.next((m) => m.verb === "frames", "modern snapshot");
  await legacy.next((m) => m.verb === "frames", "legacy snapshot");

  const instanceId = `wired-${crypto.randomUUID()}`;
  legacy.send({
    verb: "subscribe",
    machineId: "",
    payload: { instanceIds: [instanceId] },
  });
  modern.send({
    verb: "subscribe",
    machineId: "",
    payload: { instanceIds: [instanceId] },
  });
  modern.send({ type: "stream.subscribe", sessionId: instanceId });
  await Bun.sleep(30);

  const frame = {
    kind: "frame",
    instanceId,
    harness: "claude",
    message: { type: "assistant", message: { role: "assistant", content: [] } },
  };
  agent.send({
    verb: "frames",
    machineId: MACHINE,
    instanceId,
    payload: frame,
  });

  const delta = await modern.next(
    (m) => m.type === "stream.event",
    "a sequenced delta"
  );
  expect(delta.event).toEqual({ seq: 1, sessionId: instanceId, frame });

  const relayed = await legacy.next(
    (m) =>
      m.verb === "frames" && (m.payload as { kind?: string }).kind === "frame",
    "the legacy relay"
  );
  expect(relayed.payload).toEqual(frame);

  // The stream subscriber was NOT also told in the old dialect.
  expect(
    modern.inbox.some(
      (m) =>
        m.verb === "frames" && (m.payload as { kind?: string }).kind === "frame"
    )
  ).toBe(false);

  modern.close();
  legacy.close();
  agent.close();
});

test("a send command reaches the machine as the relay op it names and stops at accepted", async () => {
  const dashboard = await openSocket("/ws/dashboard");
  await dashboard.next((m) => m.verb === "frames", "snapshot");
  const before = registry.forwarded.length;

  const message = { type: "user", message: { role: "user", content: "hello" } };
  dashboard.send({
    type: "command",
    commandId: "send-1",
    sessionId: SESSION,
    machineId: MACHINE,
    kind: "send",
    payload: { instanceId: SESSION, message },
  });

  await dashboard.next(isAck("send-1", "accepted"), "the send ack");
  const relayed = registry.forwarded
    .slice(before)
    .find((e) => e.verb === "send");
  expect(relayed?.instanceId).toBe(SESSION);
  expect(relayed?.machineId).toBe(MACHINE);
  // biome-ignore lint/correctness/noUnsafeOptionalChaining: `relayed` is asserted present by the two expects above — it comes from the same `find` result.
  expect((relayed?.payload as SendPayload).message).toEqual(
    message as SendPayload["message"]
  );

  // Nothing the daemon returns confirms a `send`, so nothing may claim it did.
  await Bun.sleep(30);
  expect(dashboard.inbox.some(isAck("send-1", "applied"))).toBe(false);
  dashboard.close();
});

test("each control command reaches the machine as its own method, and only its own", async () => {
  const dashboard = await openSocket("/ws/dashboard");
  await dashboard.next((m) => m.verb === "frames", "snapshot");
  const before = registry.forwarded.length;

  const cases: {
    kind: string;
    payload: Record<string, unknown>;
    method: string;
    args: unknown[];
  }[] = [
    { kind: "interrupt", payload: { args: [] }, method: "interrupt", args: [] },
    {
      kind: "set-model",
      payload: { args: ["opus"] },
      method: "setModel",
      args: ["opus"],
    },
    {
      kind: "set-permission-mode",
      payload: { args: ["plan"] },
      method: "setPermissionMode",
      args: ["plan"],
    },
    {
      kind: "set-effort",
      payload: { args: ["high"] },
      method: "setEffort",
      args: ["high"],
    },
    {
      kind: "permission.answer",
      payload: { requestId: "ask-9", args: ["ask-9", { behavior: "allow" }] },
      method: RESOLVE_PERMISSION,
      args: ["ask-9", { behavior: "allow" }],
    },
  ];

  for (const [index, entry] of cases.entries()) {
    dashboard.send({
      type: "command",
      commandId: `ctl-${index}`,
      sessionId: SESSION,
      machineId: MACHINE,
      kind: entry.kind,
      payload: entry.payload,
    });
    // biome-ignore lint/performance/noAwaitInLoops: each command is sent and acked before the next, so `controls` below reflects `cases`' order.
    await dashboard.next(
      isAck(`ctl-${index}`, "accepted"),
      `${entry.kind} accepted`
    );
  }

  const controls = registry.forwarded
    .slice(before)
    .filter((envelope) => envelope.verb === "control")
    .map((envelope) => envelope.payload as ControlPayload);
  expect(controls.map((payload) => payload.method)).toEqual(
    cases.map((entry) => entry.method)
  );
  expect(controls.map((payload) => payload.args)).toEqual(
    cases.map((entry) => entry.args)
  );
  expect(controls.every((payload) => payload.instanceId === SESSION)).toBe(
    true
  );
  // A permission answer is correlated by the id of the question it settles.
  expect(controls.at(-1)?.requestId).toBe("ask-9");
  dashboard.close();
});

test("a control command is applied when the daemon confirms it, in its own words when it will not", async () => {
  const dashboard = await openSocket("/ws/dashboard");
  const agent = await openSocket("/ws");
  await dashboard.next((m) => m.verb === "frames", "snapshot");
  const before = registry.forwarded.length;

  dashboard.send({
    type: "command",
    commandId: "applied-1",
    sessionId: SESSION,
    machineId: MACHINE,
    kind: "set-model",
    payload: { args: ["opus"] },
  });
  dashboard.send({
    type: "command",
    commandId: "refused-1",
    sessionId: SESSION,
    machineId: MACHINE,
    kind: "set-effort",
    payload: { args: ["nonsense"] },
  });
  await dashboard.next(isAck("refused-1", "accepted"), "both accepted");

  const controls = registry.forwarded
    .slice(before)
    .filter((envelope) => envelope.verb === "control")
    .map((envelope) => envelope.payload as ControlPayload);
  const [good, bad] = controls;
  if (!(good && bad)) {
    throw new Error(
      `expected both commands to have been forwarded; got ${controls.length}`
    );
  }

  agent.send({
    verb: "frames",
    machineId: MACHINE,
    instanceId: SESSION,
    requestId: good.requestId,
    payload: {
      kind: "control_result",
      instanceId: SESSION,
      requestId: good.requestId,
      ok: true,
    },
  });
  agent.send({
    verb: "frames",
    machineId: MACHINE,
    instanceId: SESSION,
    requestId: bad.requestId,
    payload: {
      kind: "control_result",
      instanceId: SESSION,
      requestId: bad.requestId,
      ok: false,
      error: "nonsense is not an effort level",
    },
  });

  await dashboard.next(isAck("applied-1", "applied"), "the applied ack");
  const failed = await dashboard.next(
    isAck("refused-1", "failed"),
    "the failed ack"
  );
  expect(failed.reason).toBe("nonsense is not an effort level");

  // The reply that became an ack is not ALSO relayed as a legacy control result.
  expect(
    dashboard.inbox.some(
      (m) =>
        m.verb === "frames" &&
        (m.payload as { kind?: string }).kind === "control_result"
    )
  ).toBe(false);

  dashboard.close();
  agent.close();
});

test("a command ack never steals the reply a legacy dashboard is waiting for", async () => {
  const legacy = await openSocket("/ws/dashboard");
  const modern = await openSocket("/ws/dashboard");
  const agent = await openSocket("/ws");
  await legacy.next((m) => m.verb === "frames", "snapshot");
  await modern.next((m) => m.verb === "frames", "snapshot");

  // The same permission id, answered the old way and the new way — the only
  // request id a client does not mint itself, so the only one that can collide.
  const requestId = `ask-${crypto.randomUUID()}`;
  const args = [requestId, { behavior: "allow" }];
  legacy.send({
    verb: "control",
    machineId: MACHINE,
    instanceId: SESSION,
    requestId,
    payload: {
      instanceId: SESSION,
      requestId,
      method: RESOLVE_PERMISSION,
      args,
    },
  });
  await Bun.sleep(30);
  modern.send({
    type: "command",
    commandId: "both-1",
    sessionId: SESSION,
    machineId: MACHINE,
    kind: "permission.answer",
    payload: {
      instanceId: SESSION,
      requestId,
      method: RESOLVE_PERMISSION,
      args,
    },
  });
  await modern.next(isAck("both-1", "accepted"), "the command ack");

  agent.send({
    verb: "frames",
    machineId: MACHINE,
    instanceId: SESSION,
    requestId,
    payload: {
      kind: "control_result",
      instanceId: SESSION,
      requestId,
      ok: true,
    },
  });

  // The new dialect gets its ack…
  await modern.next(isAck("both-1", "applied"), "the applied ack");
  // …and the old one still gets the reply it was routed, unchanged.
  const routed = await legacy.next(
    (m) =>
      m.verb === "frames" &&
      (m.payload as { kind?: string }).kind === "control_result",
    "the legacy control result"
  );
  expect(routed.payload).toEqual({
    kind: "control_result",
    instanceId: SESSION,
    requestId,
    ok: true,
  });

  legacy.close();
  modern.close();
  agent.close();
});

test("a command for a machine that is not connected fails with a reason a person can read", async () => {
  const dashboard = await openSocket("/ws/dashboard");
  await dashboard.next((m) => m.verb === "frames", "snapshot");
  const before = registry.forwarded.length;

  dashboard.send({
    type: "command",
    commandId: "gone-1",
    sessionId: SESSION,
    machineId: OFFLINE,
    kind: "interrupt",
    payload: {},
  });

  const ack = await dashboard.next(isAck("gone-1", "failed"), "the failed ack");
  expect(ack.reason).toBe(`machine ${OFFLINE} is not connected`);
  expect(registry.forwarded.length).toBe(before);
  dashboard.close();
});

test("a reconnecting client resumes the stream across the socket it lost", async () => {
  const first = await openSocket("/ws/dashboard");
  const agent = await openSocket("/ws");
  await first.next((m) => m.verb === "frames", "snapshot");

  const instanceId = `resume-${crypto.randomUUID()}`;
  first.send({ type: "stream.subscribe", sessionId: instanceId });
  await Bun.sleep(30);

  const frameAt = (n: number) => ({
    kind: "frame",
    instanceId,
    harness: "claude",
    message: {
      type: "assistant",
      message: { role: "assistant", content: [] },
      n,
    },
  });
  agent.send({
    verb: "frames",
    machineId: MACHINE,
    instanceId,
    payload: frameAt(1),
  });
  await first.next((m) => m.type === "stream.event", "the first delta");
  first.close();
  await Bun.sleep(30);

  // Three more frames while nobody is listening.
  for (let n = 2; n <= 4; n += 1) {
    agent.send({
      verb: "frames",
      machineId: MACHINE,
      instanceId,
      payload: frameAt(n),
    });
  }
  await Bun.sleep(30);

  const second = await openSocket("/ws/dashboard");
  await second.next((m) => m.verb === "frames", "snapshot");
  second.send({ type: "stream.subscribe", sessionId: instanceId, afterSeq: 1 });

  const backlog = await second.next(
    (m) => m.type === "stream.backlog",
    "the resume backlog"
  );
  expect(
    (backlog.events as { seq: number }[]).map((event) => event.seq)
  ).toEqual([2, 3, 4]);

  agent.send({
    verb: "frames",
    machineId: MACHINE,
    instanceId,
    payload: frameAt(5),
  });
  const delta = await second.next(
    (m) => m.type === "stream.event",
    "the delta after the backlog"
  );
  expect((delta.event as { seq: number }).seq).toBe(5);

  second.close();
  agent.close();
});
