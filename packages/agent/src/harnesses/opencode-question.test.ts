import { expect, test } from 'bun:test';
import type { Event, OpencodeClient } from '@opencode-ai/sdk';
import type { UserQuestionResult } from '@cockpit/core';
import { ASK_USER_QUESTION } from '@cockpit/core';
import type { HarnessContext } from '../harness';
import { OpencodeSession, toTranscript } from './opencode';

/**
 * A question in opencode rides on an ordinary tool part named `question`, and
 * that part is the whole of what needs reading: opencode keeps the asked
 * questions in `state.input`, the chosen answers in `state.metadata.answers`,
 * and completes the part whether the answer came through cockpit, through
 * opencode's own TUI, or from any other client on the server. Because it is
 * stored like any other part, a reopened transcript replays it too.
 *
 * What is pinned here is that the part is renamed to the fleet's own
 * {@link ASK_USER_QUESTION} — the renderer keys off that — and that the outcome
 * is read off the part rather than off the `question.*` events, which would
 * have covered only the live case and only the routes we happened to think of.
 *
 * The shapes below are copied from a real opencode 1.18 server: a live question
 * asked, answered, and read back off `GET /session/{id}/message`.
 */
const SESSION = 'ses_question';
const CALL = 'call_00_DHpSQVQOkTAyfrD7kJ7e1719';

const QUESTION = {
  question: 'Pick languages',
  header: 'Languages',
  multiple: true,
  options: [
    { label: 'Rust', description: 'Systems language with memory safety' },
    { label: 'Go', description: 'Simple, concurrent, garbage-collected' },
    { label: 'Zig', description: 'Low-level, no hidden control flow' },
  ],
};

interface Frames {
  toolUse: { id: string; name: string }[];
  toolResult: { tool_use_id: string; questionResult?: UserQuestionResult }[];
}

const drive = (): { session: OpencodeSession; frames: Frames } => {
  const frames: Frames = { toolUse: [], toolResult: [] };
  const ctx = {
    instanceId: 'question',
    cwd: '/tmp/opencode-question',
    frame: (m: unknown) => {
      const content = (m as { message?: { content?: unknown } }).message?.content;
      if (!Array.isArray(content)) return;
      for (const block of content) {
        const b = block as { type?: string };
        if (b.type === 'tool_use') frames.toolUse.push(block as Frames['toolUse'][number]);
        if (b.type === 'tool_result') frames.toolResult.push(block as Frames['toolResult'][number]);
      }
    },
    permission: () => {},
    busy: () => {},
    session: () => {},
    failed: () => {},
    emit: () => {},
    closed: () => {},
  } as unknown as HarnessContext;

  const session = new OpencodeSession(
    'question',
    ctx,
    {} as unknown as OpencodeClient,
    SESSION,
    '/tmp/opencode-question',
    undefined,
    undefined,
    'http://127.0.0.1:0',
    () => {},
    () => {}
  );
  return { session, frames };
};

/** One `message.part.updated`, as opencode publishes a question tool part. */
const part = (status: string, metadata?: Record<string, unknown>): Event =>
  ({
    type: 'message.part.updated',
    properties: {
      part: {
        id: 'prt_q',
        type: 'tool',
        tool: 'question',
        callID: CALL,
        messageID: 'msg_q',
        sessionID: SESSION,
        state: {
          status,
          input: { questions: [QUESTION] },
          output: 'User has answered your questions.',
          ...(metadata ? { metadata } : {}),
        },
      },
    },
  }) as unknown as Event;

test('a running question part is written down under the fleet name', () => {
  const { session, frames } = drive();
  session.handle(part('running'));

  expect(frames.toolUse).toHaveLength(1);
  // opencode calls the tool `question`; the renderer looks for this name.
  expect(frames.toolUse[0].name).toBe(ASK_USER_QUESTION);
  expect(frames.toolUse[0].id).toBe(CALL);
  // Nothing is resolved yet — the row is open, not faulty.
  expect(frames.toolResult).toHaveLength(0);
});

test('a completed question part carries the answers, whoever answered it', () => {
  const { session, frames } = drive();
  session.handle(part('running'));
  // `metadata.answers` is exactly what a real server stored after the question
  // was answered by a direct POST — the route cockpit never sees.
  session.handle(part('completed', { answers: [['Rust', 'Zig']], truncated: false }));

  expect(frames.toolResult).toHaveLength(1);
  const result = frames.toolResult[0];
  expect(result.tool_use_id).toBe(CALL);
  expect(result.questionResult?.outcome).toBe('answered');
  const answered = result.questionResult as Extract<UserQuestionResult, { outcome: 'answered' }>;
  // Keyed by question text, and kept as an array because this one allowed
  // several — opencode replies in arrays whatever the question was.
  expect(answered.answers).toEqual({ 'Pick languages': ['Rust', 'Zig'] });
  expect(answered.questions[0].multiSelect).toBe(true);
});

