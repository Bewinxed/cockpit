/**
 * The Ledger Protocol as the dashboard sees it: a scripted hub on one side, a
 * recording host on the other, and the store's decisions in between.
 *
 * What is being proven is the promise the protocol makes to a reader — that
 * what is on screen is what the session actually did, once, in order. So the
 * tests are written as that reader's questions: does a hole get papered over,
 * does a replay double a turn, does a button that was pressed ever get left
 * spinning with nobody owning the answer.
 */
import { expect, test } from 'bun:test';
import { STREAM_V1 } from '@whiffle/core';
import type {
  CommandAck,
  CommandKind,
  SessionStreamEvent,
  StreamClientMessage,
  StreamSubscribe,
} from '@whiffle/core';
import {
  COMMAND_ACK_TIMEOUT_MS,
  createStreamState,
  handleStreamMessage,
  interruptedRecently,
  latestCommand,
  MAX_RESYNC_ATTEMPTS,
  noteCapabilities,
  noteDisconnect,
  SETTLED_COMMAND_LIMIT,
  SETTLED_COMMAND_TTL_MS,
  streamCarries,
  submitCommand,
  sweepCommands,
  syncStreamSubscriptions,
  disarmCommandSweep,
  failLocally,
  sessionCommands,
  type SettleStage,
  type StreamHost,
  type StreamState,
} from './stream';

const SESSION = 'inst-1';

/** A frame that is only ever itself, so a double-apply is visible as a repeat. */
const frameAt = (seq: number, kind = 'frame'): unknown => ({
  kind,
  instanceId: SESSION,
  message: { type: 'assistant', uuid: `u${seq}`, text: `line ${seq}` },
});

const eventAt = (seq: number, sessionId = SESSION, kind = 'frame'): SessionStreamEvent => ({
  seq,
  sessionId,
  frame: frameAt(seq, kind),
});

const delta = (seq: number, sessionId = SESSION, kind = 'frame'): unknown => ({
  type: 'stream.event',
  event: eventAt(seq, sessionId, kind),
});

const backlog = (events: SessionStreamEvent[], sessionId = SESSION): unknown => ({
  type: 'stream.backlog',
  sessionId,
  events,
});

const reset = (nextSeq: number, sessionId = SESSION): unknown => ({
  type: 'stream.reset',
  sessionId,
  nextSeq,
});

const ack = (commandId: string, stage: CommandAck['stage'], reason?: string): unknown => ({
  type: 'command.ack',
  commandId,
  stage,
  ...(reason ? { reason } : {}),
});

interface Harness {
  state: StreamState;
  host: StreamHost;
  /** Every frame that reached the chokepoint, in order. */
  applied: { sessionId: string; seq: number }[];
  /** Everything the client put on the wire. */
  sent: StreamClientMessage[];
  /** Sessions whose history the store asked to re-read. */
  rereads: string[];
  warnings: string[];
  /** Every record the host was told had failed, in order, as `id:reason`. */
  failures: string[];
  /** The scripted clock, so a timeout is a fact rather than a wait. */
  clock: { now: number };
  /** Feeds one message in as if it had come off the socket. */
  receive(message: unknown): boolean;
  subscribes(): StreamSubscribe[];
  /**
   * Moves the scripted clock forward and runs whatever the ledger armed for
   * that window — and NOTHING else. No frame is fed in, no ack, no socket
   * event: the whole point of the tests that use it is that a tab which
   * receives nothing at all still settles what it sent.
   */
  advance(ms: number): void;
  /** How many timers are armed right now — one, or none, and never more. */
  armed(): number;
}

function harness(
  options: { capable?: boolean; offline?: boolean; timers?: boolean; throws?: string } = {}
): Harness {
  const state = createStreamState();
  if (options.capable) state.capable = true;
  const applied: { sessionId: string; seq: number }[] = [];
  const sent: StreamClientMessage[] = [];
  const rereads: string[] = [];
  const warnings: string[] = [];
  const failures: string[] = [];
  const clock = { now: 1_000 };

  /** The fake clock's alarm book: at most one entry, if the ledger keeps its word. */
  const timers = new Map<number, { at: number; run: () => void }>();
  let nextHandle = 1;

  const host: StreamHost = {
    applyFrame: (sessionId, frame) => {
      const uuid = (frame as { message: { uuid: string } }).message.uuid;
      applied.push({ sessionId, seq: Number(uuid.slice(1)) });
    },
    rereadHistory: (sessionId) => rereads.push(sessionId),
    sendToHub: (message) => {
      // A socket that shuts between the readiness check and the write throws
      // rather than answering false — the case the boolean cannot express.
      if (options.throws) throw new DOMException(options.throws, 'InvalidStateError');
      if (options.offline) return false;
      sent.push(message);
      return true;
    },
    now: () => clock.now,
    warn: (message) => warnings.push(message),
    noteFailure: (record) => failures.push(`${record.commandId}:${record.reason ?? ''}`),
    ...(options.timers
      ? {
          setTimer: (delayMs: number, run: () => void) => {
            const handle = nextHandle++;
            timers.set(handle, { at: clock.now + delayMs, run });
            return handle;
          },
          clearTimer: (handle: number) => {
            timers.delete(handle);
          },
        }
      : {}),
  };

  function advance(ms: number): void {
    const target = clock.now + ms;
    // Re-armed timers land inside the same window, so this drains rather than
    // sweeps once: a burst of commands submitted seconds apart has several
    // deadlines and the ledger walks them one alarm at a time.
    for (;;) {
      let due: [number, { at: number; run: () => void }] | null = null;
      for (const entry of timers) {
        if (entry[1].at > target) continue;
        if (!due || entry[1].at < due[1].at) due = entry;
      }
      if (!due) break;
      timers.delete(due[0]);
      clock.now = Math.max(clock.now, due[1].at);
      due[1].run();
    }
    clock.now = target;
  }

  return {
    advance,
    armed: () => timers.size,
    state,
    host,
    applied,
    sent,
    rereads,
    warnings,
    failures,
    clock,
    receive: (message) => handleStreamMessage(state, host, message),
    subscribes: () =>
      sent.filter(
        (message): message is StreamSubscribe => message.type === 'stream.subscribe'
      ),
  };
}

/* ------------------------------------------------------------------ *
 * Ordering
 * ------------------------------------------------------------------ */

