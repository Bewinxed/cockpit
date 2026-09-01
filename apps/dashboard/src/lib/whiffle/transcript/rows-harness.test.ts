import { expect, test } from 'bun:test';
import type { Message } from '../types';
import type { SessionState } from '../client.svelte';
import { buildRows, foldMessages, isHarnessNote, parseHarnessNote } from './rows';

/**
 * A harness task-notification must fold onto the rail, never flatten into a
 * user turn. This pins the `rows.ts` classification the transcript's harness
 * row depends on — and the parser under it, against the real wire shape.
 *
 * SPECIMEN: lifted verbatim (body elided) from a stored Claude Code transcript,
 * `~/.claude/projects/-home-bewinxed-whiffle/89a7eb5e-….jsonl`. It arrives as
 * `message.role === 'user'` with `message.content` a plain STRING, and it opens
 * directly on the tag — there is no `[SYSTEM NOTIFICATION]` preamble on the
 * stored path.
 */
const SPECIMEN = `<task-notification>
<task-id>aad4dccf5841ae021</task-id>
<tool-use-id>toolu_01FvibmDFmAvhSw643Lwmhiz</tool-use-id>
<output-file>/tmp/claude-1000/-home-bewinxed-whiffle/89a7eb5e/tasks/aad4dccf5841ae021.output</output-file>
<status>completed</status>
<summary>Agent "Finish opencode question rendering" finished</summary>
<note>A task-notification fires each time this agent stops with no live background children of its own.</note>
<result>All seven gates pass. Here is the report.

## A. Verification of your trace

**Agreed on every point, with one addition you should know about.**

- \`opencode.ts:763\` \`case 'question.asked'\` — confirmed.
</result>
</task-notification>`;

const userMsg = (content: string, type: Message['type'] = 'user'): Message =>
  ({ instanceId: 'i1', type, content, timestamp: new Date() }) as Message;

const stateWith = (messages: Message[]): SessionState =>
  ({ messages, subagents: {} }) as unknown as SessionState;

test('the real task-notification specimen is recognised as harness plumbing', () => {
  expect(isHarnessNote(userMsg(SPECIMEN))).toBe(true);
  // The live path re-types these to `ui.system_note` before the row grammar
  // sees them; the same content must classify either way.
  expect(isHarnessNote(userMsg(SPECIMEN, 'ui.system_note'))).toBe(true);
});

test('the specimen parses into summary, status, markdown body and task id', () => {
  const note = parseHarnessNote(SPECIMEN);
  expect(note.title).toBe('Agent "Finish opencode question rendering" finished');
  expect(note.status).toBe('completed');
  expect(note.taskId).toBe('aad4dccf5841ae021');
  expect(note.body.startsWith('All seven gates pass.')).toBe(true);
  expect(note.body).toContain('## A. Verification of your trace');
  // The markdown body is the report ALONE — no wrapper tags ride along into it.
  expect(note.body).not.toContain('<task-notification>');
  expect(note.body).not.toContain('<result>');
  expect(note.body).not.toContain('<note>');
});

test('the specimen becomes a harness row, never a user turn', () => {
  const rows = buildRows(stateWith([userMsg(SPECIMEN)]));
  expect(rows).toHaveLength(1);
  expect(rows[0].kind).toBe('harness');
  expect(rows.some((r) => r.kind === 'single')).toBe(false);
});

test('a real typed message is untouched by the harness trigger', () => {
  const typed = userMsg('fix the <task-notification> renderer please');
  expect(isHarnessNote(typed)).toBe(false);
  expect(buildRows(stateWith([typed]))[0].kind).toBe('single');
});

test('the [SYSTEM NOTIFICATION] preamble variant is caught too', () => {
  const withPreamble = `[SYSTEM NOTIFICATION - NOT USER INPUT]\n${SPECIMEN}`;
  expect(isHarnessNote(userMsg(withPreamble))).toBe(true);
  expect(parseHarnessNote(withPreamble).status).toBe('completed');
});

test('a failed notification keeps its status word for the renderer to colour', () => {
  const failed = SPECIMEN.replace('<status>completed</status>', '<status>failed</status>');
  expect(parseHarnessNote(failed).status).toBe('failed');
});

test('a lone system-reminder block folds under its own title', () => {
  const reminder = '<system-reminder>\nThe todo list has changed. Do not mention this.\n</system-reminder>';
  expect(isHarnessNote(userMsg(reminder))).toBe(true);
  const note = parseHarnessNote(reminder);
  expect(note.title).toBe('System reminder');
  expect(note.body).toBe('The todo list has changed. Do not mention this.');
  expect(note.status).toBe('');
});

test('a trigger that parses to nothing still folds, carrying its raw text', () => {
  // The fallback is the whole point: unparseable is not a licence to inline soup.
  const malformed = '<task-notification>\n<task-id>xyz</task-id>\n<status>stopped';
  expect(isHarnessNote(userMsg(malformed))).toBe(true);
  const note = parseHarnessNote(malformed);
  expect(note.title).toBe('Harness notification');
  expect(note.body).toBe(malformed);
  expect(buildRows(stateWith([userMsg(malformed)]))[0].kind).toBe('harness');
});

test('a notification with a summary but no result has no body to expand', () => {
  const bodyless =
    '<task-notification>\n<status>stopped</status>\n<summary>Agent "probe" stopped</summary>\n</task-notification>';
  const note = parseHarnessNote(bodyless);
  expect(note.title).toBe('Agent "probe" stopped');
  expect(note.status).toBe('stopped');
  expect(note.body).toBe('');
});

test('a system.task line yields to the harness note for the same task, and keeps its line without one', () => {
  // The SDK's task_notification frame and the harness's XML note report the
  // SAME completion; the bare "task done" line dedupes against the richer fold
  // by task id, and only a task with no note (a plain background Bash) keeps it.
  const line = (taskId: string): Message => ({
    ...userMsg('task done', 'system.task'),
    metadata: { result: 'Agent "probe" finished', taskId },
  });
  // SPECIMEN carries <task-id>aad4dccf5841ae021</task-id>.
  const rows = foldMessages(
    [userMsg(SPECIMEN), line('aad4dccf5841ae021'), line('task-with-no-note')],
    {}
  );
  expect(rows.filter((row) => row.kind === 'harness')).toHaveLength(1);
  const singles = rows.filter((row) => row.kind === 'single');
  expect(singles).toHaveLength(1);
  expect(
    singles[0].kind === 'single' ? singles[0].message.metadata?.taskId : undefined
  ).toBe('task-with-no-note');
});
