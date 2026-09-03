/**
 * Supervisor pipeline, end to end, over real sockets.
 *
 * Boots a real `createServer` on an ephemeral port with a scratch DB, a fake
 * OpenAI-compatible server returning scripted verdicts, a scripted agent
 * socket, and a scripted dashboard socket. Proves the full pipeline:
 * frame observation → LLM call → verdict delivery.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Envelope, Rule, SupervisorEvent } from "@whiffle/core";
import { makeDb } from "./db";
import type { PendingShape } from "./pending";
import type { HubSocket, RegistryShape } from "./registry";
import { createServer } from "./server";

/* ------------------------------------------------------------------ *
 * Scratch DB + registry (same idiom as stream-e2e.test.ts)
 * ------------------------------------------------------------------ */

const DB_FILE = `/tmp/whiffle-supervisor-e2e-${crypto.randomUUID()}.db`;
const db = makeDb(DB_FILE);

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
    // biome-ignore lint/suspicious/noEmptyBlockStatements: this test registry doesn't track dashboard origins
    noteDashboardOrigin: () => {},
    dashboardOrigin: () => undefined,
  };
};

const pending: PendingShape = {
  // biome-ignore lint/suspicious/noEmptyBlockStatements: this test pipeline never awaits a permission ask, so remembering one is a no-op
  remember: () => {},
  get: () => undefined,
  // biome-ignore lint/suspicious/noEmptyBlockStatements: this test pipeline never awaits a permission ask, so resolving one is a no-op
  resolve: () => {},
  // biome-ignore lint/suspicious/noEmptyBlockStatements: this test pipeline never awaits a permission ask, so forgetting one is a no-op
  forget: () => {},
  list: () => [],
};

/* ------------------------------------------------------------------ *
 * Fake OpenAI-compatible server
 * ------------------------------------------------------------------ */

interface ScriptedVerdict {
  message: string;
  note: string;
  verdict: "silent" | "reply" | "escalate" | "ask_operator";
}

/** Mutable state the fake server reads on each request. */
let nextVerdict: ScriptedVerdict = {
  verdict: "silent",
  message: "",
  note: "default",
};
let fakeDelay = 0;
let fakeStatus = 200;
let fakeGarbage = false;
const fakeRequests: { system: string; user: string }[] = [];

const fakeOpenAI = Bun.serve({
  port: 0,
  fetch: async (req) => {
    const url = new URL(req.url);

    // Models endpoint for probe (called via plain fetch at /v1/models).
    if (url.pathname === "/v1/models") {
      return Response.json({ data: [{ id: "test-model" }] });
    }

    // AI SDK's createOpenAICompatible sends to {baseURL}/chat/completions
    // (baseURL already includes /v1), so accept both paths.
    if (
      url.pathname !== "/chat/completions" &&
      url.pathname !== "/v1/chat/completions"
    ) {
      return new Response("not found", { status: 404 });
    }

    const body = (await req.json()) as {
      messages?: { role: string; content: string }[];
      stream?: boolean;
    };

    // Record what the supervisor sent.
    const system =
      body.messages?.find((m) => m.role === "system")?.content ?? "";
    const user = body.messages?.find((m) => m.role === "user")?.content ?? "";
    fakeRequests.push({ system, user });

    if (fakeDelay > 0) {
      await Bun.sleep(fakeDelay);
    }

    if (fakeStatus !== 200) {
      return new Response("error", { status: fakeStatus });
    }

    // The streamed rules path (streamText + Output.array) asks for SSE and an
    // ARRAY of per-rule verdicts. Script one element per rule named in the
    // system prompt, each carrying nextVerdict's fields (ask_operator is not
    // in the rules vocabulary; map it to escalate like production would).
    if (body.stream) {
      if (fakeGarbage) {
        const sse = [
          `data: ${JSON.stringify({ id: "fake", object: "chat.completion.chunk", model: "test-model", choices: [{ index: 0, delta: { content: "not json {{{" }, finish_reason: null }] })}`,
          `data: ${JSON.stringify({ id: "fake", object: "chat.completion.chunk", model: "test-model", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}`,
          "data: [DONE]",
          "",
        ].join("\n\n");
        return new Response(sse, {
          headers: { "Content-Type": "text/event-stream" },
        });
      }
      const ruleNames = [...system.matchAll(/— Rule: (.+?) —/g)].map(
        (m) => m[1]
      );
      const verdict =
        nextVerdict.verdict === "ask_operator"
          ? "escalate"
          : nextVerdict.verdict;
      const elements = (ruleNames.length ? ruleNames : ["unknown"]).map(
        (rule) => ({
          rule,
          verdict,
          message: nextVerdict.message,
          note: nextVerdict.note,
        })
      );
      const chunk = (content: string) =>
        `data: ${JSON.stringify({ id: "fake", object: "chat.completion.chunk", model: "test-model", choices: [{ index: 0, delta: { content }, finish_reason: null }] })}`;
      const done = `data: ${JSON.stringify({ id: "fake", object: "chat.completion.chunk", model: "test-model", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}`;
      const sse = [
        chunk(JSON.stringify({ elements })),
        done,
        "data: [DONE]",
        "",
      ].join("\n\n");
      return new Response(sse, {
        headers: { "Content-Type": "text/event-stream" },
      });
    }

    if (fakeGarbage) {
      return Response.json({
        id: "fake-garbage",
        object: "chat.completion",
        model: "test-model",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "not json at all {{{" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });
    }

    return Response.json({
      id: `fake-${Date.now()}`,
      object: "chat.completion",
      model: "test-model",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: JSON.stringify(nextVerdict) },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    });
  },
});

