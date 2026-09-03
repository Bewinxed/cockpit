/**
 * THE INGEST LEDGER (sessiond design §7): the join between the two independent
 * monotonic sequences this system runs on — sessiond's per-child `srcSeq`
 * inside a per-boot `epoch`, and the hub's per-session `seq`.
 *
 * The invariant under test, verbatim from §7: a line becomes a hub frame AT
 * MOST ONCE per (instanceId, epoch, srcSeq), and a gap is ALWAYS an announced
 * reset, never a silent splice.
 *
 * The three restarts each break the join in their own way, so the property
 * sweep below crosses all of them with ring overflow: an agent restart loses
 * the cursor, a hub restart loses the ledger, a sessiond restart invalidates
 * both by minting a new epoch, and an overflow makes the requested replay
 * impossible. Everything the sweep exercises is production code — the hub's
 * real ledger (`createStreamHub`), the real `SessionRing` sessiond buffers
 * lines in, and the two rules `resumeCursor`/`alreadyIngested` that the agent's
 * `SessionSupervisor` reads on the other side of the wire.
 */
import { afterAll, expect, test } from "bun:test";
import {
  alreadyIngested,
  type Envelope,
  type FrameProvenance,
  type IngestMark,
  readIngested,
  readProvenance,
  resumeCursor,
  SessionRing,
} from "@whiffle/core";
import { makeDb } from "./db";
import type { PendingShape } from "./pending";
import type { HubSocket, RegistryShape } from "./registry";
import { createServer, reattachable } from "./server";
import { createStreamHub, type StreamPorts } from "./stream";

const INSTANCE = "inst-ledger";

const ports: StreamPorts = {
  setLegacySubscriptions: () => {
    // not exercised by this suite: the sweep never touches legacy subscriptions
  },
  isMachineConnected: () => true,
  relaySend: () => true,
  relayControl: () => true,
};

const hubs: ReturnType<typeof createStreamHub>[] = [];
/** A hub, or a hub's replacement after a restart: a brand new, empty ledger. */
const bootHub = (): ReturnType<typeof createStreamHub> => {
  const hub = createStreamHub(ports);
  hubs.push(hub);
  return hub;
};

// ---------------------------------------------------------------------------
// The two ends, modelled only in their plumbing — every RULE below is the real
// exported one.
// ---------------------------------------------------------------------------

/**
 * How many lines the sweep's sessiond keeps. The product's own bound is 4096
 * (`SESSIOND_RING_LINES`, design §6); this is deliberately tiny so an overflow
 * is reachable inside a test rather than only in production. The bound's value
 * is not what is under test — the behaviour at the bound is.
 */
const RING = 8;

interface Sessiond {
  /** Per boot, exactly as the daemon mints it. */
  epoch: string;
  ring: SessionRing;
  /** The child's own output counter, so a hole or a double is arithmetic. */
  written: number;
}

const bootSessiond = (): Sessiond => ({
  epoch: crypto.randomUUID(),
  ring: new SessionRing(RING),
  written: 0,
});

/** The child speaks; the ring fills whether or not an agent is listening. */
const speak = (daemon: Sessiond, lines: number): void => {
  for (let n = 0; n < lines; n += 1) {
    daemon.written += 1;
    daemon.ring.record(INSTANCE, { n: daemon.written });
  }
};

/** One line as the hub ends up filing it. */
interface Ingested {
  epoch: string;
  /** True for the `sessiond_stream_gap` system frame: an announcement, not a line. */
  gap?: boolean;
  /** The child's counter for that line — undefined for an announced seam. */
  n?: number;
  srcSeq: number;
}

/**
 * ONE AGENT LIFE.
 *
 * Attaches under whatever ack the current hub gave it, replays what the honest
 * -loss rule allows, then follows live. The forward decision and the cursor
 * decision are the production functions; nothing here re-implements either.
 */
