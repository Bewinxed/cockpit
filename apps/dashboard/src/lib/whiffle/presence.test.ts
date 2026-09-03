// The presence line is the answer to "the send went nowhere": it stands in for
// the session between the send and the first frame, and gets out of the way the
// moment the transcript itself is alive again.
import { expect, test } from "bun:test";
import { formatElapsed, showsPresence } from "./presence";

/** A working turn with nothing on screen — what each test below moves one of. */
const working = {
  activity: "working" as const,
  streaming: "",
  toolInFlight: false,
  tailToolPending: false,
  thinkingLive: false,
  tailIsThinking: false,
};

test("under a minute reads as seconds with a tenth", () => {
  expect(formatElapsed(0)).toBe("0.0s");
  expect(formatElapsed(7.24)).toBe("7.2s");
});

test("past a minute the minutes lead", () => {
  expect(formatElapsed(60)).toBe("1m 0.0s");
  expect(formatElapsed(125.5)).toBe("2m 5.5s");
});

test("a clock read before its start does not run backwards", () => {
  expect(formatElapsed(-3)).toBe("0.0s");
});

test("a working session with nothing on screen yet gets the line", () => {
  expect(showsPresence(working)).toBe(true);
});

test("streamed text is the session speaking for itself", () => {
  expect(showsPresence({ ...working, streaming: "Reading th" })).toBe(false);
});

test("a tool in flight is still a working stretch, so the line stays", () => {
  expect(showsPresence({ ...working, toolInFlight: true })).toBe(true);
});

test("tool rows still waiting on their results keep the line too", () => {
  // Parallel calls: the one the session is tracking answered first, and the
  // rows beside it are still going. No row stands in for them, so presence does.
  expect(showsPresence({ ...working, tailToolPending: true })).toBe(true);
});

test("idle and blocked sessions render nothing", () => {
  expect(showsPresence({ ...working, activity: "idle" })).toBe(false);
  expect(showsPresence({ ...working, activity: "blocked" })).toBe(false);
});

test("a live reasoning trace is rendered in the line’s place", () => {
  expect(showsPresence({ ...working, thinkingLive: true })).toBe(false);
});

test("a tail thinking block already shimmers for itself", () => {
  // The opencode path: no partials stream, so the stored block is the only
  // evidence there is.
  expect(showsPresence({ ...working, tailIsThinking: true })).toBe(false);
});

test("the line comes back once the trace has been superseded", () => {
  // The assistant frame cleared the live trace and opened no new block: the
  // session is between two visible things, which is the line's whole job.
  expect(showsPresence({ ...working, thinkingLive: false })).toBe(true);
});