test('ordered delivery of 500 events applies each exactly once, with no dupes and no holes', () => {
  const h = harness({ capable: true });

  for (let seq = 1; seq <= 500; seq++) h.receive(delta(seq));

  expect(h.applied).toHaveLength(500);
  expect(h.applied.map((entry) => entry.seq)).toEqual(
    Array.from({ length: 500 }, (_, index) => index + 1)
  );
  expect(new Set(h.applied.map((entry) => entry.seq)).size).toBe(500);
  expect(h.state.cursors[SESSION].lastSeq).toBe(500);
  // A clean run asks the hub for nothing.
  expect(h.subscribes()).toHaveLength(0);
});

test('a re-delivered delta is dropped rather than applied twice', () => {
  const h = harness({ capable: true });

  h.receive(delta(1));
  h.receive(delta(2));
  h.receive(delta(2));
  h.receive(delta(1));
  h.receive(delta(3));

  expect(h.applied.map((entry) => entry.seq)).toEqual([1, 2, 3]);
  expect(h.state.cursors[SESSION].lastSeq).toBe(3);
});

test('a late join adopts the hub sequence instead of demanding a replay from one', () => {
  const h = harness({ capable: true });

  h.receive(delta(4_211));

  expect(h.applied.map((entry) => entry.seq)).toEqual([4_211]);
  expect(h.subscribes()).toHaveLength(0);
});

/* ------------------------------------------------------------------ *
 * Gaps, resubscribes and resets
 * ------------------------------------------------------------------ */

test('a gap applies nothing and resubscribes with afterSeq at what is actually held', () => {
  const h = harness({ capable: true });

  h.receive(delta(1));
  h.receive(delta(2));
  h.receive(delta(5));

  expect(h.applied.map((entry) => entry.seq)).toEqual([1, 2]);
  expect(h.subscribes()).toEqual([{ type: 'stream.subscribe', sessionId: SESSION, afterSeq: 2 }]);
});

test('a burst of deltas past one gap sends exactly one resubscribe, and buffers nothing', () => {
  const h = harness({ capable: true });

  h.receive(delta(1));
  for (let seq = 5; seq <= 40; seq++) h.receive(delta(seq));

  expect(h.applied.map((entry) => entry.seq)).toEqual([1]);
  expect(h.subscribes()).toHaveLength(1);
  expect(h.state.cursors[SESSION].lastSeq).toBe(1);
});

test('a backlog heals the gap in order, and the stream follows live from its end', () => {
  const h = harness({ capable: true });

  h.receive(delta(1));
  h.receive(delta(4));
  h.receive(backlog([eventAt(2), eventAt(3), eventAt(4)]));
  h.receive(delta(5));

  expect(h.applied.map((entry) => entry.seq)).toEqual([1, 2, 3, 4, 5]);
  expect(h.state.cursors[SESSION].resyncAfter).toBeNull();
});

test('a backlog replayed twice after a retried resubscribe does not double a turn', () => {
  const h = harness({ capable: true });

  h.receive(delta(1));
  h.receive(delta(4));
  h.receive(backlog([eventAt(2), eventAt(3)]));
  h.receive(backlog([eventAt(2), eventAt(3), eventAt(4)]));

  expect(h.applied.map((entry) => entry.seq)).toEqual([1, 2, 3, 4]);
});

test('a non-contiguous backlog is reported once, keeps its valid prefix, and resubscribes', () => {
  const h = harness({ capable: true });

  h.receive(delta(1));
  h.receive(delta(9));
  h.receive(backlog([eventAt(2), eventAt(3), eventAt(7), eventAt(8)]));

  expect(h.applied.map((entry) => entry.seq)).toEqual([1, 2, 3]);
  expect(h.warnings).toHaveLength(1);
  expect(h.subscribes().at(-1)).toEqual({
    type: 'stream.subscribe',
    sessionId: SESSION,
    afterSeq: 3,
  });

  // Said once per session: a hub that is broken now is broken every message.
  h.receive(backlog([eventAt(4), eventAt(9)]));
  expect(h.warnings).toHaveLength(1);
});

test('a ring that cannot heal the gap escalates to a history re-read instead of looping', () => {
  const h = harness({ capable: true });

  h.receive(delta(1));
  for (let attempt = 0; attempt < MAX_RESYNC_ATTEMPTS; attempt++) {
    h.receive(delta(9 + attempt));
    h.receive(backlog([eventAt(2), eventAt(8)]));
  }

  expect(h.rereads).toEqual([SESSION]);
  expect(h.subscribes().at(-1)).toEqual({ type: 'stream.subscribe', sessionId: SESSION });
});

test('a reset re-reads history, follows from nextSeq, and applies the deltas racing it', () => {
  const h = harness({ capable: true });

  h.receive(delta(1));
  h.receive(reset(40));
  h.receive(delta(40));
  h.receive(delta(41));

  expect(h.rereads).toEqual([SESSION]);
  expect(h.applied.map((entry) => entry.seq)).toEqual([1, 40, 41]);
  expect(h.state.cursors[SESSION].lastSeq).toBe(41);
});

test('a reset arriving twice re-reads twice — a second gap is not a no-op', () => {
  const h = harness({ capable: true });

  h.receive(reset(10));
  h.receive(delta(10));
  h.receive(reset(80));

  expect(h.rereads).toEqual([SESSION, SESSION]);
  expect(h.state.cursors[SESSION].lastSeq).toBe(79);
});

test('sessions keep their own cursors: one session gapping does not disturb another', () => {
  const h = harness({ capable: true });
  const other = 'inst-2';

  h.receive(delta(1));
  h.receive(delta(1, other));
  h.receive(delta(2, other));
  h.receive(delta(7));
  h.receive(delta(3, other));

  expect(h.applied).toEqual([
    { sessionId: SESSION, seq: 1 },
    { sessionId: other, seq: 1 },
    { sessionId: other, seq: 2 },
    { sessionId: other, seq: 3 },
  ]);
  expect(h.subscribes()).toEqual([{ type: 'stream.subscribe', sessionId: SESSION, afterSeq: 1 }]);
});

/* ------------------------------------------------------------------ *
 * Capability and the switch-over
 * ------------------------------------------------------------------ */