const agentLife = (
  hub: ReturnType<typeof createStreamHub>,
  daemon: Sessiond,
  ackPayload: unknown,
  transcript: Ingested[],
  /** Lines the child writes while this agent is attached and following live. */
  liveLines: number,
  /**
   * How many already-forwarded lines this life re-sends before it ends — a
   * socket drop mid-forward, re-sent under the at-least-once retry of design
   * §8. The agent's own mark does not cover these (they are above it), so the
   * hub's ledger is the only thing standing between the operator and a
   * duplicated transcript.
   */
  resend = 0
): void => {
  const mark: IngestMark | undefined = readIngested(ackPayload)?.[INSTANCE];
  const cursor = resumeCursor(daemon.epoch, mark);

  const forward = (line: { seq: number; frame: unknown }): void => {
    const provenance: FrameProvenance = {
      srcEpoch: daemon.epoch,
      srcSeq: line.seq,
    };
    // The agent's half of at-most-once: never forward a line the hub itself
    // said it already has.
    if (alreadyIngested(mark, provenance)) {
      return;
    }
    const envelope = {
      verb: "frames",
      machineId: "machine-1",
      instanceId: INSTANCE,
      payload: {
        kind: "frame",
        instanceId: INSTANCE,
        message: line.frame,
        ...provenance,
      },
    };
    // The hub's half: the ledger decides, exactly as `server.ts` asks it to.
    if (!hub.admitFrame(INSTANCE, readProvenance(envelope))) {
      return;
    }
    hub.sequence(INSTANCE, envelope.payload);
    transcript.push({
      epoch: daemon.epoch,
      srcSeq: line.seq,
      n: (line.frame as { n: number }).n,
    });
  };

  if (cursor !== undefined) {
    if (daemon.ring.canReplay(cursor)) {
      for (const event of daemon.ring.since(cursor)) {
        forward(event);
      }
    } else {
      // sessiond's honest refusal (design §6). The agent does NOT splice: it
      // announces the seam and follows from head, which is what makes the hole
      // below legible instead of invisible.
      const nextSeq = daemon.ring.head + 1;
      hub.sequence(INSTANCE, {
        kind: "frame",
        instanceId: INSTANCE,
        message: { type: "system", subtype: "sessiond_stream_gap" },
      });
      transcript.push({ epoch: daemon.epoch, srcSeq: nextSeq - 1, gap: true });
    }
  }

  // Live: every line from here on, in order, through the same path.
  const live: { seq: number; frame: unknown }[] = [];
  for (let n = 0; n < liveLines; n += 1) {
    daemon.written += 1;
    daemon.ring.record(INSTANCE, { n: daemon.written });
    const line = { seq: daemon.ring.head, frame: { n: daemon.written } };
    live.push(line);
    forward(line);
  }
  for (const line of live.slice(-resend)) {
    forward(line);
  }
};

/** The register ack this hub would send for this instance, shape included. */
const ackFrom = (
  hub: ReturnType<typeof createStreamHub>
): { ok: true; ingested: Record<string, IngestMark> } => ({
  ok: true,
  ingested: hub.ingestedFor([INSTANCE]),
});

// ---------------------------------------------------------------------------
// G1: the sweep.
// ---------------------------------------------------------------------------

interface Case {
  /** Lines written while nobody is attached — the ring overflows above RING. */
  absence: number;
  agentRestarts: number;
  hubRestart: boolean;
  liveLines: number;
  resend: number;
  sessiondRestart: boolean;
}

const CASES: Case[] = [];
for (const agentRestarts of [1, 2]) {
  for (const hubRestart of [false, true]) {
    for (const sessiondRestart of [false, true]) {
      for (const absence of [3, 20]) {
        for (const liveLines of [2, 11]) {
          for (const resend of [0, 3]) {
            CASES.push({
              agentRestarts,
              hubRestart,
              sessiondRestart,
              absence,
              liveLines,
              resend,
            });
          }
        }
      }
    }
  }
}

const label = (c: Case): string =>
  `agent×${c.agentRestarts} hub${c.hubRestart ? "↺" : "="} sessiond${c.sessiondRestart ? "↺" : "="} absence:${c.absence}${c.absence > RING ? " (overflow)" : ""} live:${c.liveLines} resend:${c.resend}`;

test(`the sweep crosses agent × hub × sessiond restarts with ring overflow — ${CASES.length} cases`, () => {
  // Quoted in the leaf report; asserted so a dimension cannot be dropped
  // silently: 2 agent-restart counts × 2 hub × 2 sessiond × 2 absence (one of
  // them past the ring bound) × 2 live-line counts × 2 re-send tails.
  expect(CASES.length).toBe(64);
});

