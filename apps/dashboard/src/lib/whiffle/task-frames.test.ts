// A plain tool task (a foreground or background `Bash`) fires `task_*` frames
// that carry no `subagent_type`. Those frames must never mint a subagent branch:
// the `tool.use`/`tool.result` pair already renders the command, and a "Report"
// of raw stdout through Markdown is the bug this guards against. A real
// Agent/Task call's frames DO carry `subagent_type`, and its branch is created
// at the `tool_use` — so the same mapper must keep that path intact.
import { expect, test } from 'bun:test';
import type { SDKMessage } from '@whiffle/core';
import type { SubagentState } from '$lib/utils/flow-types';
import { applyBranchEvent, mapFrame, suppressesTaskLine } from './frames';

/** A `system` frame, as the neutral spine carries it (uuid/session_id optional). */
const system = (subtype: string, fields: Record<string, unknown> = {}): SDKMessage =>
  ({ type: 'system', subtype, ...fields }) as SDKMessage;

/** The Agent/Task `tool_use` block that spawns a real subagent. */
const taskToolUse = (id: string): SDKMessage => ({
  type: 'assistant',
  message: {
    model: 'claude-sonnet-5',
    content: [
      { type: 'tool_use', id, name: 'Task', input: { subagent_type: 'general-purpose', description: 'research it' } },
    ],
  },
}) as SDKMessage;

const SUMMARY = 'line-'.repeat(50); // 250 chars, past the 200-char fold

test('a plain task_started mints no branch', () => {
  const mapping = mapFrame(
    'i1',
    system('task_started', {
      tool_use_id: 'toolu_bash',
      task_id: 'task-bash',
      description: 'probe availability',
      task_type: 'local_bash',
    })
  );
  expect(mapping.branch).toBeUndefined();
  expect(mapping.messages).toEqual([]);
});

test('a plain task_notification yields one system.task line, and creates no branch', () => {
  const mapping = mapFrame(
    'i1',
    system('task_notification', {
      tool_use_id: 'toolu_bash',
      task_id: 'task-bash',
      status: 'completed',
      summary: SUMMARY,
    })
  );
  expect(mapping.messages).toHaveLength(1);
  expect(mapping.messages[0].type).toBe('system.task');
  expect(mapping.messages[0].content).toBe('task done');
  expect(mapping.messages[0].metadata?.result).toBe(`${SUMMARY.slice(0, 200)}…`);

  const branches: Record<string, SubagentState> = {};
  applyBranchEvent(branches, 'i1', mapping.branch!);
  expect(branches).toEqual({});
});

test('a failed plain task reads "task failed"', () => {
  const mapping = mapFrame(
    'i1',
    system('task_notification', {
      tool_use_id: 'toolu_bash',
      task_id: 'task-bash',
      status: 'failed',
      summary: 'command exited 1',
    })
  );
  expect(mapping.messages[0].content).toBe('task failed');
  expect(mapping.messages[0].metadata?.result).toBe('command exited 1');
});

test('a subagentSpawn tool_use then task frames leave exactly one branch that updates', () => {
  const branches: Record<string, SubagentState> = {};
  const spawn = mapFrame('i1', taskToolUse('toolu_agent'));
  applyBranchEvent(branches, 'i1', spawn.branch!);
  expect(Object.keys(branches)).toHaveLength(1);
  expect(branches.toolu_agent.subagentType).toBe('general-purpose');

  applyBranchEvent(branches, 'i1', {
    toolUseId: 'toolu_agent',
    taskId: 'task-agent',
    subagentType: 'general-purpose',
    status: 'running',
  });
  applyBranchEvent(branches, 'i1', {
    toolUseId: 'toolu_agent',
    taskId: 'task-agent',
    status: 'complete',
    summary: 'SUBAGENT-MARKER',
    result: 'SUBAGENT-MARKER',
  });
  expect(Object.keys(branches)).toHaveLength(1);
  expect(branches.toolu_agent.status).toBe('complete');
  expect(branches.toolu_agent.result).toBe('SUBAGENT-MARKER');
});

test('task frames carrying a real subagent_type create a branch without a prior tool_use', () => {
  const branches: Record<string, SubagentState> = {};
  applyBranchEvent(branches, 'i1', {
    toolUseId: 'toolu_agent',
    subagentType: 'general-purpose',
    status: 'running',
  });
  expect(branches.toolu_agent).toBeDefined();
  expect(branches.toolu_agent.subagentType).toBe('general-purpose');
  expect(branches.toolu_agent.status).toBe('running');
});

test('a task_progress without subagent_type mints no branch', () => {
  const mapping = mapFrame(
    'i1',
    system('task_progress', {
      tool_use_id: 'toolu_bash',
      task_id: 'task-bash',
      description: 'running',
      summary: 'still going',
    })
  );
  expect(mapping.branch).toBeUndefined();
});

test('a real subagent task_notification is suppressed: one branch, zero system.task lines', () => {
  const branches: Record<string, SubagentState> = {};

  // tool_use spawn mints the branch (subagentSpawn).
  const spawn = mapFrame('i1', taskToolUse('toolu_agent'));
  applyBranchEvent(branches, 'i1', spawn.branch!);
  expect(Object.keys(branches)).toHaveLength(1);

  // task_started with a real subagent_type moves the same branch.
  const started = mapFrame(
    'i1',
    system('task_started', {
      tool_use_id: 'toolu_agent',
      task_id: 'task-agent',
      subagent_type: 'general-purpose',
      description: 'research it',
    })
  );
  applyBranchEvent(branches, 'i1', started.branch!);

  // task_notification: mapFrame still emits the line, but the seam suppresses it.
  const notified = mapFrame(
    'i1',
    system('task_notification', {
      tool_use_id: 'toolu_agent',
      task_id: 'task-agent',
      status: 'completed',
      summary: 'SUBAGENT-MARKER',
    })
  );
  applyBranchEvent(branches, 'i1', notified.branch!);
  expect(Object.keys(branches)).toHaveLength(1);
  expect(branches.toolu_agent.status).toBe('complete');

  const surviving = notified.messages.filter(
    (message) => !suppressesTaskLine(branches, message, notified.branch?.toolUseId)
  );
  expect(notified.messages).toHaveLength(1);
  expect(surviving).toHaveLength(0);
});

test('a plain task_notification survives suppression: exactly one system.task line', () => {
  const branches: Record<string, SubagentState> = {};
  const mapping = mapFrame(
    'i1',
    system('task_notification', {
      tool_use_id: 'toolu_bash',
      task_id: 'task-bash',
      status: 'completed',
      summary: 'probe availability',
    })
  );
  applyBranchEvent(branches, 'i1', mapping.branch!);
  expect(branches).toEqual({});

  const surviving = mapping.messages.filter(
    (message) => !suppressesTaskLine(branches, message, mapping.branch?.toolUseId)
  );
  expect(surviving).toHaveLength(1);
  expect(surviving[0].type).toBe('system.task');
});
