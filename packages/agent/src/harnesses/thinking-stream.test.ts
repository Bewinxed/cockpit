import { expect, test } from 'bun:test';
import type { Event, OpencodeClient } from '@opencode-ai/sdk';
import type { NeutralMessage } from '@cockpit/core';
import type { HarnessContext } from '../harness';
import { OpencodeSession } from './opencode';

/**
 * opencode re-sends a reasoning part whole on every update. What the dashboard
 * needs is the live trace: a thinking block that opens, streams what grew, and
 * closes — the same evidence the claude path produces. These drive the adapter's
 * own event handler with the events opencode really sends, and read the frames
 * back the way the dashboard folds them.
 */
const SESSION = 'ses_main';

/** An opencode event, narrowed to the fields the adapter reads off it. */
const event = (type: string, properties: Record<string, unknown>): Event =>
  ({ type, properties }) as unknown as Event;

const assistantMessage = (messageID: string): Event =>
  event('message.updated', {
    info: {
      id: messageID,
      role: 'assistant',
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    },
  });

const userMessage = (messageID: string): Event =>
  event('message.updated', { info: { id: messageID, role: 'user' } });

const reasoningPart = (messageID: string, id: string, text: string): Event =>
  event('message.part.updated', {
    part: { id, sessionID: SESSION, messageID, type: 'reasoning', text, time: { start: 0 } },
  });

const textPart = (messageID: string, id: string, text: string): Event =>
  event('message.part.updated', {
    part: { id, sessionID: SESSION, messageID, type: 'text', text },
  });

/** `message.part.delta` — the real streaming event, which also carries the deltas. */
const textDelta = (messageID: string, id: string, delta: string): Event =>
  event('message.part.delta', {
    sessionID: SESSION,
    messageID,
    partID: id,
    field: 'text',
    delta,
  });

const toolPart = (messageID: string, id: string, callID: string): Event =>
  event('message.part.updated', {
    part: {
      id,
      sessionID: SESSION,
      messageID,
      type: 'tool',
      callID,
      tool: 'bash',
      state: { status: 'running', input: { command: 'ls' } },
    },
  });

const busy = (): Event => event('session.status', { sessionID: SESSION, status: { type: 'busy' } });
const idle = (): Event => event('session.idle', { sessionID: SESSION });

/** A stream frame as it goes on the wire, not as the neutral union narrows it. */
interface StreamFrame {
  type: 'stream_event';
  session_id?: string;
  event: {
    type: string;
    content_block?: { type: string; thinking?: string };
    delta?: { type: string; text?: string; thinking?: string };
  };
}

const build = () => {
  const frames: NeutralMessage[] = [];
  const ctx: HarnessContext = {
    instanceId: 'thinking',
    cwd: '/tmp/opencode-thinking',
    frame: (message) => {
      frames.push(message);
    },
    permission: () => {},
    busy: () => {},
    session: () => {},
    failed: () => {},
    emit: () => {},
    closed: () => {},
  };
  const session = new OpencodeSession(
    'thinking',
    ctx,
    // Nothing here prompts, aborts or answers, so the client is never reached.
    {} as OpencodeClient,
    SESSION,
    '/tmp/opencode-thinking',
    undefined,
    undefined,
    'http://127.0.0.1:0',
    () => {},
    () => {}
  );
  return { session, frames };
};

const streamed = (frames: NeutralMessage[]): StreamFrame[] =>
  frames.flatMap((frame) => (frame.type === 'stream_event' ? [frame as StreamFrame] : []));

/** One stream frame in a line, so an assertion reads as the sequence it is. */
const shape = (frame: StreamFrame): string => {
  const sdk = frame.event;
  if (sdk.type === 'content_block_start') return `start:${sdk.content_block?.type}`;
  if (sdk.type === 'content_block_delta') return `${sdk.delta?.type}:${sdk.delta?.thinking ?? sdk.delta?.text}`;
  return sdk.type;
};

const trace = (frames: NeutralMessage[]): string[] => streamed(frames).map(shape);

