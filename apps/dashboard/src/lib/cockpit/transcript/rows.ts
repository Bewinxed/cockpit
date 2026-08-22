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
import { ASK_USER_QUESTION } from '@cockpit/core';

export type Row =
  | { kind: 'single'; key: string; message: Message }
  | { kind: 'tools'; key: string; messages: Message[] }
  | { kind: 'question'; key: string; message: Message }
  | { kind: 'subagent'; key: string; branch: SubagentState; spawn: Message }
  | { kind: 'stream'; key: string; text: string }
  | { kind: 'thinking'; key: string; text: string; live: boolean }
  | { kind: 'livetool'; key: string; glance: ToolGlance };

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

export function buildRows(session: SessionState): Row[] {
  const { messages, subagents } = session;
  const rows: Row[] = [];

  let i = 0;
  while (i < messages.length) {
    const m = messages[i];

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

  // The live tail: only ever the main loop's, and only while nothing settled it.
  if (session.openBlock === 'thinking' && session.thinkingStream) {
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

  return rows;
}