test('capability is detected off any message that carries it, whichever one that is', () => {
  const h = harness();

  expect(noteCapabilities(h.state, { verb: 'frames', payload: {} })).toBe(false);
  expect(noteCapabilities(h.state, { verb: 'instances', capabilities: ['other.v9'] })).toBe(false);
  expect(noteCapabilities(h.state, { verb: 'instances', capabilities: [STREAM_V1] })).toBe(true);
  expect(h.state.capable).toBe(true);
  // Only the flip is announced; the announcement is what subscribes.
  expect(noteCapabilities(h.state, { capabilities: [STREAM_V1] })).toBe(false);
});

test('capability arriving after frames already flowed legacy switches cleanly, without a double ask', () => {
  const h = harness();
  const other = 'inst-2';

  // Frames have been reaching the store down the legacy path. The first
  // sequenced message is itself the announcement — a client that missed the
  // handshake still ends up in the right mode.
  expect(h.receive(delta(1))).toBe(true);
  expect(h.state.capable).toBe(true);

  syncStreamSubscriptions(h.state, h.host, [SESSION, other]);

  // The session the hub is already streaming is not asked for a second time;
  // the one it is not gets joined from now.
  expect(h.subscribes()).toEqual([{ type: 'stream.subscribe', sessionId: other }]);

  h.receive(delta(2));
  expect(h.applied.map((entry) => entry.seq)).toEqual([1, 2]);
});

test('the legacy copy of a frame the stream is carrying is dropped, other kinds still flow', () => {
  const h = harness({ capable: true });
  syncStreamSubscriptions(h.state, h.host, [SESSION]);

  expect(streamCarries(h.state, SESSION, 'frame')).toBe(false);
  h.receive(delta(1, SESSION, 'frame'));
  expect(streamCarries(h.state, SESSION, 'frame')).toBe(true);
  // Never seen on the stream — the rail must not be starved of it.
  expect(streamCarries(h.state, SESSION, 'pulse')).toBe(false);
  // Another session's stream says nothing about this one.
  expect(streamCarries(h.state, 'inst-2', 'frame')).toBe(false);
});

test('a reconnect resumes from the cursor it kept, and gives the legacy path back meanwhile', () => {
  const h = harness({ capable: true });
  syncStreamSubscriptions(h.state, h.host, [SESSION]);
  h.receive(delta(1));
  h.receive(delta(7)); // a resubscribe is in flight when the socket dies

  noteDisconnect(h.state, h.clock.now);

  expect(h.state.capable).toBe(false);
  expect(streamCarries(h.state, SESSION, 'frame')).toBe(false);
  expect(h.state.cursors[SESSION].lastSeq).toBe(1);

  h.state.capable = true;
  syncStreamSubscriptions(h.state, h.host, [SESSION]);
  expect(h.subscribes().at(-1)).toEqual({
    type: 'stream.subscribe',
    sessionId: SESSION,
    afterSeq: 1,
  });

  // And the resume that died with the old socket does not block the new gap.
  h.receive(delta(9));
  expect(h.subscribes().at(-1)).toEqual({
    type: 'stream.subscribe',
    sessionId: SESSION,
    afterSeq: 1,
  });
  h.receive(backlog([eventAt(2)]));
  h.receive(delta(9));
  expect(h.subscribes().at(-1)).toEqual({
    type: 'stream.subscribe',
    sessionId: SESSION,
    afterSeq: 2,
  });
});

test('a closed session is forgotten, so re-opening it joins fresh rather than resuming a dead seq', () => {
  const h = harness({ capable: true });
  syncStreamSubscriptions(h.state, h.host, [SESSION]);
  h.receive(delta(1));

  syncStreamSubscriptions(h.state, h.host, []);
  expect(h.state.cursors[SESSION]).toBeUndefined();

  syncStreamSubscriptions(h.state, h.host, [SESSION]);
  expect(h.subscribes().at(-1)).toEqual({ type: 'stream.subscribe', sessionId: SESSION });
});

test('an event the hub could not fill still moves the cursor, so one blank is not a hole', () => {
  const h = harness({ capable: true });

  h.receive(delta(1));
  h.receive({ type: 'stream.event', event: { seq: 2, sessionId: SESSION, frame: null } });
  h.receive(delta(3));

  expect(h.applied.map((entry) => entry.seq)).toEqual([1, 3]);
  expect(h.warnings).toHaveLength(1);
  expect(h.subscribes()).toHaveLength(0);
});

test('a subscribe that could not leave is retried, not assumed to have been sent', () => {
  const offline = harness({ capable: true, offline: true });
  syncStreamSubscriptions(offline.state, offline.host, [SESSION]);
  expect(offline.state.cursors[SESSION].subscribed).toBe(false);

  const h = harness({ capable: true });
  syncStreamSubscriptions(h.state, h.host, [SESSION]);
  expect(h.subscribes()).toEqual([{ type: 'stream.subscribe', sessionId: SESSION }]);
  // Already asked for: the next sync does not ask again.
  syncStreamSubscriptions(h.state, h.host, [SESSION]);
  expect(h.subscribes()).toHaveLength(1);
});

/* ------------------------------------------------------------------ *
 * Commands
 * ------------------------------------------------------------------ */

/**
 * Every submission has to declare where its kind stops being spoken about —
 * `send` at `accepted`, the control kinds at `applied`. The helper mirrors
 * what the client does at the call site rather than hiding it, because that
 * choice is the subject of half the tests below.
 */
const settleStageOf = (kind: CommandKind): SettleStage => (kind === 'send' ? 'accepted' : 'applied');

const submit = (h: Harness, kind: 'send' | 'set-model' = 'send', legacy = () => {}): string =>
  submitCommand(h.state, h.host, {
    commandId: `cmd-${Object.keys(h.state.commands).length + 1}`,
    sessionId: SESSION,
    machineId: 'mac-1',
    kind,
    settlesAt: settleStageOf(kind),
    payload: { instanceId: SESSION },
    legacy,
  });

test('a command against a stream hub goes out as an envelope and waits at submitted', () => {
  const h = harness({ capable: true });

  const commandId = submit(h);

  expect(h.sent).toEqual([
    {
      type: 'command',
      commandId,
      sessionId: SESSION,
      machineId: 'mac-1',
      kind: 'send',
      payload: { instanceId: SESSION },
    },
  ]);
  expect(h.state.commands[commandId].stage).toBe('submitted');
});

