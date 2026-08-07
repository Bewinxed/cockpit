/**
 * The docs rail of a project home: the repo's own markdown, read through the
 * `fs` verb. Files-as-truth (NEW.md §1) — nothing here is stored by cockpit.
 */
import type { FsEntry } from '@cockpit/core';
import { machineFs } from './client.svelte';

/** Conventional doc directories, listed after the root's own markdown. */
const DOC_DIRS = ['docs', 'doc'];

const isMarkdown = (entry: FsEntry): boolean =>
  entry.kind === 'file' && /\.mdx?$/i.test(entry.name);

const stemOf = (name: string): string => name.replace(/\.mdx?$/i, '').toUpperCase();

/**
 * CLAUDE.md is a doc the reader edits rather than one they browse, and the
 * project home gives it its own card in the rail. Listing it here too put the
 * same file on screen twice, in two editors.
 */
const isMemory = (entry: FsEntry): boolean => stemOf(entry.name) === 'CLAUDE';

/** What a repo is, then what it plans, then how to work in it — the reading order. */
function rank(name: string): number {
  const stem = stemOf(name);
  if (stem === 'README') return 0;
  if (stem.startsWith('PRD')) return 1;
  if (stem === 'NEW') return 2;
  return 3;
}

/** A markdown file in the project, addressed by its path relative to the cwd. */
export interface Doc {
  /** `README.md`, or `docs/architecture.md` — what the rail shows. */
  name: string;
  path: string;
}

export async function readDocs(machineId: string, cwd: string): Promise<Doc[]> {
  const entries = await machineFs<FsEntry[]>(machineId, 'list', cwd);

  const root = entries
    .filter((entry) => isMarkdown(entry) && !isMemory(entry))
    .sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name))
    .map((entry) => ({ name: entry.name, path: `${cwd}/${entry.name}` }));

  const nested = await Promise.all(
    entries
      .filter((entry) => entry.kind === 'dir' && DOC_DIRS.includes(entry.name))
      .map(async (dir) => {
        const inside = await machineFs<FsEntry[]>(machineId, 'list', `${cwd}/${dir.name}`);
        return inside
          .filter(isMarkdown)
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((entry) => ({
            name: `${dir.name}/${entry.name}`,
            path: `${cwd}/${dir.name}/${entry.name}`,
          }));
      })
  );

  return [...root, ...nested.flat()];
}
