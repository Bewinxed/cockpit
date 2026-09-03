/**
 * THE LEDGER, ARMED (design §7), end to end and in one process pair.
 *
 * D3 built both halves of "a line becomes a hub frame AT MOST ONCE per
 * (instanceId, epoch, srcSeq)" and neither half could fire, because nothing
 * produced provenance: the claude adapter's custody subscribe held `event.seq`
 * and dropped it. This test is the proof that it no longer does.
 *
 * The scenario is the one the guarantee exists for — AN AGENT RESTART WITH A
 * STALE ACK. The hub's ledger is handed back at register, and the frames a
 * dying agent forwarded after that ack was minted are already at the hub. The
 * returning agent replays from the cursor the ack named, so it re-sends lines
 * the hub already turned into frames. Without provenance the hub cannot tell
 * them apart from new ones and the operator's transcript doubles; with it, the
 * replay is refused line for line and only the genuinely new line is admitted.
 *
 * WHAT IS REAL HERE: a real sessiond in a real separate process, the real
 * `SessionSupervisor`, the real claude adapter's `adopt`, and the real
 * `readProvenance`/`alreadyIngested` rules from @whiffle/core. The hub is
 * modelled by the six lines of `createStreamHub`'s `admitFrame`
 * (packages/hub/src/stream.ts:554-562), mirrored rather than imported: the
 * agent package compiles with `rootDir: ./src` and does not depend on
 * @whiffle/hub, so importing it would break `tsc --noEmit`. Every RULE the
 * mirror stands on is the exported production one.
 *
 * SAFETY, the rules of leaf D2's and D3's suites, unchanged: the child is a
 * scripted node emitter, never a harness and NEVER `claude` — this machine runs
 * the operator's live sessions. The endpoint is a scratch path under
 * `tmpdir()`; the real `sessiondEndpoint()` is never bound. The emitter never
 * writes a `result` line, which is the line that would arm the boundary
 * hand-off and ask the supervisor to spawn a real SDK session.
 */
import { afterAll, beforeAll, expect, test } from "bun:test";
import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  alreadyIngested,
  type FramePayload,
  type FrameProvenance,
  type IngestMark,
  readProvenance,
} from "@whiffle/core";
import { SessionSupervisor } from "./session";
import { probeEndpoint, SessiondClient } from "./sessiond-client";

const dir = mkdtempSync(join(tmpdir(), "ingest-armed-"));
const endpoint = join(dir, "sessiond.sock");
let daemon: ChildProcess;
let client: SessiondClient;
let epoch: string;

/** Emits on demand: a burst at startup, then as many lines as stdin asks for. */
const emitterPath = join(dir, "emitter.mjs");
writeFileSync(
  emitterPath,
  [
    "let n = 0;",
    "const emit = () => process.stdout.write(JSON.stringify({ type: 'system', subtype: 'note', n: ++n }) + '\\n');",
    "for (let i = 0; i < Number(process.argv[2] ?? 1); i++) emit();",
    "let buffer = '';",
    "process.stdin.on('data', (chunk) => {",
    "  buffer += chunk;",
    "  let nl = buffer.indexOf(String.fromCharCode(10));",
    "  while (nl >= 0) {",
    "    const asked = Number(buffer.slice(0, nl).trim() || 1);",
    "    buffer = buffer.slice(nl + 1);",
    "    for (let i = 0; i < asked; i++) emit();",
    "    nl = buffer.indexOf(String.fromCharCode(10));",
    "  }",
    "});",
    "process.stdin.resume();",
    "process.stdin.on('end', () => process.exit(0));",
  ].join("\n")
);

const spawned: string[] = [];

beforeAll(async () => {
  process.env.WHIFFLE_SESSIOND_ENDPOINT = endpoint;
  const main = join(import.meta.dir, "..", "..", "sessiond", "src", "main.ts");
  daemon = spawn(process.execPath, [main], {
    env: { ...process.env, WHIFFLE_SESSIOND_ENDPOINT: endpoint },
    stdio: "ignore",
  });
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline && !(await probeEndpoint(endpoint, 200))) {
    await Bun.sleep(25);
  }
  client = await SessiondClient.connect(endpoint);
  epoch = client.epoch!;
  expect(epoch).toBeTruthy();
});

afterAll(async () => {
  // Children first, so nothing is orphaned onto a machine full of real work.
  for (const procId of spawned) {
    await client.signal(procId, "SIGKILL").catch(() => {});
  }
  await Bun.sleep(50);
  client.close();
  daemon.kill("SIGKILL");
});

type Sunk = Exclude<FramePayload, { kind: "instances" }> &
  Partial<FrameProvenance>;

const noteOf = (frame: Sunk): number | undefined =>
  frame.kind === "frame"
    ? (frame.message as unknown as { n?: number }).n
    : undefined;

const waitFor = async (
  predicate: () => boolean,
  why: string
): Promise<void> => {
  for (let waited = 0; waited < 400; waited++) {
    if (predicate()) {
      return;
    }
    await Bun.sleep(10);
  }
  throw new Error(`timed out waiting for ${why}`);
};

/**
 * THE HUB'S LEDGER, mirroring `createStreamHub`'s `admitFrame`
 * (packages/hub/src/stream.ts:554-562) line for line: a frame with no
 * provenance is always admitted and forgets the mark; a frame at or below the
 * mark of its own epoch is refused; anything else is admitted and advances it.
 * The predicate is the exported production one.
 */