test('acks walk a command submitted -> accepted -> applied, and the UI can read it back', () => {
  const h = harness({ capable: true });
  const commandId = submit(h);

  h.receive(ack(commandId, 'accepted'));
  expect(h.state.commands[commandId].stage).toBe('accepted');

  h.clock.now += 50;
  h.receive(ack(commandId, 'applied'));

  const latest = latestCommand(h.state, SESSION, 'send');
  expect(latest?.commandId).toBe(commandId);
  expect(latest?.stage).toBe('applied');
  expect(latest?.changedAt).toBe(h.clock.now);
});

test('a failed ack carries its reason, and nothing walks a settled command back', () => {
  const h = harness({ capable: true });
  const commandId = submit(h);

  h.receive(ack(commandId, 'failed', 'session is not running'));
  expect(h.state.commands[commandId]).toMatchObject({
    stage: 'failed',
    reason: 'session is not running',
  });

  // An accepted that overtook its own failure must not resurrect the command.
  h.receive(ack(commandId, 'accepted'));
  h.receive(ack(commandId, 'applied'));
  expect(h.state.commands[commandId].stage).toBe('failed');
});

test('an ack for a command this tab never submitted is not ours to record', () => {
  const h = harness({ capable: true });

  expect(h.receive(ack('cmd-from-another-tab', 'applied'))).toBe(true);
  expect(Object.keys(h.state.commands)).toHaveLength(0);
});

test('against a legacy hub the command runs today call, and its promise is the stage', async () => {
  const h = harness();
  let ran = 0;

  const sync = submit(h, 'send', () => {
    ran++;
  });
  expect(h.sent).toHaveLength(0);
  expect(ran).toBe(1);
  // A fire-and-forget relay op is accepted, never claimed as applied.
  expect(h.state.commands[sync].stage).toBe('accepted');

  const settled = submitCommand(h.state, h.host, {
    commandId: 'cmd-async',
    sessionId: SESSION,
    machineId: 'mac-1',
    kind: 'set-model',
    settlesAt: settleStageOf('set-model'),
    payload: {},
    legacy: () => Promise.resolve('ok'),
  });
  await Promise.resolve();
  expect(h.state.commands[settled].stage).toBe('applied');
});

test('a legacy command that throws fails with the reason, and never throws at the caller', async () => {
  const h = harness();

  const thrown = submit(h, 'send', () => {
    throw new Error('Not connected to the hub.');
  });
  expect(h.state.commands[thrown]).toMatchObject({
    stage: 'failed',
    reason: 'Not connected to the hub.',
  });

  const rejected = submitCommand(h.state, h.host, {
    commandId: 'cmd-reject',
    sessionId: SESSION,
    machineId: 'mac-1',
    kind: 'set-model',
    settlesAt: settleStageOf('set-model'),
    payload: {},
    legacy: () => Promise.reject(new Error('the machine refused')),
  });
  await Promise.resolve();
  await Promise.resolve();
  expect(h.state.commands[rejected]).toMatchObject({
    stage: 'failed',
    reason: 'the machine refused',
  });
});

test('a command that cannot leave the tab is failed at once, not left spinning', () => {
  const h = harness({ capable: true, offline: true });

  const commandId = submit(h);

  expect(h.state.commands[commandId].stage).toBe('failed');
  expect(h.state.commands[commandId].reason).toContain('Not connected');
});

test('a dropped socket calls unanswered commands off and leaves settled ones alone', () => {
  const h = harness({ capable: true });
  const outstanding = submit(h);
  const landed = submit(h);
  h.receive(ack(landed, 'applied'));

  h.clock.now += 10;
  noteDisconnect(h.state, h.clock.now);

  expect(h.state.commands[outstanding]).toMatchObject({ stage: 'failed', changedAt: h.clock.now });
  expect(h.state.commands[outstanding].reason).toContain('dropped');
  expect(h.state.commands[landed].stage).toBe('applied');
});

test('a command nobody ever acknowledged is called off rather than spun forever', () => {
  const h = harness({ capable: true });
  const commandId = submit(h);

  h.clock.now += COMMAND_ACK_TIMEOUT_MS - 1;
  sweepCommands(h.state, h.clock.now);
  expect(h.state.commands[commandId].stage).toBe('submitted');

  h.clock.now += 2;
  sweepCommands(h.state, h.clock.now);
  expect(h.state.commands[commandId]).toMatchObject({
    stage: 'failed',
    reason: 'The hub never acknowledged that.',
  });
});

test('the tracker is capped: settled commands age out, the newest stay readable', () => {
  const h = harness({ capable: true });

  for (let index = 0; index < SETTLED_COMMAND_LIMIT + 20; index++) {
    h.clock.now += 1;
    const commandId = submitCommand(h.state, h.host, {
      commandId: `cmd-${index}`,
      sessionId: SESSION,
      machineId: 'mac-1',
      kind: 'send',
      settlesAt: settleStageOf('send'),
      payload: {},
      legacy: () => {},
    });
    h.receive(ack(commandId, 'applied'));
  }
  sweepCommands(h.state, h.clock.now);

  expect(Object.keys(h.state.commands)).toHaveLength(SETTLED_COMMAND_LIMIT);
  expect(h.state.commands['cmd-0']).toBeUndefined();
  expect(latestCommand(h.state, SESSION, 'send')?.commandId).toBe(
    `cmd-${SETTLED_COMMAND_LIMIT + 19}`
  );
});

/* ------------------------------------------------------------------ *
 * Stream effects — the command's LOCAL half
 *
 * Regression for the sent-message-with-no-renderer defect: the stream
 * dialect dispatched the envelope and skipped everything the legacy
 * function did locally (the transcript echo, the busy flip, an answered
 * permission leaving `pending`, a setting's optimistic value). The
 * tracker now runs the submission's `streamEffects` — submitted at
 * dispatch, settled exactly once on ack, refusal, timeout or disconnect
 * — and never on the legacy dialect, whose thunk owns its own half.
 * ------------------------------------------------------------------ */