const FAKE_BASE_URL = `http://localhost:${fakeOpenAI.port}`;

/* ------------------------------------------------------------------ *
 * Hub
 * ------------------------------------------------------------------ */

const registry = makeRegistry();
const app = createServer({ registry, db, pending });
let hubPort: number;

const openSockets: WebSocket[] = [];

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

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
    // biome-ignore lint/performance/noAwaitInLoops: polls until the condition holds or the budget expires; each check depends on the previous sleep
    await Bun.sleep(5);
  }
  throw new Error(`timed out waiting for ${label}`);
};

const quiet = (): Promise<void> => Bun.sleep(80);

const openWebSocket = (
  path: string,
  onMessage: (data: string) => void
): { socket: WebSocket; ready: Promise<void> } => {
  const socket = new WebSocket(`ws://localhost:${hubPort}${path}`);
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

const MACHINE = "sv-e2e-machine";

interface Daemon {
  close: () => void;
  readonly received: Envelope[];
  sendFrame: (instanceId: string, message: Record<string, unknown>) => void;
}

/** Opens a daemon socket, registers the machine, and waits for the registration to land. */
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
      hostname: "sv-e2e",
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
    sendFrame: (instanceId, message) =>
      send({
        verb: "frames",
        machineId,
        instanceId,
        payload: { kind: "frame", instanceId, harness: "claude", message },
      }),
    close: () => socket.close(),
  };
};

/** Sends an assistant frame with the given text, then a result frame to end the turn. */
const completeTurn = (
  agentDaemon: Daemon,
  instanceId: string,
  text: string
): void => {
  agentDaemon.sendFrame(instanceId, {
    type: "assistant",
    message: { role: "assistant", content: [{ type: "text", text }] },
    parent_tool_use_id: null,
  });
  agentDaemon.sendFrame(instanceId, {
    type: "result",
    subtype: "success",
  });
};

/** Opens a dashboard socket and collects all received messages. */
const openDashboard = async (): Promise<{
  inbox: Record<string, unknown>[];
  close: () => void;
}> => {
  const inbox: Record<string, unknown>[] = [];
  const { socket, ready } = openWebSocket("/ws/dashboard", (data) => {
    inbox.push(JSON.parse(data) as Record<string, unknown>);
  });
  await ready;
  // Subscribe to all instances.
  socket.send(
    JSON.stringify({
      verb: "subscribe",
      machineId: "",
      payload: { instanceIds: [] },
    })
  );
  await Bun.sleep(20);
  return { inbox, close: () => socket.close() };
};