for (const scenario of CASES) {
  test(`at most once, and never a silent gap — ${label(scenario)}`, () => {
    let hub = bootHub();
    let daemon = bootSessiond();
    const transcript: Ingested[] = [];
    /** Where each hub's ledger began, so the invariant is read per hub life. */
    const hubEpochs: number[] = [0];

    // Life one: a fresh spawn sees its child from line 1.
    agentLife(
      hub,
      daemon,
      {
        ok: true,
        ingested: { [INSTANCE]: { epoch: daemon.epoch, srcSeq: 0 } },
      },
      transcript,
      4
    );

    for (let life = 0; life < scenario.agentRestarts; life += 1) {
      // THE ABSENCE. The child keeps talking to nobody.
      speak(daemon, scenario.absence);
      if (scenario.sessiondRestart && life === 0) {
        // sessiond restarted: the children died with it and came back under a
        // new epoch, so every cursor naming the old one is a dead cursor.
        daemon = bootSessiond();
        speak(daemon, 2);
      }
      if (scenario.hubRestart && life === 0) {
        hub = bootHub();
        hubEpochs.push(transcript.length);
      }
      agentLife(
        hub,
        daemon,
        ackFrom(hub),
        transcript,
        scenario.liveLines,
        scenario.resend
      );
    }

    // ---- AT MOST ONCE ---------------------------------------------------
    const keys = transcript
      .filter((e) => !e.gap)
      .map((e) => `${e.epoch}#${e.srcSeq}`);
    expect(new Set(keys).size).toBe(keys.length);
    // And the child's own counter never lands twice inside one sessiond boot,
    // which is the same statement read from the other end of the pipe.
    for (const epoch of new Set(transcript.map((e) => e.epoch))) {
      const ns = transcript
        .filter((e) => e.epoch === epoch && e.n !== undefined)
        .map((e) => e.n);
      expect(new Set(ns).size).toBe(ns.length);
    }

    // ---- NEVER A SILENT GAP ---------------------------------------------
    // Within one hub life and one sessiond epoch, consecutive ingested lines
    // are contiguous unless something announced the discontinuity: the
    // `sessiond_stream_gap` frame, or a fresh hub whose own seq restarts at 1
    // (which resets every follower's cursor by protocol).
    for (let i = 1; i < transcript.length; i += 1) {
      const previous = transcript[i - 1];
      const current = transcript[i];
      if (!(previous && current)) {
        continue; // unreachable: i ranges over transcript's own valid indices
      }
      if (current.epoch !== previous.epoch) {
        continue; // a new epoch is its own announcement
      }
      if (hubEpochs.includes(i)) {
        continue; // a hub restart: every cursor is dead
      }
      if (current.gap || previous.gap) {
        continue; // announced, in band
      }
      expect(current.srcSeq).toBe(previous.srcSeq + 1);
    }

    // ---- AND THE HUB ACTUALLY MOVED -------------------------------------
    // A test that ingested nothing would pass everything above. The final
    // agent life always writes `liveLines` lines nobody has seen.
    expect(hub.head(INSTANCE)).toBeGreaterThanOrEqual(scenario.liveLines);
  });
}

test("an overflow during the absence is announced in the stream, never spliced over", () => {
  const hub = bootHub();
  const daemon = bootSessiond();
  const transcript: Ingested[] = [];
  agentLife(hub, daemon, { ok: true, ingested: {} }, transcript, 3);
  // Far more than the ring holds: the mark the hub is about to hand back names
  // a line sessiond has since dropped.
  speak(daemon, RING * 4);
  agentLife(hub, daemon, ackFrom(hub), transcript, 1);

  const gap = transcript.find((entry) => entry.gap);
  expect(gap).toBeDefined();
  if (!gap) {
    throw new Error("unreachable: gap was just asserted defined");
  }
  // The seam is where the seam is: nothing between the mark and the ring's
  // surviving head was invented to cover it.
  const beforeGap = transcript[transcript.indexOf(gap) - 1];
  if (!beforeGap) {
    throw new Error(
      "unreachable: agentLife always logs a line before any gap it announces"
    );
  }
  expect(gap.srcSeq).toBeGreaterThan(beforeGap.srcSeq + 1);
});

// ---------------------------------------------------------------------------
// G2: the honest-loss rule, stated on its own.
// ---------------------------------------------------------------------------

test("no ledger entry means replay nothing and follow from head", () => {
  const daemon = bootSessiond();
  const hub = bootHub();
  // A hub that has never ingested this instance offers no mark at all — not a
  // zero mark, which would ask for everything.
  expect(hub.ingestedFor([INSTANCE])).toEqual({});
  expect(
    resumeCursor(daemon.epoch, readIngested(ackFrom(hub))?.[INSTANCE])
  ).toBeUndefined();
});