// A CONTROL command, deliberately: its protocol has a second word (`applied`),
// so it is the kind whose effects wait past `accepted`. A send's own version of
// this story — settling at `accepted`, because nothing else is coming — is the
// test named for it further down.
test('the stream dialect runs a command\'s local effects: submitted at dispatch, settled once on the applied ack', () => {
  const h = harness({ capable: true });
  const calls: string[] = [];
  const commandId = submitCommand(h.state, h.host, {
    commandId: 'fx-1',
    sessionId: SESSION,
    machineId: 'mac-1',
    kind: 'set-model',
    settlesAt: settleStageOf('set-model'),
    payload: { instanceId: SESSION },
    legacy: () => {
      calls.push('legacy');
    },
    streamEffects: {
      submitted: () => calls.push('submitted'),
      settled: (stage) => calls.push(`settled:${stage}`),
    },
  });
  expect(calls).toEqual(['submitted']);
  h.receive(ack(commandId, 'accepted'));
  expect(calls).toEqual(['submitted']);
  h.receive(ack(commandId, 'applied'));
  expect(calls).toEqual(['submitted', 'settled:applied']);
  // A late duplicate settles nothing twice.
  h.receive(ack(commandId, 'failed', 'too late'));
  expect(calls).toEqual(['submitted', 'settled:applied']);
});

test('a refused command settles its effects with failed and the reason the row will show', () => {
  const h = harness({ capable: true });
  const settled: Array<[string, string | undefined]> = [];
  const commandId = submitCommand(h.state, h.host, {
    commandId: 'fx-2',
    sessionId: SESSION,
    machineId: 'mac-1',
    kind: 'set-model',
    settlesAt: settleStageOf('set-model'),
    payload: { instanceId: SESSION },
    legacy: () => {},
    streamEffects: { settled: (stage, reason) => settled.push([stage, reason]) },
  });
  h.receive(ack(commandId, 'failed', 'the machine refused it'));
  expect(settled).toEqual([['failed', 'the machine refused it']]);
});

test('a dying socket settles outstanding effects with failed — the optimistic value rolls back on disconnect too', () => {
  const h = harness({ capable: true });
  const calls: string[] = [];
  submitCommand(h.state, h.host, {
    commandId: 'fx-3',
    sessionId: SESSION,
    machineId: 'mac-1',
    kind: 'set-effort',
    settlesAt: settleStageOf('set-effort'),
    payload: { instanceId: SESSION },
    legacy: () => {},
    streamEffects: {
      submitted: () => calls.push('submitted'),
      settled: (stage) => calls.push(`settled:${stage}`),
    },
  });
  noteDisconnect(h.state, 1_000_000);
  expect(calls).toEqual(['submitted', 'settled:failed']);
});

test('the legacy dialect never reads stream effects — its thunk owns the local half', () => {
  const h = harness({ capable: false });
  const calls: string[] = [];
  submitCommand(h.state, h.host, {
    commandId: 'fx-4',
    sessionId: SESSION,
    machineId: 'mac-1',
    kind: 'send',
    settlesAt: settleStageOf('send'),
    payload: { instanceId: SESSION },
    legacy: () => {
      calls.push('legacy');
    },
    streamEffects: {
      submitted: () => calls.push('submitted'),
      settled: (stage) => calls.push(`settled:${stage}`),
    },
  });
  expect(calls).toEqual(['legacy']);
});

test('a result.error inside the shadow of this client\'s own interrupt command is recognisable — outside it, or after a refusal, it is not', () => {
  const h = harness({ capable: true });
  submitCommand(h.state, h.host, {
    commandId: 'int-1',
    sessionId: SESSION,
    machineId: 'mac-1',
    kind: 'interrupt',
    settlesAt: settleStageOf('interrupt'),
    payload: { instanceId: SESSION },
    legacy: () => {},
  });
  const submittedAt = h.state.commands['int-1'].at;
  expect(interruptedRecently(h.state, SESSION, submittedAt + 5_000)).toBe(true);
  expect(interruptedRecently(h.state, 'someone-else', submittedAt + 5_000)).toBe(false);
  expect(interruptedRecently(h.state, SESSION, submittedAt + 60_000)).toBe(false);
  h.receive(ack('int-1', 'failed', 'no such session'));
  expect(interruptedRecently(h.state, SESSION, submittedAt + 5_000)).toBe(false);
});

/* ------------------------------------------------------------------ *
 * Settle stages — what "finished" means, per kind
 *
 * The hub answers a `send` with `accepted` and NOTHING ELSE: its own
 * comment calls that "the last honest word the hub has", because the
 * proof of application is the turn itself arriving. The control kinds
 * do get a second word, `applied`, out of their `control_result`.
 *
 * A ledger that measured both against `applied` therefore had one kind
 * it could never finish, and swept it into `failed` fifteen seconds
 * after it had in fact been delivered. These tests are the fence around
 * that: the sweep may only call off a command that is genuinely short
 * of its own last word.
 * ------------------------------------------------------------------ */

test('a delivered message is finished at accepted: the sweep leaves it alone instead of retro-failing it', () => {
  const h = harness({ capable: true });
  const commandId = submit(h, 'send');

  h.receive(ack(commandId, 'accepted'));
  expect(h.state.commands[commandId].stage).toBe('accepted');

  // Long past the point where an unanswered command is called off.
  h.clock.now += COMMAND_ACK_TIMEOUT_MS * 3;
  sweepCommands(h.state, h.clock.now, h.host);

  expect(h.state.commands[commandId].stage).toBe('accepted');
  expect(h.state.commands[commandId].reason).toBeUndefined();
  expect(h.failures).toEqual([]);
});

test('a control command left at accepted with no result is still called off', () => {
  const h = harness({ capable: true });
  const commandId = submit(h, 'set-model');

  h.receive(ack(commandId, 'accepted'));
  h.clock.now += COMMAND_ACK_TIMEOUT_MS + 1;
  sweepCommands(h.state, h.clock.now, h.host);

  expect(h.state.commands[commandId]).toMatchObject({
    stage: 'failed',
    reason: 'The hub never acknowledged that.',
  });
  expect(h.failures).toEqual([`${commandId}:The hub never acknowledged that.`]);
});

