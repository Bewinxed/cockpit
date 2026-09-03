/**
 * Deterministic gate for delegate-ask routing: a delegate's permission asks
 * route to its parent session, the parent answers them with `answer_delegate`,
 * and the user is only the fallback.
 *
 * Boots an ISOLATED hub on its own port with a scratch DB, then synthesizes
 * frames over fake agent/dashboard WebSockets — no model turns. Four scenarios:
 *   A  a parented delegate's question ask routes to its live parent (peer send
 *      with the machine-readable marker, a `routedTo: 'parent'` dashboard copy,
 *      and the ask still listed by /api/pending);
 *   B  a delegate with no live parent falls back to the untagged broadcast;
 *   C  `answerDelegate` emits the measured resolvePermission control shape;
 *   D  a parent's death re-broadcasts its delegate's parked ask untagged.
 *
 * Run with `bun routing-proof.ts`. Each failed assertion prints one JSON DIAG.
 */

import type { Envelope } from "@whiffle/core";
import { handoffActions } from "./src/harnesses/handoff-shared";

const PORT = 34_777;
const BASE = `http://localhost:${PORT}`;
const WS = `ws://localhost:${PORT}`;
const PROOF_DIR = "/tmp/whiffle-routing-proof";
const DB_PATH = `${PROOF_DIR}/whiffle.db`;
const HUB_ENTRY = new URL("../hub/src/index.ts", import.meta.url).pathname;

const M = "proof-machine";
const P_A = "parent-a";
const D_A = "delegate-a";
const REQ_A = "req-a";
const D_B = "delegate-b";
const REQ_B = "req-b";
const P_C = "parent-c";
const D_C = "delegate-c";
const REQ_C = "req-c";

const failures: string[] = [];
const check = (name: string, pass: boolean, diag?: unknown): void => {
  if (pass) {
    console.log(`PASS ${name}`);
  } else {
    failures.push(name);
    console.log(`FAIL ${name}`);
    console.log(
      `DIAG ${JSON.stringify({ assertion: name, ...(diag as object) })}`
    );
  }
};

const waitFor = async <T>(
  probe: () => T | Promise<T> | undefined,
  timeoutMs: number
): Promise<T | undefined> => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      // biome-ignore lint/performance/noAwaitInLoops: polls in order until the probe settles, no concurrent work to parallelize
      const value = await probe();
      if (value !== undefined) {
        return value;
      }
    } catch {
      /* the probe answered with an error — treat as not-yet */
    }
    await Bun.sleep(20);
  }
  return undefined;
};

const routedToOf = (env: Envelope): string | undefined =>
  (env.payload as { routedTo?: string }).routedTo;

const sendContentOf = (env: Envelope): string | undefined => {
  const content = (
    env.payload as { message?: { message?: { content?: unknown } } }
  ).message?.message?.content;
  return typeof content === "string" ? content : undefined;
};

const controlPayloadOf = (
  env: Envelope
): {
  instanceId?: string;
  requestId?: string;
  method?: string;
  args?: unknown[];
  from?: string;
} =>
  env.payload as {
    instanceId?: string;
    requestId?: string;
    method?: string;
    args?: unknown[];
    from?: string;
  };

await Bun.$`rm -rf ${PROOF_DIR}`.quiet().nothrow();
await Bun.$`mkdir -p ${PROOF_DIR}`.quiet();

const hub = Bun.spawn(["bun", HUB_ENTRY], {
  env: {
    ...Bun.env,
    WHIFFLE_DB_PATH: DB_PATH,
    WHIFFLE_HUB_PORT: String(PORT),
    WHIFFLE_NO_MDNS: "1",
  },
  stdout: "inherit",
  stderr: "inherit",
});

