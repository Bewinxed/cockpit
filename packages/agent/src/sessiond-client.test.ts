/**
 * The bridge, against a REAL sessiond in a REAL separate process.
 *
 * The property under test cannot be mocked: a child spawned through sessiond
 * must keep running, and its ring must keep filling, while the agent-side
 * object that was watching it is destroyed and rebuilt. A stub client would
 * "survive" its own teardown trivially — only a daemon in another process,
 * holding the pipe, proves anything. So the daemon here is
 * `packages/sessiond/src/main.ts` started as a subprocess on a scratch socket.
 *
 * SAFETY: the children are scripted node/bun emitters, never a harness and
 * never `claude` — this machine runs the operator's live sessions. The
 * endpoint is always a scratch path under `tmpdir()`; `sessiondEndpoint()`,
 * the real one, is never bound.
 */
import { afterEach, expect, test } from "bun:test";
import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ensureSessiond,
  probeEndpoint,
  SessiondClient,
  SessiondUnavailableError,
  serviceManaged,
} from "./sessiond-client";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    cleanup();
  }
});

const scratch = (): string => mkdtempSync(join(tmpdir(), "sessiond-bridge-"));

/** sessiond, in its own process, on a socket that is nobody else's. */
const startDaemon = async (): Promise<string> => {
  const endpoint = join(scratch(), "sessiond.sock");
  const main = join(import.meta.dir, "..", "..", "sessiond", "src", "main.ts");
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
 * A child that talks forever until its stdin closes — the shape of a CLI that
 * keeps working while nobody is listening. One JSON line per tick, carrying a
 * counter, so a gap or a duplicate in the replay is arithmetic rather than
 * vibes.
 */
const emitter = (dir: string): string => {
  const path = join(dir, "emitter.mjs");
  writeFileSync(
    path,
    [
      "let n = 0;",
      "const timer = setInterval(() => { process.stdout.write(JSON.stringify({ type: 'assistant', n: ++n }) + '\\n'); if (n >= 400) clearInterval(timer); }, 10);",
      "process.stdin.resume();",
      "process.stdin.on('end', () => { clearInterval(timer); process.exit(0); });",
    ].join("\n")
  );
  return path;
};

const nOf = (data: string): number => (JSON.parse(data) as { n: number }).n;

test("a child keeps running and its ring keeps filling while the agent side is torn down and rebuilt", async () => {
  const endpoint = await startDaemon();
  const dir = scratch();
  const procId = "inst-survival";

  // ---- the agent, first life -------------------------------------------
  const first = await SessiondClient.connect(endpoint);
  await first.spawnProc(procId, {
    command: process.execPath,
    args: [emitter(dir)],
  });

  const seen: { seq: number; n: number }[] = [];
  first.subscribe(
    procId,
    { line: (event) => seen.push({ seq: event.seq, n: nOf(event.data) }) },
    0
  );
  while (seen.length < 5) {
    await Bun.sleep(10);
  }

  const cursor = seen.at(-1)!.seq;
  // THE DEATH. Everything the agent held for this child goes away: the
  // socket, the cursor, the object. The child does not.
  first.close();

  // ---- the absence ------------------------------------------------------
  await Bun.sleep(250);

  // ---- the agent, second life ------------------------------------------
  const second = await SessiondClient.connect(endpoint);
  cleanups.push(() => second.close());
  const held = second.procs.find((proc) => proc.procId === procId);
  expect(held?.alive).toBe(true);
  // The ring kept filling with nobody attached — the whole tmux property.
  expect(held!.head).toBeGreaterThan(cursor);

  const replayed: { seq: number; n: number }[] = [];
  second.subscribe(
    procId,
    { line: (event) => replayed.push({ seq: event.seq, n: nOf(event.data) }) },
    cursor
  );
  while (replayed.length < 10) {
    await Bun.sleep(10);
  }

  // NO GAP: the replay resumes at exactly the line after the cursor.
  expect(replayed[0]!.seq).toBe(cursor + 1);
  // NO DUPLICATE and no hole across the seam: seqs are strictly +1, and the
  // child's own counter moves in lockstep with them, so nothing sessiond
  // handed over was invented or dropped.
  for (let i = 1; i < replayed.length; i++) {
    expect(replayed[i]!.seq).toBe(replayed[i - 1]!.seq + 1);
    expect(replayed[i]!.n).toBe(replayed[i - 1]!.n + 1);
  }
  // And the two lives join without overlap: the last line of the first life
  // is one before the first line of the second.
  expect(seen.at(-1)!.n + 1).toBe(replayed[0]!.n);

  // The hand-off's graceful half still reaches a child nobody spawned in
  // this process: stdin EOF, and it goes away on its own terms.
  const exited = new Promise<void>((resolve) => {
    second.subscribe(
      procId,
      { line: () => {}, exit: () => resolve() },
      replayed.at(-1)!.seq
    );
  });
  await second.stdinEnd(procId);
  await Promise.race([exited, Bun.sleep(5000)]);
  expect(
    (await second.list()).procs.find((proc) => proc.procId === procId)?.alive
  ).toBe(false);
}, 20_000);

test("an unknown verb is answered, never fatal — the §5 capability probe", async () => {
  const endpoint = await startDaemon();
  const client = await SessiondClient.connect(endpoint);
  cleanups.push(() => client.close());

  // A command sessiond cannot serve, and the property that matters: it is
  // ANSWERED, never fatal (§5). This is what an agent NEWER than its sessiond
  // relies on — it probes, reads the refusal, and carries on over the same
  // connection.
  const raw = client as unknown as {
    spawnProc: (id: string, spec: unknown) => Promise<void>;
  };
  await expect(raw.spawnProc("bad", {})).rejects.toThrow(
    "spawn: procId and spec.command required"
  );
  expect(client.closed).toBe(false);
  expect((await client.list()).epoch).toBeTruthy();
});

// --------------------------------------------------------------- the guard

test("serviceManaged reads systemd, launchd and whiffle's own unit marker", () => {
  // systemd sets INVOCATION_ID on every unit-started process (systemd.exec(5)).
  expect(serviceManaged({ INVOCATION_ID: "e6b1c0…" })).toBe(true);
  // whiffle's own unit marker (`cli/src/service.ts`, MODE_ENV) — a dev-mode
  // unit is still a unit.
  expect(serviceManaged({ WHIFFLE_SERVICE_MODE: "dev" })).toBe(true);
  // launchd's equivalent carries the job label…
  expect(serviceManaged({ XPC_SERVICE_NAME: "com.whiffle.agent" })).toBe(true);
  // …but a login shell inherits the literal placeholder, which is NOT a unit.
  expect(serviceManaged({ XPC_SERVICE_NAME: "0" })).toBe(false);
  expect(serviceManaged({})).toBe(false);
  expect(serviceManaged({ HOME: "/home/x", PATH: "/usr/bin" })).toBe(false);
});

test("under service management a missing sessiond is a loud error, NEVER an ad-hoc spawn", async () => {
  // A scratch path nothing is listening on, so the only question left is what
  // the guard does about it.
  const endpoint = join(scratch(), "absent.sock");

  await expect(
    ensureSessiond(endpoint, { INVOCATION_ID: "unit-1" })
  ).rejects.toBeInstanceOf(SessiondUnavailableError);
  // Why this matters enough to be its own gate: a sessiond spawned from a
  // service-managed agent lands in the AGENT's cgroup, so the next agent
  // restart kills every session it was holding — the exact KillMode trap
  // sessiond was built to escape. The error names the install-time fix.
  await expect(
    ensureSessiond(endpoint, { INVOCATION_ID: "unit-1" })
  ).rejects.toThrow("systemctl --user start whiffle-sessiond");

  // Nothing was started: the socket is still absent after both refusals.
  expect(await probeEndpoint(endpoint, 200)).toBe(false);
});

test("a live sessiond satisfies the guard, service-managed or not", async () => {
  const endpoint = await startDaemon();
  // No throw and no spawn — the daemon that is already there is the answer.
  await ensureSessiond(endpoint, { INVOCATION_ID: "unit-1" });
  await ensureSessiond(endpoint, {});
  expect(await probeEndpoint(endpoint, 200)).toBe(true);
});