test('a send accepted before the socket died is not taken back by the disconnect', () => {
  const h = harness({ capable: true });
  const delivered = submit(h, 'send');
  const pending = submit(h, 'set-model');
  h.receive(ack(delivered, 'accepted'));
  h.receive(ack(pending, 'accepted'));

  h.clock.now += 10;
  noteDisconnect(h.state, h.clock.now, h.host);

  expect(h.state.commands[delivered].stage).toBe('accepted');
  expect(h.state.commands[pending].stage).toBe('failed');
  expect(h.failures).toHaveLength(1);
});

test("a send's local half settles exactly once, at accepted, and a later ack cannot re-run it", () => {
  const h = harness({ capable: true });
  const calls: string[] = [];
  const commandId = submitCommand(h.state, h.host, {
    commandId: 'settle-1',
    sessionId: SESSION,
    machineId: 'mac-1',
    kind: 'send',
    settlesAt: settleStageOf('send'),
    payload: { instanceId: SESSION },
    legacy: () => {},
    streamEffects: {
      submitted: () => calls.push('submitted'),
      settled: (stage) => calls.push(`settled:${stage}`),
    },
  });

  h.receive(ack(commandId, 'accepted'));
  expect(calls).toEqual(['submitted', 'settled:accepted']);

  // Anything arriving afterwards — a stray applied, a late failure — finds the
  // hook already spent. The ghost goes solid once and stays that way.
  h.receive(ack(commandId, 'applied'));
  h.receive(ack(commandId, 'failed', 'too late'));
  expect(calls).toEqual(['submitted', 'settled:accepted']);
});

test('a legacy fire-and-forget command is finished when it returns, not retro-failed 15s later', () => {
  const h = harness();
  const commandId = submitCommand(h.state, h.host, {
    commandId: 'legacy-interrupt',
    sessionId: SESSION,
    machineId: 'mac-1',
    kind: 'interrupt',
    // Declared like every other control kind — the fire-and-forget return is
    // what lowers its last word to `accepted`, not the call site guessing.
    settlesAt: settleStageOf('interrupt'),
    payload: {},
    legacy: () => {},
  });
  expect(h.state.commands[commandId].stage).toBe('accepted');

  h.clock.now += COMMAND_ACK_TIMEOUT_MS * 2;
  sweepCommands(h.state, h.clock.now, h.host);

  expect(h.state.commands[commandId].stage).toBe('accepted');
  expect(h.failures).toEqual([]);
});

/* ------------------------------------------------------------------ *
 * The failure port — every failed record is said out loud, once
 * ------------------------------------------------------------------ */

test('every path to failed announces itself exactly once, and no successful path does', () => {
  const refused = harness({ capable: true });
  const refusedId = submit(refused, 'set-model');
  refused.receive(ack(refusedId, 'failed', 'the machine refused it'));
  // A late duplicate ack cannot announce the same failure twice.
  refused.receive(ack(refusedId, 'failed', 'again'));
  expect(refused.failures).toEqual([`${refusedId}:the machine refused it`]);

  const undeliverable = harness({ capable: true, offline: true });
  const undeliverableId = submit(undeliverable, 'send');
  expect(undeliverable.failures).toHaveLength(1);
  expect(undeliverable.failures[0]).toContain('Not connected');
  expect(undeliverable.state.commands[undeliverableId].stage).toBe('failed');

  const swept = harness({ capable: true });
  submit(swept, 'set-model');
  swept.clock.now += COMMAND_ACK_TIMEOUT_MS;
  sweepCommands(swept.state, swept.clock.now, swept.host);
  sweepCommands(swept.state, swept.clock.now, swept.host);
  expect(swept.failures).toHaveLength(1);

  const dropped = harness({ capable: true });
  submit(dropped, 'set-model');
  noteDisconnect(dropped.state, dropped.clock.now, dropped.host);
  noteDisconnect(dropped.state, dropped.clock.now, dropped.host);
  expect(dropped.failures).toHaveLength(1);

  const landed = harness({ capable: true });
  const control = submit(landed, 'set-model');
  landed.receive(ack(control, 'accepted'));
  landed.receive(ack(control, 'applied'));
  const message = submit(landed, 'send');
  landed.receive(ack(message, 'accepted'));
  expect(landed.failures).toEqual([]);
});

test('a legacy rejection is announced through the same port as a refusal on the wire', async () => {
  const h = harness();
  submitCommand(h.state, h.host, {
    commandId: 'legacy-reject',
    sessionId: SESSION,
    machineId: 'mac-1',
    kind: 'set-model',
    settlesAt: settleStageOf('set-model'),
    payload: {},
    legacy: () => Promise.reject(new Error('the machine refused')),
  });
  await Promise.resolve();
  await Promise.resolve();
  expect(h.failures).toEqual(['legacy-reject:the machine refused']);
});

/* ------------------------------------------------------------------ *
 * failLocally — a command that never reached the wire is still a record
 *
 * The caller assembles a payload before it can call submitCommand, and a
 * throw in that assembly used to escape the ledger entirely: no record,
 * no stage, nothing on screen, an exception in a click handler. This is
 * the door it goes through instead.
 * ------------------------------------------------------------------ */

test('a command that died before dispatch is a failed record like any other — swept, readable, announced', () => {
  const h = harness({ capable: true });

  const commandId = failLocally(
    h.state,
    h.host,
    {
      commandId: 'stillborn-1',
      sessionId: SESSION,
      kind: 'send',
      settlesAt: settleStageOf('send'),
    },
    'crypto.randomUUID is not a function'
  );

  expect(commandId).toBe('stillborn-1');
  expect(h.sent).toHaveLength(0);
  expect(h.state.commands[commandId]).toMatchObject({
    stage: 'failed',
    reason: 'crypto.randomUUID is not a function',
  });
  // Visible to the session's readers, exactly like a record that failed on the wire.
  expect(sessionCommands(h.state, SESSION).map((record) => record.commandId)).toEqual([commandId]);
  expect(h.failures).toEqual([`${commandId}:crypto.randomUUID is not a function`]);

  // And it ages out on the ledger's own terms rather than living forever.
  h.clock.now += SETTLED_COMMAND_TTL_MS;
  sweepCommands(h.state, h.clock.now, h.host);
  expect(h.state.commands[commandId]).toBeUndefined();
});

