/**
 * CUSTODY — the claude session while the agent that owned it is gone
 * (sessiond design §4.1).
 *
 * The child outlived the agent. There is no `Query` any more, so everything the
 * `Query` used to do has to be done from raw lines: frames re-derived through
 * the pure `toNeutral`, permissions re-parked under the SDK's own `requestId`
 * and answered with a raw `control_response`, and every OTHER control refused
 * out loud so a tool call fails where the reader can see it instead of hanging
 * on a handler that died.
 *
 * Driven against a recorded fixture rather than hand-built objects: the lines
 * are the ones a CLI actually writes (see the fixture's own provenance header),
 * and a shape that drifts should break this test, not survive it.
 */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// The adapter answers permissions in the SDK's own `PermissionResult` shape —
// that is what a `control_response` carries — not the neutral alias of the same
// name in core, which is what crosses the hub's wire.
import type { PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import type { NeutralMessage, NeutralUserMessage } from "@whiffle/core";
import type { HarnessContext } from "../harness";
import { ClaudeCustody, CUSTODY_DEGRADED } from "./claude";

const fixture = readFileSync(
  join(import.meta.dir, "fixtures", "custody-control.ndjson"),
  "utf8"
)
  .split("\n")
  .filter((entry) => entry.trim() && !entry.startsWith("#"));

const line = (marker: string): string => {
  const found = fixture.find((entry) => entry.includes(marker));
  if (!found) {
    throw new Error(`fixture has no line matching ${marker}`);
  }
  return found;
};

interface Recorded {
  busy: boolean[];
  ctx: HarnessContext;
  frames: NeutralMessage[];
  permissions: {
    requestId: string;
    toolName: string;
    input: Record<string, unknown>;
  }[];
  sessions: string[];
}

const recorder = (): Recorded => {
  const frames: NeutralMessage[] = [];
  const permissions: Recorded["permissions"] = [];
  const sessions: string[] = [];
  const busy: boolean[] = [];
  const ctx: HarnessContext = {
    instanceId: "inst-1",
    cwd: "/tmp",
    frame: (message) => frames.push(message),
    permission: (request) =>
      permissions.push(request as Recorded["permissions"][number]),
    busy: (active) => busy.push(active),
    session: (sessionId) => sessions.push(sessionId),
    failed: () => {
      // Not exercised: no test in this file drives custody into a failure.
    },
    emit: () => {
      // Not exercised: custody never emits an envelope in these tests.
    },
  };
  return { frames, permissions, sessions, busy, ctx };
};

interface Rig {
  custody: ClaudeCustody;
  handoffs: { instanceId: string; sessionId: string | null; held: unknown[] }[];
  rec: Recorded;
  stdinEnds: number;
  written: string[];
}

const rig = (): Rig => {
  const rec = recorder();
  const written: string[] = [];
  const handoffs: Rig["handoffs"] = [];
  const state = { stdinEnds: 0 };
  const custody = new ClaudeCustody(
    "inst-1",
    rec.ctx,
    (data) => written.push(data),
    () => {
      state.stdinEnds += 1;
    },
    (handoff) => handoffs.push(handoff)
  );
  return {
    rec,
    written,
    handoffs,
    custody,
    get stdinEnds() {
      return state.stdinEnds;
    },
  } as Rig;
};

test("custody re-derives frames from ring lines through the pure toNeutral", () => {
  const r = rig();
  r.custody.ingest(line('"subtype":"init"'));
  r.custody.ingest(line('"type":"assistant"'));

  // The init line is where the session names itself — the one fact custody has
  // to learn before it can hand back with `resume: sessionId`.
  expect(r.custody.sessionId).toBe("ses-custody-1");
  expect(r.rec.sessions).toEqual(["ses-custody-1"]);

  expect(r.rec.frames.map((frame) => frame.type)).toEqual([
    "system",
    "assistant",
  ]);
  // `toNeutral` is a re-tag: the SDK frame, plus its own self under `raw`.
  const assistant = r.rec.frames[1] as unknown as {
    uuid: string;
    raw: { uuid: string };
  };
  expect(assistant.uuid).toBe("u-a1");
  expect(assistant.raw.uuid).toBe("u-a1");
});

test("a parked permission is re-parked by requestId and answered with a raw control_response", () => {
  const r = rig();
  r.custody.ingest(line('"subtype":"init"'));
  r.custody.ingest(line('"subtype":"can_use_tool"'));

  // Re-parked under the SDK's OWN request id — the id the hub's parked ask has
  // carried end to end since this adapter first wrote it.
  expect(r.rec.permissions).toEqual([
    {
      requestId: "req-perm-1",
      toolName: "Bash",
      input: { command: "rm -rf build" },
    },
  ]);
  expect(r.custody.parked).toEqual(["req-perm-1"]);

  const result: PermissionResult = {
    behavior: "allow",
    updatedInput: { command: "rm -rf build" },
  };
  r.custody.resolvePermission("req-perm-1", result);

  expect(r.written).toHaveLength(1);
  const [response] = r.written;
  expect(JSON.parse(response)).toEqual({
    type: "control_response",
    response: {
      subtype: "success",
      request_id: "req-perm-1",
      response: result,
    },
  });
  // The line is newline-terminated: the CLI frames its stdin on newlines, and a
  // response that never terminates is a permission that never lands.
  expect(response.endsWith("\n")).toBe(true);
  expect(r.custody.parked).toEqual([]);

  // A second answer to the same id is an error, not a second write.
  expect(() => r.custody.resolvePermission("req-perm-1", result)).toThrow(
    "no permission request"
  );
  expect(r.written).toHaveLength(1);
});

test("a NON-permission control during custody fails visibly, in band", () => {
  const r = rig();
  r.custody.ingest(line('"subtype":"init"'));
  r.rec.frames.length = 0;
  r.custody.ingest(line('"subtype":"mcp_message"'));

  // In band: the CLI is told this request will never be served, so the tool
  // call fails instead of hanging on the whiffle server that died with the
  // agent.
  expect(r.written).toHaveLength(1);
  const [response] = r.written;
  const answer = JSON.parse(response) as {
    type: string;
    response: { subtype: string; request_id: string; error: string };
  };
  expect(answer.type).toBe("control_response");
  expect(answer.response.subtype).toBe("error");
  expect(answer.response.request_id).toBe("req-mcp-1");
  expect(answer.response.error).toContain("mcp_message");

  // Visibly: and the reader is told, in the transcript, why the call died.
  expect(r.rec.frames).toHaveLength(1);
  const frame = r.rec.frames[0] as unknown as {
    subtype: string;
    control: string;
    text: string;
  };
  expect(frame.subtype).toBe(CUSTODY_DEGRADED);
  expect(frame.control).toBe("mcp_message");
  expect(frame.text).toContain("custody");

  // It is NOT parked: nothing downstream should offer an answer for it.
  expect(r.custody.parked).toEqual([]);
});

test("an agent-side control during custody rejects, and says so in the transcript", async () => {
  const r = rig();
  await expect(r.custody.control("setModel")).rejects.toThrow("custody");
  const frame = r.rec.frames.at(-1) as unknown as {
    subtype: string;
    control: string;
  };
  expect(frame.subtype).toBe(CUSTODY_DEGRADED);
  expect(frame.control).toBe("setModel");
});

test("the boundary hand-off fires at the turn's next result line, once", () => {
  const r = rig();
  r.custody.ingest(line('"subtype":"init"'));
  r.custody.ingest(line('"type":"assistant"'));
  expect(r.handoffs).toHaveLength(0);
  expect(r.stdinEnds).toBe(0);

  r.custody.ingest(line('"type":"result"'));

  // The in-flight turn COMPLETED and was captured — that is what custody buys
  // over today's restart, which loses it mid-tool.
  expect(r.rec.frames.at(-1)?.type).toBe("result");
  expect(r.rec.busy.at(-1)).toBe(false);
  // Then, and only then: stdin EOF and the respawn-with-resume.
  expect(r.stdinEnds).toBe(1);
  expect(r.handoffs).toEqual([
    { instanceId: "inst-1", sessionId: "ses-custody-1", held: [] },
  ]);

  // Idempotent: a second result (or a stop racing it) hands off once.
  r.custody.ingest(line('"type":"result"'));
  expect(r.handoffs).toHaveLength(1);
  expect(r.stdinEnds).toBe(1);
});

test("a turn sent during custody is held and delivered by the hand-off", () => {
  const r = rig();
  r.custody.ingest(line('"subtype":"init"'));
  const message = {
    type: "user",
    message: { role: "user", content: "carry on" },
  } as unknown as NeutralUserMessage;
  r.custody.send(message, {});

  // Not written raw at the child: a bare user line on stdin would bypass the
  // queue machinery, the echo tagging and the busy accounting the `Query` owns.
  expect(r.written).toEqual([]);

  r.custody.ingest(line('"type":"result"'));
  expect(r.handoffs[0]?.held).toEqual([{ message, extras: {} }]);
});

test("a stop during custody answers every parked ask rather than leaving it hanging", async () => {
  const r = rig();
  r.custody.ingest(line('"subtype":"can_use_tool"'));
  await r.custody.stop();

  expect(r.custody.parked).toEqual([]);
  const [response] = r.written;
  const answer = JSON.parse(response) as {
    response: { subtype: string; request_id: string };
  };
  expect(answer.response.subtype).toBe("error");
  expect(answer.response.request_id).toBe("req-perm-1");
  expect(r.stdinEnds).toBe(1);
  // A stop is the operator ending the session; it is not a hand-off.
  expect(r.handoffs).toEqual([]);
});

/**
 * The same custody, but end to end: a REAL sessiond in another process, a real
 * child, and the agent-side owner destroyed and rebuilt around it — which is
 * the scenario the whole leaf exists for. The child here is a scripted emitter,
 * never `claude`, and the endpoint is always a scratch path.
 */
test("custody survives the owner being torn down and rebuilt, and replays without gap or duplicate", async () => {
  const { spawn } = await import("node:child_process");
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { probeEndpoint } = await import("../sessiond-client");
  const { ClaudeHarness } = await import("./claude");

  const dir = mkdtempSync(join(tmpdir(), "custody-live-"));
  const endpoint = join(dir, "sessiond.sock");
  const daemon = spawn(
    process.execPath,
    [join(import.meta.dir, "..", "..", "..", "sessiond", "src", "main.ts")],
    {
      env: { ...process.env, WHIFFLE_SESSIOND_ENDPOINT: endpoint },
      stdio: "ignore",
    }
  );
  try {
    const deadline = Date.now() + 10_000;
    // biome-ignore lint/performance/noAwaitInLoops: polls for the daemon to come up; each probe must wait for the last one to answer before trying again
    while (Date.now() < deadline && !(await probeEndpoint(endpoint, 200))) {
      await Bun.sleep(25);
    }

    // A child that keeps emitting SDK-shaped lines whether or not anyone is
    // listening. No `result` line: a hand-off here would respawn a session
    // through the real SDK, and this machine's real sessions are not props.
    const script = join(dir, "emitter.mjs");
    writeFileSync(
      script,
      [
        "let n = 0;",
        "process.stdout.write(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'ses-live', uuid: 'u0' }) + '\\n');",
        "setInterval(() => { n++; process.stdout.write(JSON.stringify({ type: 'assistant', uuid: 'u' + n, session_id: 'ses-live', message: { id: 'm' + n, type: 'message', role: 'assistant', content: [{ type: 'text', text: String(n) }] } }) + '\\n'); }, 10);",
        "process.stdin.resume();",
      ].join("\n")
    );

    const textOf = (frame: NeutralMessage): string =>
      (frame as unknown as { message?: { content?: { text?: string }[] } })
        .message?.content?.[0]?.text ?? "";

    // ---- the owner, first life ---------------------------------------
    const first = new ClaudeHarness();
    const firstClient = await first.sessiond(endpoint);
    await firstClient.spawnProc("inst-live", {
      command: process.execPath,
      args: [script],
    });

    const seen: NeutralMessage[] = [];
    const recA = recorder();
    recA.ctx.frame = (frame) => seen.push(frame);
    await first.adopt("inst-live", recA.ctx, {
      afterSeq: 0,
      onHandoff: () => {
        // Not exercised: this life is torn down before any hand-off fires.
      },
    });
    while (seen.length < 5) {
      // biome-ignore lint/performance/noAwaitInLoops: paced polling, not parallel work
      await Bun.sleep(10);
    }
    // The init line named the session — what the hand-off would resume with.
    expect(recA.sessions).toEqual(["ses-live"]);
    const lastFrame = seen.at(-1);
    if (!lastFrame) {
      throw new Error("no frames observed");
    }
    const lastN = Number(textOf(lastFrame));
    const cursor = seen.length; // seq is 1-based and 1:1 with lines here

    // ---- the death and the absence -----------------------------------
    firstClient.close();
    await Bun.sleep(200);

    // ---- the owner, second life --------------------------------------
    const second = new ClaudeHarness();
    const secondClient = await second.sessiond(endpoint);
    expect(
      secondClient.procs.find((proc) => proc.procId === "inst-live")?.alive
    ).toBe(true);

    const replayed: NeutralMessage[] = [];
    const recB = recorder();
    recB.ctx.frame = (frame) => replayed.push(frame);
    await second.adopt("inst-live", recB.ctx, {
      afterSeq: cursor,
      sessionId: "ses-live",
      onHandoff: () => {
        // Not exercised: nothing in this test drives a second hand-off.
      },
    });
    while (replayed.length < 10) {
      // biome-ignore lint/performance/noAwaitInLoops: paced polling, not parallel work
      await Bun.sleep(10);
    }

    // No gap, no duplicate: the child's own counter continues from exactly
    // where the first life stopped, one per frame, forever after.
    const numbers = replayed.map((frame) => Number(textOf(frame)));
    expect(numbers[0]).toBe(lastN + 1);
    for (let i = 1; i < numbers.length; i += 1) {
      // biome-ignore lint/style/noNonNullAssertion: i starts at 1 and stays below numbers.length, so i - 1 is always a valid index
      expect(numbers[i]).toBe(numbers[i - 1]! + 1);
    }

    secondClient.close();
  } finally {
    daemon.kill("SIGKILL");
  }
}, 20_000);