test('a question part that completed with no answers is dismissed, not answered blank', () => {
  const { session, frames } = drive();
  session.handle(part('running'));
  session.handle(part('completed'));

  expect(frames.toolResult).toHaveLength(1);
  // The discriminant is what keeps this from drawing a card full of blank
  // choices: there is no `answers` on this member to read at all.
  expect(frames.toolResult[0].questionResult?.outcome).toBe('dismissed');
  expect(frames.toolResult[0].questionResult).not.toHaveProperty('answers');
});

test('a single-choice question keeps its answer a string, not a list of one', () => {
  const { session, frames } = drive();
  const single = {
    ...part('completed', { answers: [['Rust']] }),
  } as unknown as { properties: { part: { state: { input: { questions: unknown[] } } } } };
  single.properties.part.state.input.questions = [{ ...QUESTION, multiple: false }];

  session.handle(single as unknown as Event);

  const answered = frames.toolResult[0].questionResult as Extract<
    UserQuestionResult,
    { outcome: 'answered' }
  >;
  expect(answered.answers).toEqual({ 'Pick languages': 'Rust' });
});

test('answering through cockpit does not also write its own row', () => {
  const { session, frames } = drive();
  // The ask parks a permission; it must not draw a row of its own, or the same
  // question appears twice under two different ids.
  session.handle({
    type: 'question.asked',
    properties: { id: 'que_1', sessionID: SESSION, questions: [QUESTION] },
  } as unknown as Event);
  expect(frames.toolUse).toHaveLength(0);

  session.resolvePermission('que_1', {
    behavior: 'allow',
    updatedInput: { answers: { 'Pick languages': ['Rust'] } },
  } as never);
  expect(frames.toolResult).toHaveLength(0);

  // Only the tool part writes the exchange down.
  session.handle(part('completed', { answers: [['Rust']] }));
  expect(frames.toolResult).toHaveLength(1);
});

test('a reopened transcript replays the question, not just the live stream', () => {
  // Exactly the row `GET /session/{id}/message` returned on a real server after
  // the question above was answered — the reload path's only input.
  const rows = [
    {
      info: { id: 'msg_q', role: 'assistant', providerID: 'opencode-go', modelID: 'deepseek-v4-pro' },
      parts: [
        {
          id: 'prt_q',
          type: 'tool',
          tool: 'question',
          callID: CALL,
          messageID: 'msg_q',
          sessionID: SESSION,
          state: {
            status: 'completed',
            input: { questions: [QUESTION] },
            output: 'User has answered your questions.',
            metadata: { answers: [['Rust', 'Zig']], truncated: false },
          },
        },
      ],
    },
  ];

  const blocks = toTranscript(SESSION, rows as never).flatMap(
    (entry) => (entry.message as { content?: unknown[] }).content ?? []
  ) as { type: string; name?: string; id?: string; tool_use_id?: string; questionResult?: UserQuestionResult }[];

  const use = blocks.find((b) => b.type === 'tool_use');
  const result = blocks.find((b) => b.type === 'tool_result');
  expect(use?.name).toBe(ASK_USER_QUESTION);
  expect(result?.tool_use_id).toBe(use?.id);
  // The exchange survives the reload whole — this is what a question used to
  // lose, leaving a reopened transcript with a blank where the answer was.
  const answered = result?.questionResult as Extract<UserQuestionResult, { outcome: 'answered' }>;
  expect(answered.answers).toEqual({ 'Pick languages': ['Rust', 'Zig'] });
});

test('every other tool keeps its own name', () => {
  const { session, frames } = drive();
  session.handle({
    type: 'message.part.updated',
    properties: {
      part: {
        id: 'prt_b', type: 'tool', tool: 'bash', callID: 'call_b',
        messageID: 'msg_b', sessionID: SESSION,
        state: { status: 'completed', input: { command: 'ls' }, output: 'ok' },
      },
    },
  } as unknown as Event);

  expect(frames.toolUse[0].name).toBe('bash');
  expect(frames.toolResult[0].questionResult).toBeUndefined();
});