test('the first reasoning update opens a thinking block and streams what it says', () => {
  const { session, frames } = build();
  session.handle(assistantMessage('msg_1'));
  session.handle(reasoningPart('msg_1', 'prt_1', 'Let me'));

  expect(trace(frames)).toEqual(['start:thinking', 'thinking_delta:Let me']);
  const [start, delta] = streamed(frames);
  // Field for field what the text stream sends, so the dashboard routes it the same.
  expect(start).toEqual({
    type: 'stream_event',
    session_id: SESSION,
    event: { type: 'content_block_start', content_block: { type: 'thinking', thinking: '' } },
  });
  expect(delta).toEqual({
    type: 'stream_event',
    session_id: SESSION,
    event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'Let me' } },
  });
});

test('each update streams only what grew, under the one block', () => {
  const { session, frames } = build();
  session.handle(assistantMessage('msg_1'));
  session.handle(reasoningPart('msg_1', 'prt_1', 'Let me'));
  session.handle(reasoningPart('msg_1', 'prt_1', 'Let me read the adapter'));

  expect(trace(frames)).toEqual([
    'start:thinking',
    'thinking_delta:Let me',
    'thinking_delta: read the adapter',
  ]);
});

test('an update that does not extend the text says nothing', () => {
  const { session, frames } = build();
  session.handle(assistantMessage('msg_1'));
  session.handle(reasoningPart('msg_1', 'prt_1', 'Let me'));
  session.handle(reasoningPart('msg_1', 'prt_1', 'Let me'));
  session.handle(reasoningPart('msg_1', 'prt_1', 'Let'));

  expect(trace(frames)).toEqual(['start:thinking', 'thinking_delta:Let me']);
});

test('text after reasoning closes the block, and closes it once', () => {
  const { session, frames } = build();
  session.handle(assistantMessage('msg_1'));
  session.handle(reasoningPart('msg_1', 'prt_1', 'Let me'));
  session.handle(textDelta('msg_1', 'prt_2', 'Here'));
  session.handle(textDelta('msg_1', 'prt_2', ' it is'));
  session.handle(textPart('msg_1', 'prt_2', 'Here it is'));

  expect(trace(frames)).toEqual([
    'start:thinking',
    'thinking_delta:Let me',
    'content_block_stop',
    'text_delta:Here',
    'text_delta: it is',
  ]);
});

test('a tool call closes the block before the call is announced', () => {
  const { session, frames } = build();
  session.handle(assistantMessage('msg_1'));
  session.handle(reasoningPart('msg_1', 'prt_1', 'I should list the directory'));
  session.handle(toolPart('msg_1', 'prt_2', 'call_1'));

  expect(trace(frames)).toEqual([
    'start:thinking',
    'thinking_delta:I should list the directory',
    'content_block_stop',
  ]);
  // The stop is the last stream frame before the tool_use frame, not after it.
  const stopAt = frames.findIndex(
    (frame) => frame.type === 'stream_event' && shape(frame as StreamFrame) === 'content_block_stop'
  );
  const toolAt = frames.findIndex((frame) => frame.type === 'assistant');
  expect(stopAt).toBeGreaterThanOrEqual(0);
  expect(toolAt).toBeGreaterThan(stopAt);
});

test('the turn closing ends the trace, and the settled thinking block still follows', () => {
  const { session, frames } = build();
  session.handle(busy());
  session.handle(assistantMessage('msg_1'));
  session.handle(reasoningPart('msg_1', 'prt_1', 'The adapter buffers it'));
  session.handle(idle());

  expect(trace(frames)).toEqual([
    'start:thinking',
    'thinking_delta:The adapter buffers it',
    'content_block_stop',
  ]);
  // Unchanged contract: the closing frame carries the whole thought, which the
  // dashboard's full-frame handler puts in place of the live trace.
  const settled = frames.find((frame) => frame.type === 'assistant');
  expect(settled).toEqual({
    type: 'assistant',
    uuid: 'msg_1',
    message: { content: [{ type: 'thinking', thinking: 'The adapter buffers it' }] },
  });
});

