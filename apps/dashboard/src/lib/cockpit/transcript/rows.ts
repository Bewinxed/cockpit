/**
 * The transcript folded into render rows. Consecutive tool calls collapse onto
 * one rail, a Task call becomes the branch it spawned, and the live tail —
 * streaming text, an open thinking block, the tool in flight — rides at the end
 * as rows of its own so it scrolls with the conversation rather than sitting in
 * fixed chrome.
 */
import type { Message } from '../types';
import type { SessionState } from '../client.svelte';
import type { ToolGlance } from '../frames';
import type { SubagentState } from '$lib/utils/flow-types';
import type { QueuedMessage } from '@cockpit/core';
import { ASK_USER_QUESTION } from '@cockpit/core';

export type Row =
  | { kind: 'single'; key: string; message: Message }
  | { kind: 'tools'; key: string; messages: Message[] }
  | { kind: 'question'; key: string; message: Message }
  | { kind: 'subagent'; key: string; branch: SubagentState; spawn: Message }
  | { kind: 'stream'; key: string; text: string }
  | { kind: 'thinking'; key: string; text: string; live: boolean }
  | { kind: 'livetool'; key: string; glance: ToolGlance }
  /**
   * A message the session is holding but has not started. Not a turn — it has
   * not happened — so it sits after the live tail, in the reader's own turn
   * anatomy at reduced presence, and carries no time at all.
   */
  | { kind: 'queued'; key: string; queued: QueuedMessage }
  | { kind: 'harness'; key: string; note: HarnessNote };

/**
 * A harness-injected notification, parsed.
 *
 * Claude Code posts one as a role-`user` message each time a background
 * subagent stops. The operator never typed it, and its `<result>` is a full
 * markdown report — so flattened into a user turn it reads as a wall of literal
 * angle-bracket tags with the markdown dead. It belongs on the rail, folded.
 *
 * The specimen, from a stored transcript (role `user`, content a plain string,
 * no preamble — it opens directly on the tag):
 *
 * ```
 * <task-notification>
 * <task-id>aad4dccf5841ae021</task-id>
 * <tool-use-id>toolu_01FvibmDFmAvhSw643Lwmhiz</tool-use-id>
 * <output-file>/tmp/…/tasks/aad4dccf5841ae021.output</output-file>
 * <status>completed</status>
 * <summary>Agent "Finish opencode question rendering" finished</summary>
 * <note>A task-notification fires each time this agent stops…</note>
 * <result>All seven gates pass. Here is the report.
 *
 * ## A. Verification of your trace
 * …</result>
 * </task-notification>
 * ```
 */
export interface HarnessNote {
  /** The `<summary>` line — what the fold says while it is closed. */
  title: string;
  /** `completed` / `failed` / `stopped`, or '' where the block carried none. */
  status: string;
  /** The report itself, as markdown. Empty means there is nothing to expand. */
  body: string;
  /** The `<task-id>` this notification echoes, when it named one. */
  taskId?: string;
}

/** The inner text of the first `<tag>…</tag>`, or undefined. */
const inner = (tag: string, text: string): string | undefined =>
  new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(text)?.[1];

const isReminder = (trimmed: string): boolean =>
  trimmed.startsWith('<system-reminder>') && trimmed.endsWith('</system-reminder>');

/**
 * Whether a message is harness plumbing wearing the operator's role.
 *
 * Classified on the CONTENT, not the type, on purpose: the live path already
 * re-types these to `ui.system_note` before they reach the row grammar and the
 * stored path may hand them over as plain `user`, so the text is the one signal
 * both share. Narrow by design — the other things `ui.system_note` carries (a
 * local command's echo, a denied permission) match none of these triggers and
 * keep the line they already had.
 */
export function isHarnessNote(m: Message): boolean {
  if (m.type !== 'user' && m.type !== 'ui.system_note') return false;
  const head = m.content.trimStart();
  // TOP-LEVEL only. `frames.ts` tests `includes` over the first 200 characters,
  // which also swallows an operator who merely WRITES the tag ("fix the
  // <task-notification> renderer") and buries their message in a fold. The
  // block either opens the message or it is prose about the block.
  if (head.startsWith('[SYSTEM NOTIFICATION')) return true;
  if (head.startsWith('<task-notification>')) return true;
  return isReminder(m.content.trim());
}

/**
 * The block, read. Never throws and never returns null: a trigger that matches
 * but parses to nothing still becomes a fold carrying its own raw text, because
 * the failure mode this exists to kill is the soup inline — one click away is
 * always better than flattened across the transcript.
 */
export function parseHarnessNote(text: string): HarnessNote {
  const whole = text.trim();
  if (isReminder(whole)) {
    return { title: 'System reminder', status: '', body: (inner('system-reminder', whole) ?? '').trim() };
  }
  const title = inner('summary', text)?.trim();
  const body = (inner('result', text) ?? '').trim();
  if (!title && !body) return { title: 'Harness notification', status: '', body: whole };
  const taskId = inner('task-id', text)?.trim();
  return {
    title: title || 'Harness notification',
    status: inner('status', text)?.trim() ?? '',
    body,
    ...(taskId ? { taskId } : {}),
  };
}