test("a mark from a dead sessiond epoch replays nothing", () => {
  const stale: IngestMark = { epoch: crypto.randomUUID(), srcSeq: 900 };
  expect(resumeCursor(crypto.randomUUID(), stale)).toBeUndefined();
  // The same mark under its own epoch is a cursor, not a refusal — the rule
  // discriminates on the epoch and nothing else.
  expect(resumeCursor(stale.epoch, stale)).toBe(900);
});

test("the ledger admits a new epoch at any seq, and refuses a replayed one", () => {
  const hub = bootHub();
  const first = crypto.randomUUID();
  expect(hub.admitFrame(INSTANCE, { srcEpoch: first, srcSeq: 5 })).toBe(true);
  expect(hub.admitFrame(INSTANCE, { srcEpoch: first, srcSeq: 5 })).toBe(false);
  expect(hub.admitFrame(INSTANCE, { srcEpoch: first, srcSeq: 4 })).toBe(false);
  expect(hub.admitFrame(INSTANCE, { srcEpoch: first, srcSeq: 6 })).toBe(true);
  // A new sessiond boot is a new sequence space: seq 1 is news again.
  expect(
    hub.admitFrame(INSTANCE, { srcEpoch: crypto.randomUUID(), srcSeq: 1 })
  ).toBe(true);
  // A frame that claims no provenance is never deduped — and retires the mark,
  // because whatever is producing it is not reading the ring any more.
  expect(hub.admitFrame(INSTANCE, undefined)).toBe(true);
  expect(hub.ingestedFor([INSTANCE])).toEqual({});
});

test("the mark is retired when a session stops being read off the ring", () => {
  const hub = bootHub();
  const epoch = crypto.randomUUID();
  hub.admitFrame(INSTANCE, { srcEpoch: epoch, srcSeq: 12 });
  expect(hub.ingestedFor([INSTANCE])[INSTANCE]).toEqual({ epoch, srcSeq: 12 });

  // THE BOUNDARY HAND-OFF: custody ends, a full SDK session takes over, and its
  // frames derive from no sessiond line. The hub stops offering a cursor rather
  // than offering one that now points into ground it covered another way.
  hub.admitFrame(INSTANCE, undefined);
  expect(hub.ingestedFor([INSTANCE])).toEqual({});
  // A later custody starts the ledger again from whatever it actually reads.
  hub.admitFrame(INSTANCE, { srcEpoch: epoch, srcSeq: 40 });
  expect(hub.ingestedFor([INSTANCE])[INSTANCE]).toEqual({ epoch, srcSeq: 40 });
});

test("a malformed provenance reads as absent, never as a mark", () => {
  expect(
    readProvenance({ payload: { srcEpoch: "", srcSeq: 3 } })
  ).toBeUndefined();
  expect(
    readProvenance({ payload: { srcEpoch: "e", srcSeq: 0 } })
  ).toBeUndefined();
  expect(
    readProvenance({ payload: { srcEpoch: "e", srcSeq: 1.5 } })
  ).toBeUndefined();
  expect(readProvenance({ srcEpoch: "e", srcSeq: 7 })).toEqual({
    srcEpoch: "e",
    srcSeq: 7,
  });
  expect(readProvenance({ payload: { srcEpoch: "e", srcSeq: 7 } })).toEqual({
    srcEpoch: "e",
    srcSeq: 7,
  });
});

// ---------------------------------------------------------------------------
// G4 (hub half): the wired hub — a real agent socket at a real `createServer`.
// ---------------------------------------------------------------------------

const DB_FILE = `/tmp/whiffle-ingest-${crypto.randomUUID()}.db`;
const db = makeDb(DB_FILE);
const MACHINE = `machine-ingest-${crypto.randomUUID()}`;
db.upsertAgent({
  machineId: MACHINE,
  hostname: "box",
  os: "linux",
  auth: "authenticated",
});

