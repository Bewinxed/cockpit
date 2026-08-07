// Does a real `status` frame reach the meter? The SDK emits these while it is
// compacting; the mapper used to drop them on the floor.
import { expect, test } from 'bun:test';
import { classifyCommand } from '@cockpit/core';
import { mapFrame } from './frames';

const base = { type: 'system' as const, uuid: 'u1' as never, session_id: 's1' };

test('compacting is carried through', () => {
  const mapping = mapFrame('i1', { ...base, subtype: 'status', status: 'compacting' } as never);
  expect(mapping.status).toBe('compacting');
  expect(mapping.compaction).toBeUndefined();
});

test('the status that ends a compaction carries its outcome', () => {
  const mapping = mapFrame('i1', {
    ...base,
    subtype: 'status',
    status: null,
    compact_result: 'success',
  } as never);
  expect(mapping.status).toBeNull();
  expect(mapping.compaction).toEqual({ result: 'success', error: undefined });
});

test('a failed compaction keeps its reason', () => {
  const mapping = mapFrame('i1', {
    ...base,
    subtype: 'status',
    status: null,
    compact_result: 'failed',
    compact_error: 'context too small to compact',
  } as never);
  expect(mapping.compaction).toEqual({
    result: 'failed',
    error: 'context too small to compact',
  });
});

test('a frame that says nothing about status leaves it alone', () => {
  const mapping = mapFrame('i1', {
    ...base,
    subtype: 'init',
    model: 'claude-fable-5',
    permissionMode: 'default',
    cwd: '/tmp',
    tools: [],
    session_id: 's1',
    mcp_servers: [],
  } as never);
  expect(mapping.status).toBeUndefined();
});

test('an init frame carries the whole `/` menu, and which of it is skills', () => {
  const mapping = mapFrame('i1', {
    ...base,
    subtype: 'init',
    model: 'claude-fable-5',
    permissionMode: 'default',
    cwd: '/tmp',
    tools: [],
    mcp_servers: [],
    slash_commands: ['compact', 'my-plugin:greet'],
    skills: ['my-plugin:greet'],
  } as never);
  const { metadata } = mapping.messages[0];
  expect(metadata?.slashCommands).toEqual(['compact', 'my-plugin:greet']);
  expect(metadata?.skills).toEqual(['my-plugin:greet']);
  // The store classifies from exactly these two, and the palette from that.
  expect(classifyCommand('compact', metadata!.skills!)).toBe('builtin');
  expect(classifyCommand('my-plugin:greet', metadata!.skills!)).toBe('skill');
});

test('a mid-session change hands over the whole list, and says nothing in the transcript', () => {
  const commands = [{ name: 'compact', description: 'Compact the context', argumentHint: '' }];
  const mapping = mapFrame('i1', { ...base, subtype: 'commands_changed', commands } as never);
  expect(mapping.commands).toEqual(commands);
  expect(mapping.messages).toEqual([]);
});

import { applyBranchEvent } from './frames';
import type { SubagentState } from '$lib/utils/flow-types';

test('a finished subagent is not put back to running by late progress', () => {
  const branches: Record<string, SubagentState> = {};
  applyBranchEvent(branches, 'i1', { toolUseId: 't1', subagentType: 'code', status: 'running' });
  applyBranchEvent(branches, 'i1', { toolUseId: 't1', status: 'complete' });
  // Progress frames queued behind the result still arrive after it.
  applyBranchEvent(branches, 'i1', { toolUseId: 't1', status: 'running', summary: 'still going' });
  expect(branches.t1.status).toBe('complete');
});

test('an errored subagent stays errored', () => {
  const branches: Record<string, SubagentState> = {};
  applyBranchEvent(branches, 'i1', { toolUseId: 't2', status: 'running' });
  applyBranchEvent(branches, 'i1', { toolUseId: 't2', status: 'error' });
  applyBranchEvent(branches, 'i1', { toolUseId: 't2', status: 'running' });
  expect(branches.t2.status).toBe('error');
});

test('the model a spawn asks for reaches the branch and the tool card', () => {
  const mapping = mapFrame('i1', {
    type: 'assistant',
    uuid: 'u2',
    session_id: 's1',
    parent_tool_use_id: null,
    message: {
      model: 'claude-sonnet-5',
      content: [
        {
          type: 'tool_use',
          id: 'toolu_1',
          name: 'Task',
          input: { subagent_type: 'Explore', description: 'look around', model: 'opus' },
        },
      ],
    },
  } as never);
  expect(mapping.branch?.model).toBe('opus');

  const branches: Record<string, SubagentState> = {};
  applyBranchEvent(branches, 'i1', mapping.branch!);
  expect(branches.toolu_1.model).toBe('opus');
  expect(mapping.messages[0].metadata?.subagentModel).toBe('opus');
});

test('a forwarded frame names the model that answered, without moving the branch', () => {
  const mapping = mapFrame('i1', {
    type: 'assistant',
    uuid: 'u3',
    session_id: 's1',
    parent_tool_use_id: 'toolu_1',
    message: { model: 'claude-opus-4-6', content: [{ type: 'text', text: 'looking' }] },
  } as never);
  expect(mapping.branch).toEqual({ toolUseId: 'toolu_1', model: 'claude-opus-4-6' });

  const branches: Record<string, SubagentState> = {};
  applyBranchEvent(branches, 'i1', { toolUseId: 'toolu_1', status: 'running' });
  applyBranchEvent(branches, 'i1', mapping.branch!);
  expect(branches.toolu_1.status).toBe('running');
});

test('the model that answered wins over the alias the spawn asked for', () => {
  const branches: Record<string, SubagentState> = {};
  applyBranchEvent(branches, 'i1', { toolUseId: 't3', subagentType: 'Explore', model: 'opus' });
  applyBranchEvent(branches, 'i1', { toolUseId: 't3', model: 'claude-opus-4-6' });
  expect(branches.t3.model).toBe('claude-opus-4-6');
});
