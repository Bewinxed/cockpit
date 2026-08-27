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
import { STREAM_V1 } from '@cockpit/core';
import type {
  CommandAck,
  SessionStreamEvent,
  StreamClientMessage,
  StreamSubscribe,
} from '@cockpit/core';
import {
  COMMAND_ACK_TIMEOUT_MS,
  createStreamState,
  handleStreamMessage,
  latestCommand,
  MAX_RESYNC_ATTEMPTS,
  noteCapabilities,
  noteDisconnect,
  SETTLED_COMMAND_LIMIT,
  streamCarries,
  submitCommand,
  sweepCommands,
  syncStreamSubscriptions,
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
  /** The scripted clock, so a timeout is a fact rather than a wait. */
  clock: { now: number };
  /** Feeds one message in as if it had come off the socket. */
  receive(message: unknown): boolean;
  subscribes(): StreamSubscribe[];
}

function harness(options: { capable?: boolean; offline?: boolean } = {}): Harness {
  const state = createStreamState();
  if (options.capable) state.capable = true;
  const applied: { sessionId: string; seq: number }[] = [];
  const sent: StreamClientMessage[] = [];
  const rereads: string[] = [];
  const warnings: string[] = [];
  const clock = { now: 1_000 };

  const host: StreamHost = {
    applyFrame: (sessionId, frame) => {
      const uuid = (frame as { message: { uuid: string } }).message.uuid;
      applied.push({ sessionId, seq: Number(uuid.slice(1)) });
    },
    rereadHistory: (sessionId) => rereads.push(sessionId),
    sendToHub: (message) => {
      if (options.offline) return false;
      sent.push(message);
      return true;
    },
    now: () => clock.now,
    warn: (message) => warnings.push(message),
  };

  return {
    state,
    host,
    applied,
    sent,
    rereads,
    warnings,
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

const submit = (h: Harness, kind: 'send' | 'set-model' = 'send', legacy = () => {}): string =>
  submitCommand(h.state, h.host, {
    commandId: `cmd-${Object.keys(h.state.commands).length + 1}`,
    sessionId: SESSION,
    machineId: 'mac-1',
    kind,
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

test('the stream dialect runs a command\'s local effects: submitted at dispatch, settled once on the applied ack', () => {
  const h = harness({ capable: true });
  const calls: string[] = [];
  const commandId = submitCommand(h.state, h.host, {
    commandId: 'fx-1',
    sessionId: SESSION,
    machineId: 'mac-1',
    kind: 'send',
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