const registry: RegistryShape = (() => {
  const dashboards = new Map<
    string,
    { socket: HubSocket; subscriptions: Set<string> }
  >();
  const requesters = new Map<string, HubSocket>();
  return {
    registerAgent: () => {
      // not exercised by this suite: no machine connects through this registry
    },
    dropAgent: () => undefined,
    agent: () => undefined,
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
      // not exercised by this suite: no dashboard ever connects
    },
    dashboardOrigin: () => undefined,
    rememberRequester: (requestId, socket) => requesters.set(requestId, socket),
    takeRequester: (requestId) => {
      const socket = requesters.get(requestId);
      requesters.delete(requestId);
      return socket;
    },
  };
})();

const pending: PendingShape = {
  remember: () => {
    // not exercised by this suite: nothing goes pending
  },
  get: () => undefined,
  resolve: () => {
    // not exercised by this suite: nothing goes pending
  },
  forget: () => {
    // not exercised by this suite: nothing goes pending
  },
  list: () => [],
};

const app = createServer({ registry, db, pending }).listen(0);
const port = app.server?.port;

afterAll(async () => {
  for (const hub of hubs) {
    hub.stop();
  }
  app.stop();
  await Promise.all(
    ["", "-shm", "-wal"].map((suffix) =>
      Bun.file(`${DB_FILE}${suffix}`)
        .delete()
        .catch(() => {
          // best effort: a suffix may never have existed (no -wal/-shm if nothing was written)
        })
    )
  );
});

interface Wire {
  close: () => void;
  next: (
    match: (message: Record<string, unknown>) => boolean,
    label: string
  ) => Promise<Record<string, unknown>>;
  send: (message: unknown) => void;
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
      { once: true }
    );
  });
  return {
    send: (message) => socket.send(JSON.stringify(message)),
    next: async (match, why) => {
      for (let waited = 0; waited < 400; waited += 1) {
        const found = inbox.find(match);
        if (found) {
          return found;
        }
        // biome-ignore lint/performance/noAwaitInLoops: polling loop — each wait must see the effect of the previous one before deciding whether to keep polling.
        await Bun.sleep(5);
      }
      throw new Error(
        `timed out waiting for ${why}; inbox: ${JSON.stringify(inbox)}`
      );
    },
    close: () => socket.close(),
  };
};

const frameEnvelope = (
  instanceId: string,
  provenance: FrameProvenance,
  text: string
): Envelope => ({
  verb: "frames",
  machineId: MACHINE,
  instanceId,
  payload: {
    kind: "frame",
    instanceId,
    harness: "claude",
    message: { type: "system", subtype: "note", text },
    ...provenance,
  },
});

test("the register ack carries the ledger, and a replayed line is ingested once", async () => {
  const agent = await openSocket("/ws");
  const dashboard = await openSocket("/ws/dashboard");
  const instanceId = `wired-${crypto.randomUUID()}`;
  const epoch = crypto.randomUUID();

  agent.send({
    verb: "register",
    machineId: MACHINE,
    payload: {
      hostname: "box",
      os: "linux",
      auth: "authenticated",
      instances: [instanceId],
    },
  });
  const firstAck = await agent.next(
    (m) => m.verb === "register",
    "the register ack"
  );
  // Nothing ingested yet: an empty ledger, and — crucially — no zero marks.
  expect((firstAck.payload as { ok: boolean }).ok).toBe(true);
  expect(
    (firstAck.payload as { ingested?: Record<string, IngestMark> }).ingested
  ).toEqual({});

  dashboard.send({ type: "stream.subscribe", sessionId: instanceId });
  await Bun.sleep(30);

  for (const srcSeq of [1, 2, 3]) {
    agent.send(
      frameEnvelope(instanceId, { srcEpoch: epoch, srcSeq }, `line ${srcSeq}`)
    );
  }
  await dashboard.next(
    (m) => m.type === "stream.event" && (m.event as { seq: number }).seq === 3,
    "three sequenced frames"
  );

  // THE RESTART. The agent re-registers and is told exactly how far this hub
  // got — which is what it subscribes to sessiond with.
  agent.send({
    verb: "register",
    machineId: MACHINE,
    payload: {
      hostname: "box",
      os: "linux",
      auth: "authenticated",
      instances: [instanceId],
    },
  });
  const secondAck = await agent.next(
    (m) =>
      m.verb === "register" &&
      Object.keys((m.payload as { ingested: object }).ingested).length > 0,
    "the ack carrying the ledger"
  );
  expect(
    (secondAck.payload as { ingested: Record<string, IngestMark> }).ingested[
      instanceId
    ]
  ).toEqual({
    epoch,
    srcSeq: 3,
  });

  // An overshooting replay — the same lines again — is refused, and only the
  // line beyond the mark is sequenced. seq 4, never 4-through-7.
  for (const srcSeq of [2, 3, 4]) {
    agent.send(
      frameEnvelope(instanceId, { srcEpoch: epoch, srcSeq }, `replay ${srcSeq}`)
    );
  }
  const fourth = await dashboard.next(
    (m) => m.type === "stream.event" && (m.event as { seq: number }).seq === 4,
    "the one frame beyond the mark"
  );
  expect(
    (fourth.event as { frame: { message: { text: string } } }).frame.message
      .text
  ).toBe("replay 4");
  await Bun.sleep(30);
  // And nothing after it: the duplicates never became frames at all.
  await expect(
    dashboard.next(
      (m) =>
        m.type === "stream.event" && (m.event as { seq: number }).seq === 5,
      "a fifth frame"
    )
  ).rejects.toThrow();

  agent.close();
  dashboard.close();
}, 20_000);