test('a turn that never reasons closes nothing', () => {
  const { session, frames } = build();
  session.handle(busy());
  session.handle(assistantMessage('msg_1'));
  session.handle(textDelta('msg_1', 'prt_1', 'Done'));
  session.handle(textPart('msg_1', 'prt_1', 'Done'));
  session.handle(idle());

  expect(trace(frames)).toEqual(['text_delta:Done']);
});

test('text grows past a capped part.text by accumulating the deltas', () => {
  const { session, frames } = build();
  session.handle(busy());
  session.handle(assistantMessage('msg_1'));
  // `part.text` stays pinned at a 5-char cap (what the 2026-08-16 reports saw:
  // a 4000-char ceiling), while the deltas keep carrying the full stream.
  session.handle(textDelta('msg_1', 'prt_1', 'ABCDE'));
  session.handle(textDelta('msg_1', 'prt_1', 'FGHIJ'));
  session.handle(textDelta('msg_1', 'prt_1', 'KLMNO'));
  session.handle(textPart('msg_1', 'prt_1', 'ABCDE'));
  session.handle(idle());

  const settled = frames.find((frame) => frame.type === 'assistant');
  const text = settled?.message.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');
  expect(text).toBe('ABCDEFGHIJKLMNO');
});

test('deltas never shorten the part — the longer of delta sum and part.text wins', () => {
  const { session, frames } = build();
  session.handle(busy());
  session.handle(assistantMessage('msg_1'));
  // No delta carries the whole text; it is only in part.text.
  session.handle(textPart('msg_1', 'prt_1', 'the whole answer'));
  session.handle(idle());

  const settled = frames.find((frame) => frame.type === 'assistant');
  const text = settled?.message.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');
  expect(text).toBe('the whole answer');
});

test('a part that lands before its message.updated is still reported', () => {
  const { session, frames } = build();
  session.handle(busy());
  // The text part arrives before the message.updated that names its role; it
  // must not be dropped — the flush filters by role once the role is known.
  session.handle(textPart('msg_1', 'prt_1', 'the early answer'));
  session.handle(assistantMessage('msg_1'));
  session.handle(idle());

  const settled = frames.find((frame) => frame.type === 'assistant');
  const text = settled?.message.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');
  expect(text).toBe('the early answer');
});

test('the deltas alone report the text when the full part.updated never lands', () => {
  const { session, frames } = build();
  session.handle(busy());
  session.handle(assistantMessage('msg_1'));
  session.handle(textDelta('msg_1', 'prt_1', 'Hello'));
  session.handle(textDelta('msg_1', 'prt_1', ' world'));
  // No `message.part.updated` for this part at all — the dropped-event case.
  session.handle(idle());

  const settled = frames.find((frame) => frame.type === 'assistant');
  const text = settled?.message.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');
  expect(text).toBe('Hello world');
});

test('a user message captured before its role was known never leaks into an assistant frame', () => {
  const { session, frames } = build();
  session.handle(busy());
  session.handle(textPart('msg_1', 'prt_1', 'the reader typed this'));
  session.handle(userMessage('msg_1'));
  session.handle(idle());

  const assistants = frames.filter(
    (frame) => frame.type === 'assistant' && frame.message.content.some((block) => block.type === 'text')
  );
  expect(assistants).toEqual([]);
});

test("a child session's reasoning stays buffered, out of the main loop's trace", () => {
  const { session, frames } = build();
  session.handle(assistantMessage('msg_1'));
  session.handleChild(assistantMessage('cmsg_1'), 'call_1');
  session.handleChild(reasoningPart('cmsg_1', 'cprt_1', 'The child thinks'), 'call_1');
  session.handleChild(idle(), 'call_1');

  expect(trace(frames)).toEqual([]);
  const branch = frames.find((frame) => frame.type === 'assistant');
  expect(branch).toEqual({
    type: 'assistant',
    uuid: 'cmsg_1',
    parent_tool_use_id: 'call_1',
    message: { content: [{ type: 'thinking', thinking: 'The child thinks' }] },
  });
});