const hub = () => {
  const ledger = new Map<string, IngestMark>();
  const admitted: {
    instanceId: string;
    provenance?: FrameProvenance;
    n?: number;
  }[] = [];
  let refused = 0;
  return {
    admitted,
    get refused() {
      return refused;
    },
    /** The register ack this hub would send for one instance, right now. */
    ack: (
      instanceId: string
    ): { ok: true; ingested: Record<string, IngestMark> } => {
      const mark = ledger.get(instanceId);
      return { ok: true, ingested: mark ? { [instanceId]: { ...mark } } : {} };
    },
    /** What `server.ts` does with every relayed frame, in the order it does it. */
    relay: (frame: Sunk): void => {
      if (frame.kind !== "frame") {
        return;
      }
      const instanceId = frame.instanceId;
      const provenance = readProvenance(frame);
      if (!provenance) {
        ledger.delete(instanceId);
      } else if (alreadyIngested(ledger.get(instanceId), provenance)) {
        refused += 1;
        return;
      } else {
        ledger.set(instanceId, {
          epoch: provenance.srcEpoch,
          srcSeq: provenance.srcSeq,
        });
      }
      admitted.push({
        instanceId,
        ...(provenance ? { provenance } : {}),
        n: noteOf(frame),
      });
    },
  };
};

test("a line replayed after an agent restart is admitted exactly once", async () => {
  const procId = `armed-${crypto.randomUUID()}`;
  spawned.push(procId);
  await client.spawnProc(procId, {
    command: process.execPath,
    args: [emitterPath, "3"],
  });
  await Bun.sleep(200);

  const board = hub();
  const rows = [{ instanceId: procId, cwd: dir, sessionId: null }];
  /** Every frame that reached the wire, kept so a re-send can be replayed. */
  const forwarded: Sunk[] = [];
  const wire = (frame: Sunk): void => {
    forwarded.push(frame);
    board.relay(frame);
  };

  // ---- the agent's first life: nothing ingested yet, so it follows from head.
  const first = new SessionSupervisor();
  first.sink = (frame) => wire(frame as Sunk);
  expect(await first.reattachFrom(board.ack(procId), rows)).toEqual([procId]);
  await Bun.sleep(150);
  expect(board.admitted).toEqual([]);

  // Two lines forwarded and ingested. THIS is the ack the hub would hand back
  // if the agent re-registered now — and the one it dies holding.
  await client.write(procId, "2\n");
  await waitFor(
    () => board.admitted.length === 2,
    "the two lines the ack will name"
  );

  // AT LEAST ONCE MEETS AT MOST ONCE (design §8), the shortest statement of the
  // whole guarantee: a socket that drops mid-forward makes the agent re-send
  // frames it already sent. Provenance is the only thing that tells the hub
  // they are the same lines — refused, never a second frame.
  for (const frame of forwarded) {
    board.relay(frame);
  }
  expect(board.admitted.length).toBe(2);
  expect(board.refused).toBe(2);

  const staleAck = board.ack(procId);
  expect(staleAck.ingested[procId]).toEqual({ epoch, srcSeq: 5 });

  // Three more, forwarded and ingested AFTER that ack was minted. They are at
  // the hub; the ack does not know it.
  await client.write(procId, "3\n");
  await waitFor(
    () => board.admitted.length === 5,
    "the frames the stale ack does not name"
  );

  // ---- THE RESTART. A new supervisor reattaches on the stale ack, so sessiond
  // replays from srcSeq 5: lines 6, 7 and 8 — every one of them already a hub
  // frame. The agent's own mark (srcSeq 5) does not cover them, so it forwards
  // all three and the hub's ledger is the only thing between the operator and a
  // doubled transcript. The child, and its pipe, never noticed.
  const second = new SessionSupervisor();
  second.sink = (frame) => board.relay(frame as Sunk);
  expect(await second.reattachFrom(staleAck, rows)).toEqual([procId]);
  // 2 from the re-send above, 3 from this replay.
  await waitFor(
    () => board.refused === 5,
    "the replayed lines to be refused, not ingested"
  );
  await Bun.sleep(150);
  expect(board.admitted.length).toBe(5);

  // And it is following: the next line the child writes is admitted, once.
  await client.write(procId, "1\n");
  await waitFor(
    () => board.admitted.length === 6,
    "the one genuinely new line"
  );
  await Bun.sleep(100);

  // AT MOST ONCE, stated three ways.
  const stamps = board.admitted.map((entry) => entry.provenance);
  // 1. Every frame carried provenance — the stamp this leaf wired.
  expect(stamps.every((stamp) => stamp?.srcEpoch === epoch)).toBe(true);
  // 2. No (epoch, srcSeq) was ingested twice, and they only ever went up.
  const seqs = stamps.map((stamp) => stamp!.srcSeq);
  expect(seqs).toEqual([4, 5, 6, 7, 8, 9]);
  // 3. No line the child wrote became two frames.
  // (n is the child's own counter: it wrote 3 lines before anyone attached, so
  // the first line this transcript ever carried is its fourth.)
  expect(board.admitted.map((entry) => entry.n)).toEqual([4, 5, 6, 7, 8, 9]);
}, 60_000);