test("the announced seam is relayed to a following dashboard like any other frame", async () => {
  const agent = await openSocket("/ws");
  const dashboard = await openSocket("/ws/dashboard");
  const instanceId = `seam-${crypto.randomUUID()}`;
  const epoch = crypto.randomUUID();

  dashboard.send({ type: "stream.subscribe", sessionId: instanceId });
  await Bun.sleep(30);

  agent.send(
    frameEnvelope(
      instanceId,
      { srcEpoch: epoch, srcSeq: 1 },
      "before the absence"
    )
  );
  // Exactly what the claude adapter emits on sessiond's `proc.reset` — a
  // system frame with no provenance of its own, because it is an announcement
  // about lines rather than one of them.
  agent.send({
    verb: "frames",
    machineId: MACHINE,
    instanceId,
    payload: {
      kind: "frame",
      instanceId,
      harness: "claude",
      message: {
        type: "system",
        subtype: "sessiond_stream_gap",
        text: "whiffle: sessiond's replay window overflowed; this transcript resumes at line 4321",
      },
    },
  });
  agent.send(
    frameEnvelope(
      instanceId,
      { srcEpoch: epoch, srcSeq: 4321 },
      "after the absence"
    )
  );

  const third = await dashboard.next(
    (m) => m.type === "stream.event" && (m.event as { seq: number }).seq === 3,
    "the three sequenced frames"
  );
  // The seam sits between the two lines it separates, in the operator's own
  // transcript. A jump from srcSeq 1 to 4321 is legible because of it.
  expect(
    (third.event as { frame: { message: { text: string } } }).frame.message.text
  ).toBe("after the absence");
  const seam = await dashboard.next(
    (m) => m.type === "stream.event" && (m.event as { seq: number }).seq === 2,
    "the seam frame"
  );
  expect(
    (seam.event as { frame: { message: { subtype: string } } }).frame.message
      .subtype
  ).toBe("sessiond_stream_gap");
  agent.close();
  dashboard.close();
}, 20_000);

// ---------------------------------------------------------------------------
// X3: THE REPLAY HALF. The wired test above registers with `instances: [id]` —
// a daemon that already holds the session. That is not the case replay is for.
//
// A daemon that just RESTARTED holds nothing, so its register names no
// instances at all, and the ack used to be computed off that empty list: `{}`,
// every reattach from head, every line sessiond buffered during the absence
// dropped. The hub's own restore is what tells that daemon the session exists,
// so the ledger has to cover the restores it just sent — that is
// {@link reattachable}, and this is the end-to-end proof of it.
// ---------------------------------------------------------------------------

