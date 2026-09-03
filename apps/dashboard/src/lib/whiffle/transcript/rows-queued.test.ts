/**
 * The pending register: messages a session has been handed and not started.
 *
 * A queued message is not a turn — it has not happened — so it belongs after
 * everything that has, including the live tail. And its key must NOT be the
 * key its real turn will carry: when the message finally runs, one row leaves
 * and a different one arrives, which is the honest picture of a placeholder
 * being replaced by a fact.
 */
import { expect, test } from "bun:test";
import type { QueuedMessage } from "@whiffle/core";
import type { SessionState } from "../client.svelte";
import type { Message } from "../types";
import { buildRows } from "./rows";

const queued = (queueId: string, text: string): QueuedMessage => ({
  queueId,
  text,
  timestamp: "2026-08-27T10:00:00.000Z",
});

const said = (content: string): Message => ({
  id: `m:${content}`,
  instanceId: "i1",
  type: "assistant",
  content,
});

const stateWith = (over: Partial<SessionState>): SessionState =>
  ({
    instanceId: "i1",
    messages: [],
    subagents: {},
    queued: [],
    streaming: "",
    openBlock: null,
    thinkingStream: "",
    thinkingClosing: false,
    currentTool: null,
    ...over,
  }) as SessionState;

test("a queued message becomes its own row, keyed by its queue id", () => {
  const rows = buildRows(stateWith({ queued: [queued("q-1", "ship it")] }));
  expect(rows).toHaveLength(1);
  expect(rows[0].kind).toBe("queued");
  expect(rows[0].key).toBe("qd:q-1");
  if (rows[0].kind === "queued") {
    expect(rows[0].queued.text).toBe("ship it");
  }
});

test("queued rows sit after the conversation AND after the live tail", () => {
  const rows = buildRows(
    stateWith({
      messages: [said("working on it")],
      streaming: "still going",
      queued: [queued("q-1", "first"), queued("q-2", "second")],
    })
  );
  expect(rows.map((row) => row.kind)).toEqual([
    "single",
    "stream",
    "queued",
    "queued",
  ]);
  // Oldest first: the queue is a queue, and it drains in that order.
  expect(rows.slice(2).map((row) => row.key)).toEqual(["qd:q-1", "qd:q-2"]);
});

test("a queued row never shares a key with the turn that replaces it", () => {
  // The real turn is keyed by its SDK uuid; the queued row by `qd:` + queue id.
  // Nothing should ever ask the transcript to morph one into the other.
  const real: Message = {
    id: "uuid-1",
    instanceId: "i1",
    type: "user",
    content: "ship it",
  };
  const rows = buildRows(
    stateWith({ messages: [real], queued: [queued("q-1", "ship it")] })
  );
  const keys = rows.map((row) => row.key);
  expect(new Set(keys).size).toBe(keys.length);
  expect(keys).toEqual(["uuid-1", "qd:q-1"]);
});

test("an empty queue adds nothing at all", () => {
  expect(buildRows(stateWith({ messages: [said("done")] }))).toHaveLength(1);
});

/**
 * ── The `ssrCount` latch ─────────────────────────────────────────────────────
 *
 * Not a `buildRows` test, but the guard that keeps `buildRows`' output visible,
 * and this is the transcript's test file. The rows folded above are handed to
 * virtua's `Virtualizer`, and for a while the transcript handed it `ssrCount`
 * unconditionally — including on the client. That looks like a hint. It is a
 * LATCH: the store reads `ssrCount` once, at construction, and pins its render
 * range at `[0, ssrCount - 1]` until a real scroll event clears the flag. A
 * transcript shorter than its viewport can never produce one, so every row
 * built after hydration — the message just sent, every streamed frame — was
 * folded correctly and then dropped by a range that had stopped moving. The
 * fix is that `ssrCount` is a SERVER-render count, gated on `browser`.
 *
 * The two tests below pin both halves: the upstream behaviour that makes the
 * gate necessary, and the gate itself. If a virtua upgrade ever drops the
 * latch, the first fails and the gate can be reconsidered on purpose rather
 * than by accident.
 */
test("virtua freezes its render range at ssrCount until a scroll clears it", async () => {
  const { createVirtualStore } = (await import("virtua/unstable_core")) as {
    createVirtualStore: (
      len: number,
      itemSize?: number,
      ssrCount?: number
    ) => {
      $getRange: () => [number, number];
    };
  };
  // Three items rendered on the server, ten in hand by the time the client is
  // live. The range does not follow the data — that is the whole defect.
  const store = createVirtualStore(10, 40, 3);
  expect(store.$getRange()).toEqual([0, 2]);
});

test("the transcript hands ssrCount to the server render only", async () => {
  const source = await Bun.file(
    new URL("./Transcript.svelte", import.meta.url)
  ).text();
  // The prop reaches the Virtualizer by shorthand, so the gate IS the binding:
  // the literal `ssrCount={built.rows.length}` must never come back.
  expect(source).toContain(
    "const ssrCount = $derived(browser ? undefined : built.rows.length);"
  );
  expect(source).toMatch(/^\s*\{ssrCount\}\s*$/m);
  expect(source).not.toMatch(/ssrCount=\{built\.rows\.length\}/);
});