/* ------------------------------------------------------------------ *
 * The timeout is a timeout
 *
 * COMMAND_ACK_TIMEOUT_MS used to be enforced only by a sweep the client ran on
 * INBOUND SOCKET TRAFFIC. So the deadline for "nobody answered" was policed by
 * the arrival of messages — the very thing whose absence it was written to
 * detect. Measured before this: a send whose frame was swallowed sat at
 * `submitted` for twenty seconds with no failure, no toast and no live-region
 * text, and only failed once unrelated traffic was provoked. On a quiet tab it
 * would never have failed at all: a permanent ghost.
 * ------------------------------------------------------------------ */

test('an unanswered command calls itself off with no inbound traffic at all', () => {
  const h = harness({ capable: true, timers: true });

  const commandId = submit(h, 'send');
  expect(h.state.commands[commandId].stage).toBe('submitted');
  // One alarm, armed by the submit itself.
  expect(h.armed()).toBe(1);

  // Nothing is fed in. No frame, no ack, no socket event — only time.
  h.advance(COMMAND_ACK_TIMEOUT_MS);

  expect(h.state.commands[commandId]).toMatchObject({
    stage: 'failed',
    reason: 'The hub never acknowledged that.',
  });
  expect(h.failures).toEqual([`${commandId}:The hub never acknowledged that.`]);
  // And nothing is left ticking once nothing is outstanding.
  expect(h.armed()).toBe(0);
});

test('the timer fires no earlier than the deadline: a command still inside its window is left alone', () => {
  const h = harness({ capable: true, timers: true });
  const commandId = submit(h, 'send');

  h.advance(COMMAND_ACK_TIMEOUT_MS - 1);

  expect(h.state.commands[commandId].stage).toBe('submitted');
  expect(h.failures).toEqual([]);
  expect(h.armed()).toBe(1);
});

test('an ack inside the window settles the command and disarms the timer rather than leaving it to fire', () => {
  const h = harness({ capable: true, timers: true });
  const commandId = submit(h, 'send');

  h.receive(ack(commandId, 'accepted'));
  // The ack does not sweep, so the alarm is still booked — but it finds
  // nothing to call off and takes itself down.
  h.advance(COMMAND_ACK_TIMEOUT_MS);

  expect(h.state.commands[commandId].stage).toBe('accepted');
  expect(h.failures).toEqual([]);
  expect(h.armed()).toBe(0);
});

test('a burst of commands is one alarm, not one alarm each, and each is called off at its own deadline', () => {
  const h = harness({ capable: true, timers: true });

  const first = submit(h, 'set-model');
  expect(h.armed()).toBe(1);
  h.advance(5_000);
  const second = submit(h, 'set-model');
  // Still ONE: a flapping socket must not leak a timer per keystroke.
  expect(h.armed()).toBe(1);
  h.advance(5_000);
  const third = submit(h, 'set-model');
  expect(h.armed()).toBe(1);

  // Walk past the first deadline only.
  h.advance(COMMAND_ACK_TIMEOUT_MS - 10_000);
  expect(h.state.commands[first].stage).toBe('failed');
  expect(h.state.commands[second].stage).toBe('submitted');
  expect(h.state.commands[third].stage).toBe('submitted');
  expect(h.armed()).toBe(1);

  // Then past the rest, one deadline at a time, off the re-armed alarm.
  h.advance(COMMAND_ACK_TIMEOUT_MS);
  expect(h.state.commands[second].stage).toBe('failed');
  expect(h.state.commands[third].stage).toBe('failed');
  expect(h.failures).toHaveLength(3);
  expect(h.armed()).toBe(0);
});

test('the alarm outlives the socket that had nothing to do with it: a command submitted while offline still fails on its own', () => {
  // Offline means the dispatch is refused, which fails the record immediately —
  // so what is being proven here is the other half: a ledger whose socket never
  // delivers anything is exactly the case where a traffic-driven sweep is dead,
  // and the record settles anyway.
  const h = harness({ capable: true, offline: true, timers: true });
  const commandId = submit(h, 'set-model');

  expect(h.state.commands[commandId].stage).toBe('failed');
  expect(h.armed()).toBe(0);
  expect(h.failures).toHaveLength(1);
});

test('a teardown cancels the alarm, so a disposed client leaves nothing ticking', () => {
  const h = harness({ capable: true, timers: true });
  submit(h, 'send');
  expect(h.armed()).toBe(1);

  disarmCommandSweep(h.state, h.host);

  expect(h.armed()).toBe(0);
  expect(h.state.sweepTimer).toBeNull();
  // Idempotent: a second teardown is not an error and does not re-arm.
  disarmCommandSweep(h.state, h.host);
  expect(h.armed()).toBe(0);
});

test('a host with no clock is unchanged: the ledger still works, it is just only swept from outside', () => {
  const h = harness({ capable: true });
  const commandId = submit(h, 'send');

  expect(h.state.sweepTimer).toBeNull();
  h.clock.now += COMMAND_ACK_TIMEOUT_MS;
  sweepCommands(h.state, h.clock.now, h.host);
  expect(h.state.commands[commandId].stage).toBe('failed');
});

/* ------------------------------------------------------------------ *
 * The never-throws contract, all the way down
 *
 * `sendToHub` answers false for a socket it can SEE is shut. It cannot answer
 * for a socket that shuts between that check and the `send()` after it —
 * `WebSocket.send` on a CLOSING socket throws `InvalidStateError`. Unguarded,
 * that throw walked out of the one function that promises never to throw and
 * reached a click handler as an unhandled rejection: the original bug class,
 * one layer down.
 * ------------------------------------------------------------------ */

test('a dispatch that throws is a refusal wearing its own reason, not an exception at the caller', () => {
  const h = harness({ capable: true, throws: 'The connection is closing.' });

  let commandId = '';
  expect(() => {
    commandId = submit(h, 'send');
  }).not.toThrow();

  expect(h.state.commands[commandId]).toMatchObject({
    stage: 'failed',
    reason: 'The connection is closing.',
    // Nothing left the tab, and the record says so as a fact.
    undelivered: true,
  });
  expect(h.failures).toEqual([`${commandId}:The connection is closing.`]);
});