const isToolMsg = (m: Message): boolean => m.type === 'tool.use' || m.type === 'tool.handoff';

/** A question the agent asked, rendered as its own card rather than a tool row. */
const isQuestionMsg = (m: Message): boolean =>
  isToolMsg(m) && m.metadata?.toolName === ASK_USER_QUESTION;

/** The branch a tool.use spawned, when it opened one — a real subagent fold. */
const branchOf = (m: Message, subagents: Record<string, SubagentState>): SubagentState | null => {
  const id = m.metadata?.toolId;
  return id ? (subagents[id] ?? null) : null;
};

const keyOf = (m: Message, index: number): string => m.id ?? m.sdkUuid ?? `${m.type}:${index}`;

/**
 * The row grammar itself: a list of messages folded into rows, with no live tail
 * and no session. The main transcript and a subagent's own mini-transcript both
 * go through this, so a delegate's tool calls and reasoning read exactly like
 * the parent's rather than like a printed log.
 */
export function foldMessages(
  messages: Message[],
  subagents: Record<string, SubagentState>
): Row[] {
  const rows: Row[] = [];

  // One completion, one row. The SDK's `task_notification` frame (the
  // "task done" line) and the harness's XML note are two wire forms of the
  // SAME event; when the richer note is present its bare line yields to it,
  // keyed by the task id both sides carry. A plain task with no note — a
  // background Bash — keeps its line, which is the only place it reports.
  const noted = new Set<string>();
  for (const m of messages) {
    if (isHarnessNote(m)) {
      const tid = parseHarnessNote(m.content).taskId;
      if (tid) noted.add(tid);
    }
  }

  let i = 0;
  while (i < messages.length) {
    const m = messages[i];

    if (
      m.type === 'system.task' &&
      m.metadata?.taskId &&
      noted.has(m.metadata.taskId)
    ) {
      i++;
      continue;
    }

    // Before anything else: harness plumbing is never a turn, so it never
    // reaches the `single` row that would give it a Who header and user styling.
    if (isHarnessNote(m)) {
      rows.push({ kind: 'harness', key: `hn:${keyOf(m, i)}`, note: parseHarnessNote(m.content) });
      i++;
      continue;
    }

    const branch = isToolMsg(m) ? branchOf(m, subagents) : null;
    if (branch) {
      rows.push({ kind: 'subagent', key: keyOf(m, i), branch, spawn: m });
      i++;
      continue;
    }

    if (isQuestionMsg(m)) {
      rows.push({ kind: 'question', key: `q:${keyOf(m, i)}`, message: m });
      i++;
      continue;
    }

    if (isToolMsg(m)) {
      const run: Message[] = [];
      const start = i;
      while (
        i < messages.length &&
        isToolMsg(messages[i]) &&
        !isQuestionMsg(messages[i]) &&
        !branchOf(messages[i], subagents)
      ) {
        run.push(messages[i]);
        i++;
      }
      rows.push({ kind: 'tools', key: `tools:${keyOf(run[0], start)}`, messages: run });
      continue;
    }

    rows.push({ kind: 'single', key: keyOf(m, i), message: m });
    i++;
  }

  return rows;
}

/**
 * A subagent's own transcript, for the peek inside its branch card. Nested
 * branches are not resolved — the SDK caps delegation at one level, so a
 * `tool.use` in here is a call the delegate made, never a fold of its own.
 */
export function branchRows(branch: SubagentState): Row[] {
  const rows = foldMessages(branch.messages, {});
  if (branch.streaming) {
    rows.push({ kind: 'stream', key: 'branch:stream', text: branch.streaming });
  }
  return rows;
}

export function buildRows(session: SessionState): Row[] {
  const rows = foldMessages(session.messages, session.subagents);

  // The live tail: only ever the main loop's, and only while nothing settled it.
  // A thinking block is shown the moment it opens, even with no delta text yet —
  // Claude's extended thinking is often REDACTED and streams no deltas at all
  // (see frames.ts), so gating on thinkingStream meant "reasoning, silently,
  // with no indicator". The row itself is the indicator; the text fills in if
  // and when it arrives.
  if (session.openBlock === 'thinking') {
    rows.push({
      kind: 'thinking',
      key: 'stream:thinking',
      text: session.thinkingStream,
      live: !session.thinkingClosing,
    });
  }
  if (session.streaming) {
    rows.push({ kind: 'stream', key: 'stream:text', text: session.streaming });
  }
  if (session.currentTool) {
    rows.push({ kind: 'livetool', key: 'stream:tool', glance: session.currentTool });
  }

  // The pending register: what the session has been handed and not started,
  // after everything that HAS happened. Keyed by the queue id, and deliberately
  // not the key its real turn will carry — when the message finally runs, the
  // queued row leaves and the turn arrives, and pretending the two are one
  // element would ask the transcript to morph a placeholder into a fact.
  // Read defensively: a session shape built before this field existed — a
  // server render's stand-in, a stub — must fold to a transcript, not throw.
  for (const queued of session.queued ?? []) {
    rows.push({ kind: 'queued', key: `qd:${queued.queueId}`, queued });
  }

  return rows;
}