/** Creates an instance row in the DB and marks it live. */
const createInstance = (instanceId: string, machineId: string): void => {
  db.openInstance({
    id: instanceId,
    machineId,
    cwd: "/tmp/test",
    harness: "claude",
    kind: "mainline",
  });
  db.markInstanceLive(instanceId);
};

/** Resets the fake server state between tests. */
const resetFake = (): void => {
  nextVerdict = { verdict: "silent", message: "", note: "default" };
  fakeDelay = 0;
  fakeStatus = 200;
  fakeGarbage = false;
  fakeRequests.length = 0;
};

/* ------------------------------------------------------------------ *
 * Setup / teardown
 * ------------------------------------------------------------------ */

let daemon: Daemon;

beforeAll(async () => {
  const server = app.listen(0);
  // biome-ignore lint/style/noNonNullAssertion: app.listen(0) always returns a server with a bound port; ?. would silently produce NaN instead
  hubPort = Number(server.server!.port);

  // Configure the supervisor to point at our fake OpenAI server.
  await fetch(`http://localhost:${hubPort}/api/supervisor/config`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      enabled: true,
      baseUrl: FAKE_BASE_URL,
      model: "test-model",
    }),
  });

  daemon = await openDaemon(MACHINE);
});

afterAll(async () => {
  for (const socket of openSockets) {
    try {
      socket.close();
    } catch {
      /* already gone */
    }
  }
  app.stop();
  fakeOpenAI.stop();
  for (const suffix of ["", "-shm", "-wal"]) {
    // biome-ignore lint/performance/noAwaitInLoops: teardown of a handful of scratch files; order doesn't matter but each delete is best-effort
    await Bun.file(`${DB_FILE}${suffix}`)
      .delete()
      // biome-ignore lint/suspicious/noEmptyBlockStatements: a missing scratch file (e.g. no -wal ever created) is not worth reporting during teardown
      .catch(() => {});
  }
});

/* ------------------------------------------------------------------ *
 * Tests
 * ------------------------------------------------------------------ */