test("a returning daemon that names nothing is still handed the ledger for the sessions it is restored", async () => {
  const agent = await openSocket("/ws");
  const dashboard = await openSocket("/ws/dashboard");
  const instanceId = `returning-${crypto.randomUUID()}`;
  const epoch = crypto.randomUUID();

  // A session this hub knows is running on that machine, with a conversation to
  // resume — i.e. one the restore path will try to bring back.
  db.openInstance({
    id: instanceId,
    machineId: MACHINE,
    cwd: "/tmp/x3-returning",
    sessionId: `sess-${crypto.randomUUID()}`,
    harness: "claude",
    kind: "mainline",
  });

  agent.send({
    verb: "register",
    machineId: MACHINE,
    payload: {
      hostname: "box",
      os: "linux",
      auth: "authenticated",
      instances: [instanceId],
    },
  });
  await agent.next((m) => m.verb === "register", "the first register ack");

  dashboard.send({ type: "stream.subscribe", sessionId: instanceId });
  await Bun.sleep(30);

  // The absence begins after line 2: this hub has ingested 1 and 2 and nothing
  // more, and sessiond goes on buffering 3, 4, 5 with nobody attached.
  for (const srcSeq of [1, 2]) {
    agent.send(
      frameEnvelope(instanceId, { srcEpoch: epoch, srcSeq }, `before ${srcSeq}`)
    );
  }
  await dashboard.next(
    (m) => m.type === "stream.event" && (m.event as { seq: number }).seq === 2,
    "the two frames before the absence"
  );

  // THE RESTART. A daemon whose supervisor is empty: `instances: []`, exactly
  // what `supervisor.instanceIds` returns one tick after boot.
  agent.send({
    verb: "register",
    machineId: MACHINE,
    payload: {
      hostname: "box",
      os: "linux",
      auth: "authenticated",
      instances: [],
    },
  });

  // The hub answers with BOTH halves of the circle, and the daemon needs both:
  // the restore spawn is the only place it learns the session's `cwd`, and the
  // ack is the only place it learns how far this hub got.
  const spawn = (await agent.next(
    (m) => m.verb === "spawn" && m.instanceId === instanceId,
    "the restore spawn"
  )) as { payload: { instanceId: string; cwd: string } };
  expect(spawn.payload.cwd).toBe("/tmp/x3-returning");

  const ack = await agent.next(
    (m) =>
      m.verb === "register" &&
      Object.keys((m.payload as { ingested?: object }).ingested ?? {}).includes(
        instanceId
      ),
    "the ack carrying the ledger for a session the daemon never named"
  );
  const mark = (ack.payload as { ingested: Record<string, IngestMark> })
    .ingested[instanceId];
  expect(mark).toEqual({ epoch, srcSeq: 2 });

  // AND IT IS ACTED ON. This is the agent's real code path: `readIngested` off
  // the ack, `resumeCursor` against sessiond's live epoch, and the replay that
  // cursor names — the gap the hub named, exactly.
  const cursor = resumeCursor(epoch, readIngested(ack.payload)?.[instanceId]);
  expect(cursor).toBe(2);
  if (cursor === undefined) {
    throw new Error("unreachable: cursor was just asserted to be 2");
  }
  // sessiond hands back 3, 4, 5 (`since(2)`), which the reattached agent
  // forwards; only they are news, and the ones already ingested stay refused.
  for (const srcSeq of [1, 2, 3, 4, 5]) {
    if (
      alreadyIngested({ epoch, srcSeq: cursor }, { srcEpoch: epoch, srcSeq })
    ) {
      continue;
    }
    agent.send(
      frameEnvelope(
        instanceId,
        { srcEpoch: epoch, srcSeq },
        `replayed ${srcSeq}`
      )
    );
  }

  const fifth = await dashboard.next(
    (m) => m.type === "stream.event" && (m.event as { seq: number }).seq === 5,
    "the three recovered lines"
  );
  expect(
    (fifth.event as { frame: { message: { text: string } } }).frame.message.text
  ).toBe("replayed 5");
  // Exactly the gap: hub seq 3, 4, 5 carry src 3, 4, 5. No duplicate of 1-2 got
  // in front of them, and nothing was spliced over.
  const third = await dashboard.next(
    (m) => m.type === "stream.event" && (m.event as { seq: number }).seq === 3,
    "the first recovered line"
  );
  expect(
    (third.event as { frame: { message: { text: string } } }).frame.message.text
  ).toBe("replayed 3");
  await Bun.sleep(30);
  await expect(
    dashboard.next(
      (m) =>
        m.type === "stream.event" && (m.event as { seq: number }).seq === 6,
      "a sixth frame"
    )
  ).rejects.toThrow();

  agent.close();
  dashboard.close();
}, 20_000);

test("the union is the reported sessions and the restored ones, de-duplicated", () => {
  expect(reattachable(["a", "b"], ["b", "c"])).toEqual(["a", "b", "c"]);
  // The returning daemon: nothing reported, everything restored.
  expect(reattachable([], ["c"])).toEqual(["c"]);
  // A machine with nothing to restore is exactly what it always was.
  expect(reattachable(["a"], [])).toEqual(["a"]);
});
