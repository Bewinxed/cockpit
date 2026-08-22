import { expect, test } from 'bun:test';
import { ASK_USER_QUESTION } from '@cockpit/core';
import { applyToolResult, mapFrame } from '../frames';
import type { SessionState } from '../client.svelte';
import { buildRows } from './rows';

/**
 * A question the agent asked must render as its own card, never fold into a
 * plain tool row — this pins the `rows.ts` classification that the transcript's
 * `.hitl` card depends on.
 */
const QUESTIONS = [
  {
    question: 'Which executor should run the hotfix?',
    header: 'Executor',
    options: [
      { label: 'kimi-k3 via opencode', description: 'The verified provider.' },
      { label: 'Wait for DeepSeek', description: 'Block until it recovers.' },
    ],
    multiSelect: false,
  },
];

const use = (id: string) =>
  ({
    type: 'assistant',
    message: {
      content: [{ type: 'tool_use', id, name: ASK_USER_QUESTION, input: { questions: QUESTIONS } }],
    },
  }) as never;

const stateWith = (messages: unknown[]): SessionState =>
  ({ messages, subagents: {} } as unknown as SessionState);

test('an answered AskUserQuestion becomes a question row, not a tools row', () => {
  const mapping = mapFrame('i1', use('q-1'));
  applyToolResult(mapping.messages, {
    toolId: 'q-1',
    result: 'answered',
    isError: false,
    questionResult: {
      outcome: 'answered',
      questions: QUESTIONS,
      answers: { 'Which executor should run the hotfix?': 'kimi-k3 via opencode' },
    },
  });

  const rows = buildRows(stateWith(mapping.messages));
  const question = rows.find((r) => r.kind === 'question');
  expect(question).toBeTruthy();
  expect(rows.some((r) => r.kind === 'tools')).toBe(false);
});

test('a real tool call still folds into a tools row', () => {
  const toolUse = {
    type: 'assistant',
    message: { content: [{ type: 'tool_use', id: 't-1', name: 'Read', input: { file_path: '/x' } }] },
  } as never;
  const rows = buildRows(stateWith(mapFrame('i1', toolUse).messages));
  expect(rows.some((r) => r.kind === 'tools')).toBe(true);
  expect(rows.some((r) => r.kind === 'question')).toBe(false);
});