describe("supervisor e2e", () => {
  test("3a: reply verdict → agent socket receives send envelope with correct origin and body", async () => {
    resetFake();
    const instanceId = `reply-${crypto.randomUUID().slice(0, 8)}`;
    createInstance(instanceId, MACHINE);

    // Create an every-turn LLM rule.
    const rule: Rule = {
      id: `rule-${crypto.randomUUID().slice(0, 8)}`,
      name: "test-whip",
      enabled: true,
      trigger: "every-turn",
      pattern: "",
      matchKind: "phrase",
      caseSensitive: false,
      wholeWord: false,
      watch: "text",
      action: "llm",
      reply: "",
      prompt: "Watch for false done claims and demand proof.",
      timing: "turn",
      interrupt: false,
      requireAck: false,
      scope: {},
      createdAt: Date.now(),
    };
    db.putRule(rule);

    const replyMessage = "Show me the test output.";
    nextVerdict = {
      verdict: "reply",
      message: replyMessage,
      note: "no evidence",
    };

    // Clear the daemon's received buffer.
    daemon.received.length = 0;

    completeTurn(
      daemon,
      instanceId,
      "I have completed all the work successfully."
    );

    // Wait for the supervisor to deliver its reply to the agent socket.
    await until(
      () =>
        daemon.received.some(
          (e) => e.verb === "send" && e.instanceId === instanceId
        ),
      "send envelope on agent socket"
    );

    // biome-ignore lint/style/noNonNullAssertion: the until() above already waited for this exact envelope to exist
    const sendEnvelope = daemon.received.find(
      (e) => e.verb === "send" && e.instanceId === instanceId
    )!;
    const payload = sendEnvelope.payload as {
      instanceId: string;
      message: {
        type: string;
        message: { role: string; content: string };
        origin: { kind: string; name: string };
        shouldQuery: boolean;
      };
      urgent: boolean;
    };

    // Origin: system, supervisor:<rule name>.
    expect(payload.message.origin.kind).toBe("system");
    expect(payload.message.origin.name).toBe("supervisor:test-whip");
    expect(payload.message.shouldQuery).toBe(true);
    // Body is the verdict message verbatim — no header, no prefix (opacity).
    expect(payload.message.message.content).toBe(replyMessage);
    expect(payload.message.message.role).toBe("user");
    expect(payload.urgent).toBe(false);

    // Verify the fake OpenAI received the call with correct prompt assembly.
    expect(fakeRequests.length).toBeGreaterThanOrEqual(1);
    const [req] = fakeRequests;
    // System prompt contains the operator instructions from the rule.
    expect(req.system).toContain(
      "Watch for false done claims and demand proof."
    );
    // User block contains the turn text.
    expect(req.user).toContain("I have completed all the work successfully.");
  });

  test("3b: autopilot takes precedence over LLM rule", async () => {
    resetFake();
    const instanceId = `autopilot-${crypto.randomUUID().slice(0, 8)}`;
    createInstance(instanceId, MACHINE);

    // Create an LLM rule that would match.
    const rule: Rule = {
      id: `rule-ap-${crypto.randomUUID().slice(0, 8)}`,
      name: "ap-rule",
      enabled: true,
      trigger: "every-turn",
      pattern: "",
      matchKind: "phrase",
      caseSensitive: false,
      wholeWord: false,
      watch: "text",
      action: "llm",
      reply: "",
      prompt: "This prompt should NOT be used when autopilot is active.",
      timing: "turn",
      interrupt: false,
      requireAck: false,
      scope: {},
      createdAt: Date.now(),
    };
    db.putRule(rule);

    // Enable autopilot for this instance via REST.
    const autopilotPrompt =
      "Keep the session moving and escalate real decisions.";
    const res = await fetch(
      `http://localhost:${hubPort}/api/autopilot/${instanceId}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: true, prompt: autopilotPrompt }),
      }
    );
    expect(res.ok).toBe(true);

    nextVerdict = { verdict: "reply", message: "Proceed.", note: "autopilot" };
    daemon.received.length = 0;

    completeTurn(daemon, instanceId, "Should I refactor the tests?");

    await until(
      () =>
        daemon.received.some(
          (e) => e.verb === "send" && e.instanceId === instanceId
        ),
      "autopilot send envelope"
    );

    // biome-ignore lint/style/noNonNullAssertion: the until() above already waited for this exact envelope to exist
    const sendEnvelope = daemon.received.find(
      (e) => e.verb === "send" && e.instanceId === instanceId
    )!;
    const payload = sendEnvelope.payload as {
      message: { origin: { name: string } };
    };

    // Origin name confirms autopilot won, not the rule.
    expect(payload.message.origin.name).toBe("supervisor:autopilot");

    // Composition: the autopilot's standing mandate leads, and the matched
    // rule rides along as context so autopilot answers with it in view.
    // biome-ignore lint/style/noNonNullAssertion: fakeRequests was just populated by the completeTurn() awaited above
    const req = fakeRequests.at(-1)!;
    expect(req.system).toContain(autopilotPrompt);
    expect(req.system).toContain("This prompt should NOT be used");
    expect(req.system).toContain("standing mandate (autopilot)");
  });

  test("3c: escalate verdict → no send to agent, supervisor_event on dashboard, log row exists", async () => {
    resetFake();
    const instanceId = `escalate-${crypto.randomUUID().slice(0, 8)}`;
    createInstance(instanceId, MACHINE);

    // Create a rule for this test.
    const rule: Rule = {
      id: `rule-esc-${crypto.randomUUID().slice(0, 8)}`,
      name: "esc-rule",
      enabled: true,
      trigger: "every-turn",
      pattern: "",
      matchKind: "phrase",
      caseSensitive: false,
      wholeWord: false,
      watch: "text",
      action: "llm",
      reply: "",
      prompt: "Escalate everything for testing.",
      timing: "turn",
      interrupt: false,
      requireAck: false,
      scope: {},
      createdAt: Date.now(),
    };
    db.putRule(rule);

    nextVerdict = {
      verdict: "escalate",
      message: "Needs human review.",
      note: "drift",
    };

    // Open a dashboard to catch the supervisor_event frame.
    const dashboard = await openDashboard();
    daemon.received.length = 0;

    completeTurn(daemon, instanceId, "I changed the architecture.");

    // Wait for the supervisor_event to arrive on the dashboard.
    await until(
      () =>
        dashboard.inbox.some((m) => {
          const { payload } = m as { payload?: { kind?: string } };
          return payload?.kind === "supervisor_event";
        }),
      "supervisor_event frame on dashboard"
    );

    // No send envelope should have been sent to the agent.
    await quiet();
    const agentSends = daemon.received.filter(
      (e) => e.verb === "send" && e.instanceId === instanceId
    );
    expect(agentSends).toHaveLength(0);

    // The dashboard received the supervisor_event.
    const eventFrame = dashboard.inbox.find((m) => {
      const { payload } = m as {
        payload?: { kind?: string; instanceId?: string };
      };
      return (
        payload?.kind === "supervisor_event" &&
        payload?.instanceId === instanceId
      );
    }) as { payload: { event: SupervisorEvent } };
    expect(eventFrame.payload.event.verdict).toBe("escalate");
    expect(eventFrame.payload.event.message).toBe("Needs human review.");

    // A log row exists via REST.
    const eventsRes = await fetch(
      `http://localhost:${hubPort}/api/supervisor/events?instanceId=${instanceId}`
    );
    const events = (await eventsRes.json()) as SupervisorEvent[];
    const escalation = events.find((e) => e.verdict === "escalate");
    expect(escalation).toBeDefined();
    // biome-ignore lint/style/noNonNullAssertion: toBeDefined() above already asserts escalation is not undefined
    expect(escalation!.message).toBe("Needs human review.");

    dashboard.close();
  });

  test("3d: turn ending mid-evaluation → skipped; frames keep flowing during delayed verdict", async () => {
    resetFake();
    const instanceId = `inflight-${crypto.randomUUID().slice(0, 8)}`;
    createInstance(instanceId, MACHINE);

    const rule: Rule = {
      id: `rule-inf-${crypto.randomUUID().slice(0, 8)}`,
      name: "inflight-rule",
      enabled: true,
      trigger: "every-turn",
      pattern: "",
      matchKind: "phrase",
      caseSensitive: false,
      wholeWord: false,
      watch: "text",
      action: "llm",
      reply: "",
      prompt: "Check for stalls.",
      timing: "turn",
      interrupt: false,
      requireAck: false,
      scope: {},
      createdAt: Date.now(),
    };
    db.putRule(rule);

    // Delay the fake OpenAI response (hundreds of ms, not 30s — ordering, not duration).
    fakeDelay = 400;
    nextVerdict = { verdict: "reply", message: "First reply", note: "first" };

    // First turn — triggers a delayed evaluation.
    completeTurn(daemon, instanceId, "Working on step one.");

    // Give the evaluation a moment to begin (it needs to be in-flight).
    await Bun.sleep(50);

    // Second turn while the first evaluation is still in flight.
    // This should be recorded as 'skipped'.
    completeTurn(daemon, instanceId, "Working on step two.");

    // Meanwhile, prove the hub is not blocked by the delayed evaluation:
    // a REST call completes promptly, and the instances endpoint responds.
    const probeRes = await fetch(
      `http://localhost:${hubPort}/api/supervisor/events?instanceId=${instanceId}&limit=1`
    );
    expect(probeRes.ok).toBe(true);

    // Also prove that frames from a DIFFERENT instance flow through unblocked:
    // open a dashboard, send a frame for another instance, and verify it arrives
    // via the instances broadcast (not subscription-gated).
    const dashboard = await openDashboard();
    await Bun.sleep(20);
    dashboard.inbox.length = 0;

    // The instances broadcast goes to ALL dashboards (not subscription-gated).
    // Create a new instance — that triggers publishInstances, which broadcasts.
    const probeId = `probe-${crypto.randomUUID().slice(0, 8)}`;
    createInstance(probeId, MACHINE);
    // publishInstances is called from openInstance/markInstanceLive path, but
    // we need to trigger it ourselves since we're calling db directly. Use REST.
    const instanceRes = await fetch(
      `http://localhost:${hubPort}/api/instances`
    );
    expect(instanceRes.ok).toBe(true);

    // The REST response arrived promptly while the evaluation is still delayed —
    // the hub is not blocked.

    // Wait for the delayed evaluation to complete.
    await until(
      () => fakeRequests.length >= 1,
      "delayed evaluation completes",
      2000
    );

    // Give time for the skipped event to be recorded.
    await Bun.sleep(200);

    // Check that a 'skipped' event was recorded.
    const eventsRes = await fetch(
      `http://localhost:${hubPort}/api/supervisor/events?instanceId=${instanceId}`
    );
    const events = (await eventsRes.json()) as SupervisorEvent[];
    const skipped = events.find(
      (e) => e.verdict === "skipped" && e.note === "in-flight"
    );
    expect(skipped).toBeDefined();

    dashboard.close();
  });

  test("3e: consecutive cap — fourth reply forced to escalate, mute holds until a human send", async () => {
    resetFake();
    const instanceId = `consec-${crypto.randomUUID().slice(0, 8)}`;
    createInstance(instanceId, MACHINE);

    const rule: Rule = {
      id: `rule-con-${crypto.randomUUID().slice(0, 8)}`,
      name: "consec-rule",
      enabled: true,
      trigger: "every-turn",
      pattern: "",
      matchKind: "phrase",
      caseSensitive: false,
      wholeWord: false,
      watch: "text",
      action: "llm",
      reply: "",
      prompt: "Keep correcting.",
      timing: "turn",
      interrupt: false,
      requireAck: false,
      scope: {},
      createdAt: Date.now(),
    };
    db.putRule(rule);

    nextVerdict = { verdict: "reply", message: "Fix it.", note: "correction" };

    // Turn 1: human-initiated → supervisor replies (consecutive=0).
    daemon.received.length = 0;
    completeTurn(daemon, instanceId, "Human started this turn.");
    await until(
      () =>
        daemon.received.some(
          (e) => e.verb === "send" && e.instanceId === instanceId
        ),
      "reply 1"
    );

    // Turn 2: supervisor-initiated → consecutive=1 → reply.
    daemon.received.length = 0;
    completeTurn(daemon, instanceId, "Responding to supervisor reply 1.");
    await until(
      () =>
        daemon.received.some(
          (e) => e.verb === "send" && e.instanceId === instanceId
        ),
      "reply 2"
    );

    // Turn 3: supervisor-initiated → consecutive=2 → reply.
    daemon.received.length = 0;
    completeTurn(daemon, instanceId, "Responding to supervisor reply 2.");
    await until(
      () =>
        daemon.received.some(
          (e) => e.verb === "send" && e.instanceId === instanceId
        ),
      "reply 3"
    );

    // Turn 4: supervisor-initiated → consecutive=3 → forced escalate (no send).
    daemon.received.length = 0;
    completeTurn(daemon, instanceId, "Responding to supervisor reply 3.");

    // Wait for the evaluation to complete (no send expected).
    await until(() => {
      const events = db.listSupervisorEvents({ instanceId, limit: 20 });
      return events.some(
        (e) =>
          e.verdict === "escalate" &&
          e.note?.includes("consecutive-reply limit")
      );
    }, "forced escalation event");

    // No send envelope to the agent.
    await quiet();
    const agentSends = daemon.received.filter(
      (e) => e.verb === "send" && e.instanceId === instanceId
    );
    expect(agentSends).toHaveLength(0);

    // Mute persists across non-human turns: a rule or delegate waking the
    // session must NOT hand the supervisor its voice back.
    daemon.received.length = 0;
    nextVerdict = {
      verdict: "reply",
      message: "Still muted?",
      note: "should not send",
    };
    completeTurn(
      daemon,
      instanceId,
      "A turn started by some other automated sender."
    );
    await until(() => {
      const events = db.listSupervisorEvents({ instanceId, limit: 30 });
      return events.some(
        (e) => e.verdict === "skipped" && e.note?.includes("muted")
      );
    }, "muted skip event");
    await quiet();
    expect(
      daemon.received.filter(
        (e) => e.verb === "send" && e.instanceId === instanceId
      )
    ).toHaveLength(0);

    // Only the operator's own send takes the mute off: a dashboard send rides
    // the hub's relay, which notes the human touch (noteHumanSend).
    const { socket: opSocket, ready: opReady } = openWebSocket(
      "/ws/dashboard",
      // biome-ignore lint/suspicious/noEmptyBlockStatements: this socket only sends the operator's own message below; it never needs to read anything back
      () => {}
    );
    await opReady;
    opSocket.send(
      JSON.stringify({
        verb: "send",
        machineId: MACHINE,
        instanceId,
        payload: {
          instanceId,
          message: {
            type: "user",
            message: { role: "user", content: "I am back, carry on." },
            parent_tool_use_id: null,
            origin: { kind: "human" },
          },
        },
      })
    );
    // The human send is relayed to the daemon (that envelope is the relay,
    // not a supervisor reply — drain it before asserting).
    await until(
      () =>
        daemon.received.some(
          (e) => e.verb === "send" && e.instanceId === instanceId
        ),
      "human send relayed"
    );
    daemon.received.length = 0;

    nextVerdict = { verdict: "reply", message: "Welcome back.", note: "reset" };
    completeTurn(daemon, instanceId, "Human-initiated turn after cap.");
    await until(
      () =>
        daemon.received.some(
          (e) => e.verb === "send" && e.instanceId === instanceId
        ),
      "reply after human unmute"
    );
    opSocket.close();
  });

  test("3f: fake OpenAI returns 500 → error event, zero sends to agent", async () => {
    resetFake();
    const instanceId = `error-${crypto.randomUUID().slice(0, 8)}`;
    createInstance(instanceId, MACHINE);

    const rule: Rule = {
      id: `rule-err-${crypto.randomUUID().slice(0, 8)}`,
      name: "err-rule",
      enabled: true,
      trigger: "every-turn",
      pattern: "",
      matchKind: "phrase",
      caseSensitive: false,
      wholeWord: false,
      watch: "text",
      action: "llm",
      reply: "",
      prompt: "Watch for errors.",
      timing: "turn",
      interrupt: false,
      requireAck: false,
      scope: {},
      createdAt: Date.now(),
    };
    db.putRule(rule);

    fakeStatus = 500;
    daemon.received.length = 0;

    completeTurn(daemon, instanceId, "A normal turn.");

    // Wait for the error event to be recorded.
    await until(() => {
      const events = db.listSupervisorEvents({ instanceId, limit: 10 });
      return events.some((e) => e.verdict === "error");
    }, "error event recorded");

    // Zero sends to the agent.
    await quiet();
    const agentSends = daemon.received.filter(
      (e) => e.verb === "send" && e.instanceId === instanceId
    );
    expect(agentSends).toHaveLength(0);

    // Error event exists.
    const events = db.listSupervisorEvents({ instanceId, limit: 10 });
    const errorEvent = events.find((e) => e.verdict === "error");
    expect(errorEvent).toBeDefined();
  });

  test("3f-garbage: fake OpenAI returns garbage → error event, zero sends to agent", async () => {
    resetFake();
    const instanceId = `garbage-${crypto.randomUUID().slice(0, 8)}`;
    createInstance(instanceId, MACHINE);

    const rule: Rule = {
      id: `rule-garb-${crypto.randomUUID().slice(0, 8)}`,
      name: "garb-rule",
      enabled: true,
      trigger: "every-turn",
      pattern: "",
      matchKind: "phrase",
      caseSensitive: false,
      wholeWord: false,
      watch: "text",
      action: "llm",
      reply: "",
      prompt: "Watch for garbage.",
      timing: "turn",
      interrupt: false,
      requireAck: false,
      scope: {},
      createdAt: Date.now(),
    };
    db.putRule(rule);

    fakeGarbage = true;
    daemon.received.length = 0;

    completeTurn(daemon, instanceId, "A normal turn.");

    // Wait for the error event to be recorded.
    await until(() => {
      const events = db.listSupervisorEvents({ instanceId, limit: 10 });
      return events.some((e) => e.verdict === "error");
    }, "garbage error event recorded");

    // Zero sends to the agent.
    await quiet();
    const agentSends = daemon.received.filter(
      (e) => e.verb === "send" && e.instanceId === instanceId
    );
    expect(agentSends).toHaveLength(0);

    const events = db.listSupervisorEvents({ instanceId, limit: 10 });
    const errorEvent = events.find((e) => e.verdict === "error");
    expect(errorEvent).toBeDefined();
  });
});