test("a throwing socket does not take the stream's own subscribes down with it", () => {
  const h = harness({ capable: true, throws: 'The connection is closing.' });

  // Adopt an origin first, so the delta after it is a genuine hole and the
  // resume it provokes really does reach for the socket.
  h.receive(delta(1));
  expect(h.applied.map((entry) => entry.seq)).toEqual([1]);
  // A resume goes out through the same door; it must refuse, not explode
  // inside the socket's onmessage handler.
  expect(() => h.receive(delta(5))).not.toThrow();
  expect(h.applied.map((entry) => entry.seq)).toEqual([1]);
  // The hole is left unclaimed, so the next delta through it tries again —
  // exactly what a subscribe that never left is supposed to leave behind.
  expect(h.state.cursors[SESSION].resyncAfter).toBeNull();
});

/* ------------------------------------------------------------------ *
 * Provably undelivered vs merely unanswered
 *
 * A retry is a one-tap instruction to an agent that acts on the world. The
 * ledger knows the difference between "this never left the tab" and "this may
 * be in the daemon's hands and the ack path died", and the UI may not offer
 * both with the same confidence — so the difference is a fact on the record
 * rather than a guess read off the wording of a reason.
 * ------------------------------------------------------------------ */

test('only the failures this tab can prove never left are marked undelivered', () => {
  const refused = harness({ capable: true, offline: true });
  const refusedId = submit(refused, 'send');
  expect(refused.state.commands[refusedId].undelivered).toBe(true);

  const stillborn = harness({ capable: true });
  const stillbornId = failLocally(
    stillborn.state,
    stillborn.host,
    { commandId: 'pre-1', sessionId: SESSION, kind: 'send', settlesAt: 'accepted' },
    'wirePayload blew up'
  );
  expect(stillborn.state.commands[stillbornId].undelivered).toBe(true);

  // Ambiguous: the envelope went out and the hub simply never answered.
  const swept = harness({ capable: true });
  const sweptId = submit(swept, 'send');
  swept.clock.now += COMMAND_ACK_TIMEOUT_MS;
  sweepCommands(swept.state, swept.clock.now, swept.host);
  expect(swept.state.commands[sweptId].stage).toBe('failed');
  expect(swept.state.commands[sweptId].undelivered).toBeUndefined();

  // Ambiguous too: the socket died after the envelope was already gone.
  const dropped = harness({ capable: true });
  const droppedId = submit(dropped, 'set-model');
  noteDisconnect(dropped.state, dropped.clock.now, dropped.host);
  expect(dropped.state.commands[droppedId].stage).toBe('failed');
  expect(dropped.state.commands[droppedId].undelivered).toBeUndefined();
});

/* ------------------------------------------------------------------ *
 * One failure, one report
 *
 * The client's failure reporter decides whether a kind's own surface has
 * already claimed a failure (a permission card rendering "Couldn't send that
 * answer." off the record) or whether a toast is the only thing that will say
 * it. That decision runs INSIDE `noteFailure`, and the timing below is why the
 * registry it consults has to be written before the submit, not after it: the
 * legacy dialect's synchronous throw reaches the reporter before `submitCommand`
 * has returned, so a registration on the line after the call is a registration
 * that has not happened yet. Registered late, the reporter saw nothing, toasted,
 * and the still-parked card rendered the same failure: one failure, two reports.
 * ------------------------------------------------------------------ */

test('a failure is reported before submitCommand returns, on both dialects — so a surface must be claimed before the call', () => {
  const legacy = harness();
  let reportedDuringLegacyCall = false;
  const legacyId = submitCommand(legacy.state, legacy.host, {
    commandId: 'answer-legacy',
    sessionId: SESSION,
    machineId: 'mac-1',
    kind: 'permission.answer',
    settlesAt: 'applied',
    payload: {},
    legacy: () => {
      throw new Error('Not connected to the hub.');
    },
  });
  reportedDuringLegacyCall = legacy.failures.length === 1;
  expect(reportedDuringLegacyCall).toBe(true);
  expect(legacy.state.commands[legacyId].stage).toBe('failed');

  const stream = harness({ capable: true, offline: true });
  const streamId = submitCommand(stream.state, stream.host, {
    commandId: 'answer-stream',
    sessionId: SESSION,
    machineId: 'mac-1',
    kind: 'permission.answer',
    settlesAt: 'applied',
    payload: {},
    legacy: () => {},
  });
  expect(stream.failures).toHaveLength(1);
  expect(stream.state.commands[streamId].stage).toBe('failed');
});

test('a permission answer that fails is announced exactly once on each dialect, given a registry written before the submit', () => {
  /**
   * A miniature of the client's arbitration: a card is "on screen" while its
   * request is parked, the reporter suppresses the toast when a card owns the
   * failure, and the card renders the failure it owns. What is counted is
   * REPORTS — card lines plus toasts — and the answer must be one, never two
   * and never zero.
   */
  function run(dialect: 'stream' | 'legacy'): { toasts: number; cards: number } {
    let parked = true;
    const claimed = new Map<string, boolean>();
    let toasts = 0;

    const h = harness(
      dialect === 'stream' ? { capable: true, offline: true } : { capable: false }
    );
    h.host.noteFailure = (record) => {
      // The card claims the failure only while it is genuinely still rendered.
      if (claimed.has(record.commandId) && parked) return;
      toasts += 1;
    };

    const commandId = 'answer-1';
    // BEFORE the submit — the whole subject of this test.
    claimed.set(commandId, true);
    submitCommand(h.state, h.host, {
      commandId,
      sessionId: SESSION,
      machineId: 'mac-1',
      kind: 'permission.answer',
      settlesAt: 'applied',
      payload: {},
      legacy: () => {
        // Legacy `resolvePermission` puts the control on the wire FIRST and
        // unparks the card only afterwards, so a throw leaves it on screen.
        throw new Error('Not connected to the hub.');
      },
      streamEffects: {
        // The stream dialect unparks at dispatch, before anything can fail.
        submitted: () => {
          parked = false;
        },
      },
    });

    const cards = h.state.commands[commandId].stage === 'failed' && parked ? 1 : 0;
    return { toasts, cards };
  }

  const legacy = run('legacy');
  // The card is still up and renders the refusal; the toast stands down.
  expect(legacy).toEqual({ toasts: 0, cards: 1 });

  const stream = run('stream');
  // The card is already gone, so the toast IS the report — and is the only one.
  expect(stream).toEqual({ toasts: 1, cards: 0 });

  expect(legacy.toasts + legacy.cards).toBe(1);
  expect(stream.toasts + stream.cards).toBe(1);
});
