/**
 * The Claude adapter's input queue, as observable state.
 *
 * A message sent to a BUSY session waits in the adapter's input stream until
 * the model pulls it. That wait used to be private — no frame announced it and
 * no snapshot carried it — so a dashboard could only guess, with a local echo
 * it lost on reload. What is pinned here is the pair of facts every tier above
 * depends on:
 *
 *  - `push` reports whether the message had to WAIT. That is the whole test for
 *    "queued": the SDK's iterator parks on `next()` exactly when the model is
 *    ready, so a push that finds it parked flows straight through.
 *  - the consume callback fires with the queue id at the moment it is pulled,
 *    once, in queue order — which is what a `message_dequeued` frame is.
 */
import { expect, test } from "bun:test";
// The input stream is the SDK's own prompt iterable, so its turns are the
// SDK's `SDKUserMessage` — not the neutral alias of the same name in core,
// which is what crosses the wire.
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { NeutralUserMessage } from "@whiffle/core";
import { MESSAGE_DEQUEUED, MESSAGE_QUEUED } from "@whiffle/core";
import { dequeuedFrame, InputStream, queuedFrame, queuedText } from "./claude";

const turn = (text: string): SDKUserMessage =>
  ({
    type: "user",
    message: { role: "user", content: text },
    parent_tool_use_id: null,
  }) as SDKUserMessage;

/** Lets a parked `next()` actually park before the test pushes at it. */
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

test("a send the model is ready for is not queued, and announces nothing", async () => {
  const consumed: string[] = [];
  const input = new InputStream((queueId) => consumed.push(queueId));
  const iterator = input[Symbol.asyncIterator]();

  // The model is waiting for its next turn — this is the idle session.
  const pulled = iterator.next();
  await tick();

  expect(input.push(turn("go"), "q-1")).toBe(false);
  expect((await pulled).value).toEqual(turn("go"));
  // Nothing waited, so nothing was consumed off the queue: no queued row was
  // ever drawn and none has to be retired.
  expect(consumed).toEqual([]);
});

test("a send made while the turn runs waits, and is announced when it is pulled", async () => {
  const consumed: string[] = [];
  const input = new InputStream((queueId) => consumed.push(queueId));
  const iterator = input[Symbol.asyncIterator]();

  // Nobody is pulling: the model is mid-turn.
  expect(input.push(turn("first"), "q-1")).toBe(true);
  expect(consumed).toEqual([]);

  // The turn ends and the model asks for its next input.
  expect((await iterator.next()).value).toEqual(turn("first"));
  expect(consumed).toEqual(["q-1"]);
});

test("the queue drains in order, one dequeue each", async () => {
  const consumed: string[] = [];
  const input = new InputStream((queueId) => consumed.push(queueId));
  const iterator = input[Symbol.asyncIterator]();

  input.push(turn("one"), "q-1");
  input.push(turn("two"), "q-2");
  input.push(turn("three"), "q-3");

  expect((await iterator.next()).value).toEqual(turn("one"));
  expect((await iterator.next()).value).toEqual(turn("two"));
  expect(consumed).toEqual(["q-1", "q-2"]);
  expect((await iterator.next()).value).toEqual(turn("three"));
  expect(consumed).toEqual(["q-1", "q-2", "q-3"]);
});

test("an untagged wait announces nothing — an injected message has its own echo", async () => {
  const consumed: string[] = [];
  const input = new InputStream((queueId) => consumed.push(queueId));
  const iterator = input[Symbol.asyncIterator]();

  expect(input.push(turn("a rule fired"))).toBe(true);
  expect((await iterator.next()).value).toEqual(turn("a rule fired"));
  expect(consumed).toEqual([]);
});

test("the queued frame carries the text and time, and a COUNT of images", () => {
  const frame = queuedFrame(
    {
      queueId: "q-9",
      text: "ship it",
      timestamp: "2026-08-27T10:00:00.000Z",
      images: 2,
    },
    "sess-1"
  );
  expect(frame).toEqual({
    type: "system",
    subtype: MESSAGE_QUEUED,
    session_id: "sess-1",
    queueId: "q-9",
    text: "ship it",
    timestamp: "2026-08-27T10:00:00.000Z",
    images: 2,
  });
});

test("the dequeued frame is the id and nothing else", () => {
  expect(dequeuedFrame("q-9", "sess-1")).toEqual({
    type: "system",
    subtype: MESSAGE_DEQUEUED,
    session_id: "sess-1",
    queueId: "q-9",
  });
  // A session that has not named itself yet still frames its queue.
  expect(dequeuedFrame("q-9", null)).toEqual({
    type: "system",
    subtype: MESSAGE_DEQUEUED,
    queueId: "q-9",
  });
});

test("the queued text is what was typed, whichever shape the turn arrived in", () => {
  const plain: NeutralUserMessage = {
    type: "user",
    message: { role: "user", content: "plain sentence" },
  };
  expect(queuedText(plain)).toBe("plain sentence");

  // An images-carrying turn arrives as blocks; the text is still the sentence.
  const withImage: NeutralUserMessage = {
    type: "user",
    message: {
      role: "user",
      content: [
        {
          type: "image",
          source: { type: "base64", media_type: "image/png", data: "AAAA" },
        },
        { type: "text", text: "look at this" },
      ],
    },
  };
  expect(queuedText(withImage)).toBe("look at this");
});
