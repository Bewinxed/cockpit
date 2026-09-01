import { expect, test } from 'bun:test';
import type { Envelope, PermissionResult, UserQuestion } from '@whiffle/core';
import { WHIFFLE_ENV, QUESTION_DISMISSED, settledQuestionResult } from '@whiffle/core';
import type { HandoffActions } from './handoff-shared';
import { handoffActions } from './handoff-shared';

/**
 * The answer path for a question a delegate parked and its parent answered.
 *
 * The parent only ever sees the question text and the labels, so its
 * `answer_delegate` sends the chosen labels alone — and an `AskUserQuestion`
 * whose `updatedInput` has lost its `questions` is refused by the SDK ("The
 * required parameter `questions` is missing"), killing the delegate's tool
 * call. The harness that parked the ask is the only side still holding the
 * input, so it puts it back: the shape the dashboard has always sent
 * (`questionAnswer` in apps/dashboard/src/lib/whiffle/question.ts).
 */
const questions: UserQuestion[] = [
  {
    question: 'Which database?',
    header: 'Database',
    options: [
      { label: 'Postgres', description: 'relational' },
      { label: 'SQLite', description: 'embedded' },
    ],
    multiSelect: false,
  },
  {
    question: 'Which extras?',
    header: 'Extras',
    options: [
      { label: 'pgvector', description: 'vectors' },
      { label: 'PostGIS', description: 'geo' },
    ],
    multiSelect: true,
  },
];

const parked = { input: { questions }, questions };

const inputOf = (result: PermissionResult): Record<string, unknown> =>
  (result as { updatedInput: Record<string, unknown> }).updatedInput;

test('answers that arrive alone are folded back into the parked tool call', () => {
  const settled = settledQuestionResult(parked, {
    behavior: 'allow',
    updatedInput: { answers: { 'Which database?': 'Postgres' } },
  });
  const input = inputOf(settled);
  expect(input.questions).toEqual(questions);
  expect(input.answers).toEqual({ 'Which database?': 'Postgres' });
});

test("a multi-select answer is a list, whichever way it was picked", () => {
  const settled = settledQuestionResult(parked, {
    behavior: 'allow',
    updatedInput: { answers: { 'Which extras?': 'pgvector' } },
  });
  expect(inputOf(settled).answers).toEqual({ 'Which extras?': ['pgvector'] });
});

test('the dashboard\'s own shape passes through unchanged', () => {
  const answers = { 'Which database?': 'SQLite', 'Which extras?': ['PostGIS'] };
  const settled = settledQuestionResult(parked, {
    behavior: 'allow',
    updatedInput: { questions, answers },
  });
  expect(inputOf(settled)).toEqual({ questions, answers });
});

test('allowing without an input of its own is left alone', () => {
  expect(settledQuestionResult(parked, { behavior: 'allow' })).toEqual({ behavior: 'allow' });
});

test('a denial with nothing said is the dismissal the CLI writes for its own', () => {
  const settled = settledQuestionResult(parked, {
    behavior: 'deny',
  } as unknown as PermissionResult);
  expect(settled).toEqual({ behavior: 'deny', message: QUESTION_DISMISSED });
});

test("a denial that says why keeps its words", () => {
  const settled = settledQuestionResult(parked, { behavior: 'deny', message: 'not that one' });
  expect(settled).toEqual({ behavior: 'deny', message: 'not that one' });
});

// ---- what `answer_delegate` actually puts on the wire ----

const rows = [
  { id: 'self', machineId: 'm1', cwd: '/home/o/center.ai', status: 'running' },
  {
    id: 'kid',
    machineId: 'm2',
    cwd: '/home/o/keeboard',
    status: 'running',
    parentInstanceId: 'self',
  },
];

/**
 * A stand-in hub for one test, torn down with it — the url is an environment
 * variable every suite in this process shares, so it is claimed at the moment
 * it is read rather than once for the file.
 */
const withHub = async (run: (actions: HandoffActions, sent: Envelope[]) => Promise<void>) => {
  const hub = Bun.serve({ port: 0, fetch: () => Response.json(rows) });
  const was = process.env[WHIFFLE_ENV.hubUrl];
  process.env[WHIFFLE_ENV.hubUrl] = `ws://localhost:${hub.port}/ws`;
  // A suite earlier in this process leaves its own `fetch` mock installed on
  // the global; the roster is a real HTTP read and wants the real one.
  const wasFetch = globalThis.fetch;
  globalThis.fetch = Bun.fetch as unknown as typeof fetch;
  const sent: Envelope[] = [];
  try {
    await run(
      handoffActions({
        instanceId: 'self',
        cwd: '/home/o/center.ai',
        emit: (envelope) => sent.push(envelope),
      }),
      sent
    );
  } finally {
    if (was === undefined) delete process.env[WHIFFLE_ENV.hubUrl];
    else process.env[WHIFFLE_ENV.hubUrl] = was;
    globalThis.fetch = wasFetch;
    hub.stop(true);
  }
};

const resultOf = (envelope: Envelope): PermissionResult =>
  (envelope.payload as { args: [string, PermissionResult] }).args[1];

test('answering a delegate sends the chosen labels for the harness to fold in', async () => {
  await withHub(async (actions, sent) => {
    await actions.answerDelegate('keeboard', 'req-1', { 'Which database?': 'Postgres' });
    const result = resultOf(sent[0]);
    expect(result).toEqual({
      behavior: 'allow',
      updatedInput: { answers: { 'Which database?': 'Postgres' } },
    });
    // …and the harness makes that whole again, which is the pair that has to hold.
    expect(inputOf(settledQuestionResult(parked, result)).questions).toEqual(questions);
  });
});

test('denying a delegate says so in words, which a permission result requires', async () => {
  await withHub(async (actions, sent) => {
    await actions.answerDelegate('keeboard', 'req-2', undefined, true);
    expect(resultOf(sent[0])).toEqual({ behavior: 'deny', message: QUESTION_DISMISSED });
  });
});
