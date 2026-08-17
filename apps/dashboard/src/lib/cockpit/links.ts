/**
 * How a stored session addresses itself in the URL bar. The route id is the SDK
 * `sessionId` and the machine it lives on rides in the query, so a transcript
 * link is shareable and survives a reload with nothing cached.
 */
import type { SDKSessionInfo } from '@cockpit/core';

export function transcriptHref(machineId: string, info: SDKSessionInfo): string {
  const query = new URLSearchParams({ machine: machineId });
  if (info.cwd) query.set('cwd', info.cwd);
  query.set('harness', info.harness);
  return `/session/${info.sessionId}?${query}`;
}

export function sessionTitle(info: SDKSessionInfo): string {
  return info.customTitle || info.summary || info.firstPrompt || 'untitled session';
}

/**
 * The fleet-wide handle for a delegate: repo leaf plus the first eight of its
 * instance id — the same name its reports carry ("Report from delegate
 * cockpit#3c872de1"), so the rail and the transcript agree on what to call it.
 */
export function delegateHandle(row: { id: string; cwd: string }): string {
  const leaf = row.cwd.split('/').filter(Boolean).pop() ?? 'session';
  return `${leaf}#${row.id.slice(0, 8)}`;
}

/**
 * The full instance id behind a full or short (8-char prefix) id, if it names
 * exactly one row. A stored transcript keeps only the short id (NEW.md:
 * `matchesSession` prefix-matches), so a session reference in a report header
 * or a hand-off receipt resolves here against the fleet's live rows.
 */
export function resolveInstanceId(
  id: string | null | undefined,
  instances: ReadonlyArray<{ id: string }>
): string | undefined {
  if (!id) return undefined;
  if (instances.some((row) => row.id === id)) return id;
  if (id.length >= 8) {
    const matches = instances.filter((row) => row.id.startsWith(id));
    return matches.length === 1 ? matches[0].id : undefined;
  }
  return undefined;
}
