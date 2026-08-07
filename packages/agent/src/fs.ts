/**
 * The `fs` verb (NEW.md §6): directory listings for the cwd picker and small
 * text reads/writes for editing a repo's markdown. Deliberately not a file
 * transfer — anything bigger belongs in a session, not in this tunnel.
 */
import type { FsEntry, FsPayload } from '@cockpit/core';
import { readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * `~` is the shell's, not a path: anything handed a literal `~` — a spawn's
 * working directory, a probe for a binary an installer left in a home
 * directory — is pointed at somewhere that does not exist.
 */
export const expandHome = (path: string): string => {
  if (path === '~') return homedir();
  return path.startsWith('~/') ? join(homedir(), path.slice(2)) : path;
};

/** A read past this is a file transfer, which this verb is not for. */
const MAX_READ_BYTES = 512 * 1024;

/**
 * Cockpit is a single-user tool on a trusted network (NEW.md §6), so this is a
 * guard against a mistyped path reaching kernel and system state, not an
 * attacker: the whole rest of the machine is deliberately reachable.
 */
const FORBIDDEN_ROOTS = ['/proc', '/sys', '/etc'];

/** Resolves traversal first — `/home/x/../../etc/shadow` is `/etc/shadow`. */
const safePath = (path: string): string => {
  if (!path.startsWith('/')) throw new Error(`fs paths must be absolute, got ${path}`);
  const resolved = resolve(path);
  if (FORBIDDEN_ROOTS.some((root) => resolved === root || resolved.startsWith(`${root}/`))) {
    throw new Error(`${resolved} is off limits`);
  }
  return resolved;
};

const list = async (path: string): Promise<FsEntry[]> => {
  const dirents = await readdir(path, { withFileTypes: true });
  return dirents
    .map((dirent) => ({
      name: dirent.name,
      kind: dirent.isDirectory() ? ('dir' as const) : ('file' as const),
      size: dirent.isDirectory() ? 0 : Bun.file(`${path}/${dirent.name}`).size,
    }))
    .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1));
};

const read = async (path: string): Promise<string> => {
  const file = Bun.file(path);
  if (!(await file.exists())) throw new Error(`${path} does not exist`);
  if (file.size > MAX_READ_BYTES) {
    throw new Error(`${path} is ${file.size} bytes; fs read stops at ${MAX_READ_BYTES}`);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  // A NUL byte means this is not text, and shipping it as a string would only
  // hand the browser mojibake to render.
  if (bytes.includes(0)) throw new Error(`${path} is a binary file`);
  return new TextDecoder().decode(bytes);
};

export const runFs = async ({ op, path, content }: FsPayload): Promise<unknown> => {
  const target = safePath(path);
  switch (op) {
    case 'list':
      return await list(target);
    case 'read':
      return await read(target);
    case 'write':
      return { bytes: await Bun.write(target, content ?? '') };
    default:
      throw new Error(`unknown fs op: ${op}`);
  }
};