try {
  const up = await waitFor(async () => {
    const res = await fetch(`${BASE}/health`);
    return res.ok ? true : undefined;
  }, 10_000);
  check("hub boots on the isolated port", up === true);
  if (up !== true) {
    throw new Error("the isolated hub never came up");
  }

  const agentMessages: Envelope[] = [];
  const dashboardMessages: Envelope[] = [];

  const connect = (
    url: string,
    onMessage: (env: Envelope) => void
  ): Promise<WebSocket> => {
    const ws = new WebSocket(url);
    ws.addEventListener("message", (event) => {
      try {
        onMessage(JSON.parse(String(event.data)) as Envelope);
      } catch {
        /* ignore malformed */
      }
    });
    return new Promise((resolve, reject) => {
      ws.addEventListener("open", () => resolve(ws), { once: true });
      ws.addEventListener(
        "error",
        () => reject(new Error(`ws failed: ${url}`)),
        { once: true }
      );
    });
  };

  const agent = await connect(`${WS}/ws`, (env) => agentMessages.push(env));
  const dashboard = await connect(`${WS}/ws/dashboard`, (env) =>
    dashboardMessages.push(env)
  );

  const send = (ws: WebSocket, envelope: Envelope): void =>
    ws.send(JSON.stringify(envelope));

  send(agent, {
    verb: "register",
    machineId: M,
    payload: {
      hostname: "proof-host",
      os: "linux",
      auth: "authenticated",
      instances: [],
    },
  });
  const registered = await waitFor(async () => {
    const agents = (await fetch(`${BASE}/api/agents`).then((r) =>
      r.json()
    )) as {
      machineId: string;
    }[];
    return agents.some((a) => a.machineId === M) ? true : undefined;
  }, 5000);
  check("agent registers", registered === true);
  if (registered !== true) {
    throw new Error("the fake agent never registered");
  }

  const spawnInstance = (
    instanceId: string,
    cwd: string,
    parentId?: string
  ): void =>
    send(dashboard, {
      verb: "spawn",
      machineId: M,
      instanceId,
      payload: {
        instanceId,
        cwd,
        ...(parentId ? { parent: { instanceId: parentId } } : {}),
      },
    });

  const waitForInstance = (id: string): Promise<boolean> =>
    waitFor(async () => {
      const response = await fetch(`${BASE}/api/instances`);
      const rows = (await response.json()) as {
        id: string;
        parentInstanceId?: string | null;
      }[];
      return rows.some((r) => r.id === id) ? true : undefined;
    }, 5000).then((v) => v === true);

  const askQuestion = (
    instanceId: string,
    requestId: string,
    question: string,
    options: string[]
  ): void =>
    send(agent, {
      verb: "frames",
      machineId: M,
      instanceId,
      requestId,
      payload: {
        kind: "permission_request",
        instanceId,
        harness: "claude",
        requestId,
        toolName: "AskUserQuestion",
        input: {
          questions: [
            {
              question,
              header: "Choose",
              options: options.map((label) => ({ label, description: "" })),
              multiSelect: false,
            },
          ],
        },
        requestKind: "question",
      },
    });

  // ---- A: a parented delegate's ask routes to its live parent ----
  spawnInstance(P_A, "/tmp/x/parent-a");
  await waitForInstance(P_A);
  spawnInstance(D_A, "/tmp/x/delegate-a", P_A);
  const dA = await waitFor(async () => {
    const rows = (await fetch(`${BASE}/api/instances`).then((r) =>
      r.json()
    )) as {
      id: string;
      parentInstanceId?: string | null;
    }[];
    return rows.find((r) => r.id === D_A)?.parentInstanceId === P_A
      ? true
      : undefined;
  }, 5000);
  check("A: delegate D is parented to P", dA === true);

  askQuestion(D_A, REQ_A, "Which option?", ["Option A", "Option B"]);

  const routedSend = await waitFor(
    () => agentMessages.find((m) => m.verb === "send" && m.instanceId === P_A),
    5000
  );
  check("A: parent received a peer send", routedSend !== undefined);
  const aContent = routedSend ? sendContentOf(routedSend) : undefined;
  check(
    "A: send carries the delegate-ask marker with the exact requestId",
    (aContent ?? "").includes(
      `[delegate-ask instance=${D_A} request=${REQ_A}]`
    ),
    { content: aContent }
  );
  check(
    "A: send renders the question text verbatim",
    (aContent ?? "").includes("Which option?")
  );
  check(
    "A: send renders the option labels verbatim",
    (aContent ?? "").includes("Option A") &&
      (aContent ?? "").includes("Option B"),
    { content: aContent }
  );

  const aDash = await waitFor(
    () =>
      dashboardMessages.find(
        (m) => m.verb === "frames" && m.requestId === REQ_A
      ),
    5000
  );
  check(
    "A: dashboard copy carries routedTo=parent",
    aDash !== undefined && routedToOf(aDash) === "parent",
    {
      routedTo: aDash ? routedToOf(aDash) : undefined,
    }
  );

  const aPending = (await fetch(`${BASE}/api/pending`).then((r) =>
    r.json()
  )) as Envelope[];
  check(
    "A: /api/pending still lists the ask",
    aPending.some((p) => p.requestId === REQ_A)
  );

  // ---- B: a delegate with no live parent falls back untagged ----
  spawnInstance(D_B, "/tmp/x/delegate-b");
  await waitForInstance(D_B);
  askQuestion(D_B, REQ_B, "Fallback question?", ["Yes", "No"]);

  const bDash = await waitFor(
    () =>
      dashboardMessages.find(
        (m) => m.verb === "frames" && m.requestId === REQ_B
      ),
    5000
  );
  check(
    "B: fallback ask broadcast untagged",
    bDash !== undefined && routedToOf(bDash) === undefined,
    {
      routedTo: bDash ? routedToOf(bDash) : undefined,
    }
  );
  check(
    "B: no peer send synthesized for the fallback",
    !agentMessages.some(
      (m) =>
        m.verb === "send" &&
        (sendContentOf(m) ?? "").includes(`instance=${D_B}`)
    )
  );

  // ---- C: answerDelegate emits the measured resolvePermission shape ----
  Bun.env.WHIFFLE_HUB_URL = `${WS}/ws`;
  const emitted: Envelope[] = [];
  const actions = handoffActions({
    instanceId: P_A,
    cwd: "/tmp/x/parent-a",
    emit: (env) => emitted.push(env),
  });
  const reply = await actions.answerDelegate(D_A, REQ_A, {
    "Which option?": "Option A",
  });
  check(
    "C: answerDelegate resolves its own delegate",
    reply.includes(D_A) || reply.includes("delegate-a")
  );

  const control = emitted.find((e) => e.verb === "control");
  const cPayload = control ? controlPayloadOf(control) : undefined;
  check(
    "C: control targets the delegate with the ask requestId",
    control?.instanceId === D_A &&
      control?.requestId === REQ_A &&
      cPayload?.instanceId === D_A,
    { control }
  );
  check(
    "C: control method is resolvePermission",
    cPayload?.method === "resolvePermission",
    {
      method: cPayload?.method,
    }
  );
  const args = cPayload?.args as unknown[] | undefined;
  const result = args?.[1] as
    | { updatedInput?: { answers?: Record<string, string> } }
    | undefined;
  check("C: args carry the requestId", args?.[0] === REQ_A);
  check(
    "C: answers keyed by the exact question text",
    result?.updatedInput?.answers?.["Which option?"] === "Option A",
    { result }
  );
  check("C: control claims the parent as caller", cPayload?.from === P_A, {
    from: cPayload?.from,
  });

  // ---- D: a parent's death re-broadcasts its delegate's ask untagged ----
  spawnInstance(P_C, "/tmp/x/parent-c");
  await waitForInstance(P_C);
  spawnInstance(D_C, "/tmp/x/delegate-c", P_C);
  const dC = await waitFor(async () => {
    const rows = (await fetch(`${BASE}/api/instances`).then((r) =>
      r.json()
    )) as {
      id: string;
      parentInstanceId?: string | null;
    }[];
    return rows.find((r) => r.id === D_C)?.parentInstanceId === P_C
      ? true
      : undefined;
  }, 5000);
  check("D: delegate D is parented to P", dC === true);

  askQuestion(D_C, REQ_C, "Escalate me?", ["Keep", "Drop"]);
  const dRouted = await waitFor(
    () =>
      dashboardMessages.find(
        (m) =>
          m.verb === "frames" &&
          m.requestId === REQ_C &&
          routedToOf(m) === "parent"
      ),
    5000
  );
  check("D: ask routed while the parent is live", dRouted !== undefined);

  send(dashboard, {
    verb: "stop",
    machineId: M,
    instanceId: P_C,
    payload: { instanceId: P_C },
  });
  const dEscalated = await waitFor(
    () =>
      dashboardMessages
        .filter((m) => m.verb === "frames" && m.requestId === REQ_C)
        .some((m) => routedToOf(m) === undefined)
        ? true
        : undefined,
    5000
  );
  check("D: escalated ask re-broadcast untagged", dEscalated === true);

  agent.close();
  dashboard.close();
} finally {
  hub.kill();
  await hub.exited.catch(() => {
    // best effort: the process exits either way
  });
}

if (failures.length > 0) {
  console.log(`routing-proof: ${failures.length} FAIL`);
  process.exit(1);
}
console.log("routing-proof: all PASS");
process.exit(0);
