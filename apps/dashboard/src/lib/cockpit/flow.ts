/**
 * The plan zone of a project home: `.flow/` read through the `fs` verb. flowctl
 * owns these files (CLAUDE.md), so this is strictly a reader — the dashboard
 * never writes an epic or a task.
 */
import type { FsEntry } from '@cockpit/core';
import { machineFs } from './client.svelte';

/** `.flow/tasks/fn-18.1.json`, verbatim except for what a rail cannot show. */
export interface FlowTask {
  id: string;
  epic: string;
  title: string;
  status: string;
}

/** `.flow/epics/fn-18.json`, with the tasks that named it. */
export interface FlowEpic {
  id: string;
  title: string;
  status: string;
  tasks: FlowTask[];
  done: number;
}

const isJson = (entry: FsEntry): boolean => entry.kind === 'file' && entry.name.endsWith('.json');

/** `fn-18.1` sorts after `fn-9.2`: flowctl ids are numeric, not lexical. */
const ordinals = (id: string): number[] =>
  id.split(/[-.]/).map((part) => Number(part) || 0);

const byId = (a: { id: string }, b: { id: string }): number => {
  const [left, right] = [ordinals(a.id), ordinals(b.id)];
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const difference = (left[i] ?? 0) - (right[i] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
};

/** A checkout that never ran flowctl has no plan to show; that is not a failure. */
const missing = (error: unknown): boolean => String(error).includes('ENOENT');

/** Every JSON file in one `.flow` directory, parsed. Missing directory → `[]`. */
async function readAll<T>(machineId: string, dir: string): Promise<T[]> {
  const entries = await machineFs<FsEntry[]>(machineId, 'list', dir).catch((error: unknown) => {
    if (missing(error)) return [];
    throw error;
  });
  const files = await Promise.all(
    entries
      .filter(isJson)
      .map((entry) => machineFs<string>(machineId, 'read', `${dir}/${entry.name}`))
  );
  return files.map((text) => JSON.parse(text) as T);
}

/** The repo's epics, newest first, each carrying its tasks. */
export async function readFlow(machineId: string, cwd: string): Promise<FlowEpic[]> {
  const [epics, tasks] = await Promise.all([
    readAll<{ id: string; title: string; status: string }>(machineId, `${cwd}/.flow/epics`),
    readAll<FlowTask>(machineId, `${cwd}/.flow/tasks`),
  ]);

  return epics
    .map((epic) => {
      const owned = tasks.filter((task) => task.epic === epic.id).sort(byId);
      return {
        id: epic.id,
        title: epic.title,
        status: epic.status,
        tasks: owned,
        done: owned.filter((task) => task.status === 'done').length,
      };
    })
    .sort((a, b) => byId(b, a));
}
