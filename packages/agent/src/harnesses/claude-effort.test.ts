import { afterAll, expect, mock, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Envelope, NeutralMessage, SpawnPayload } from "@whiffle/core";
import { CONTROL_SET_EFFORT } from "@whiffle/core";
import { SESSIOND_V1 } from "@whiffle/core/sessiond";
import type { HarnessContext } from "../harness";

/**
 * Effort has two surfaces and they are not the same call, so both are pinned
 * here: a spawn hands the level to `query()` as an option, and a mid-session
 * switch spends it on `applyFlagSettings` — the SDK has no `setEffort` method,
 * and the generic control proxy would have gone looking for one.
 *
 * The SDK is stood in for, because the real `query()` starts a CLI. What is
 * being tested is what whiffle asks it for, which is exactly what the stand-in
 * records.
 */
const spawned: { options: Record<string, unknown> }[] = [];
const flags: unknown[] = [];

/** A `Query` that answers nothing and ends, so the adapter's pump settles. */
const handle = {
  async *[Symbol.asyncIterator]() {
    // Nothing to yield: the stand-in ends the stream immediately.
  },
  applyFlagSettings: (settings: unknown) => {
    flags.push(settings);
    return Promise.resolve();
  },
  setModel: (model: string) => Promise.resolve(model),
  interrupt: () => Promise.resolve(),
  close: () => {
    // Nothing to release: the stand-in never opened anything real.
  },
};

mock.module("@anthropic-ai/claude-agent-sdk", () => ({
  query: ({ options }: { options: Record<string, unknown> }) => {
    spawned.push({ options });
    return handle;
  },
  listSessions: () => Promise.resolve([]),
  getSessionInfo: () => Promise.resolve(undefined),
  getSessionMessages: () => Promise.resolve([]),
  deleteSession: () => Promise.resolve(),
  renameSession: () => Promise.resolve(),
  tagSession: () => Promise.resolve(),
  // The adapter mounts the hand-off MCP server on every session; these are what
  // building it needs, and nothing here exercises the tools themselves.
  createSdkMcpServer: (config: unknown) => config,
  tool: (name: string) => ({ name }),
}));

/**
 * Every claude session's CLI child now lives under sessiond
 * (`spawnClaudeCodeProcess`, design §4.1) — so the adapter dials it before it
 * builds a `query()`. The `query()` above is a stand-in and never spawns
 * anything, so all this needs to be is something that speaks a `welcome` on a
 * scratch socket; the real endpoint is never bound, and no child is ever
 * created here.
 */
const endpoint = join(
  mkdtempSync(join(tmpdir(), "claude-effort-")),
  "sessiond.sock"
);
const fakeSessiond = createServer((socket) => {
  socket.write(
    `${JSON.stringify({
      type: "welcome",
      epoch: "test-epoch",
      capabilities: [SESSIOND_V1],
      build: { version: "test", startedAt: 0 },
      procs: [],
    })}\n`
  );
});
await new Promise<void>((resolve) => fakeSessiond.listen(endpoint, resolve));
process.env.WHIFFLE_SESSIOND_ENDPOINT = endpoint;
afterAll(() => {
  fakeSessiond.close();
  delete process.env.WHIFFLE_SESSIOND_ENDPOINT;
});

const { ClaudeHarness } = await import("./claude");

const ctx = (): HarnessContext => ({
  instanceId: "inst",
  cwd: "/tmp",
  // None of these callbacks matter to this test: only the options `query()`
  // was spawned with, and the effort flag applied mid-session, are asserted.
  frame: (_message: NeutralMessage) => {
    // noop
  },
  permission: () => {
    // noop
  },
  busy: () => {
    // noop
  },
  session: () => {
    // noop
  },
  failed: () => {
    // noop
  },
  emit: (_envelope: Envelope) => {
    // noop
  },
});

const spawn = (spec: Partial<SpawnPayload>) =>
  new ClaudeHarness().spawn(
    { instanceId: "inst", cwd: "/tmp", ...spec },
    ctx()
  );

test("the harness reports it has an effort scale", () => {
  expect(new ClaudeHarness().capabilities.effort).toBe(true);
});

test("a spawn's effort reaches the SDK options", async () => {
  spawned.length = 0;
  await spawn({ model: "opus", effort: "xhigh" });
  expect(spawned).toHaveLength(1);
  expect(spawned[0].options.effort).toBe("xhigh");
  expect(spawned[0].options.model).toBe("opus");
});

test("a spawn that names no level leaves the option out entirely", async () => {
  spawned.length = 0;
  await spawn({ model: "opus" });
  // Not `undefined` in the object, absent from it: the model's own default is
  // what should answer, and a key we wrote is a choice we made.
  expect("effort" in spawned[0].options).toBe(false);
});

test("setEffort is applied as a flag setting, not looked up as a Query method", async () => {
  flags.length = 0;
  const session = await spawn({});
  await session.control(CONTROL_SET_EFFORT, ["max"]);
  expect(flags).toEqual([{ effortLevel: "max" }]);
});

test("the other controls still go straight to the Query", async () => {
  const session = await spawn({});
  expect(await session.control("setModel", ["sonnet"])).toBe("sonnet");
  await expect(session.control("noSuchMethod", [])).rejects.toThrow(
    "unknown control method: noSuchMethod"
  );
});
