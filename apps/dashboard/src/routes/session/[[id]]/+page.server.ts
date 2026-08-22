import type { InstanceRow } from '@cockpit/core';
import type { PageServerLoad } from './$types';

/**
 * Where this conversation's stored transcript can be read from, resolved on the
 * server so the browser can start reading it without waiting for its socket.
 * Mirrors `HistorySource` in the cockpit store.
 */
interface HistorySource {
  viewId: string;
  machineId: string;
  sessionId: string;
  cwd: string;
  harness: string;
  live: boolean;
}

/**
 * A transcript used to be readable only over the dashboard's own WebSocket, so
 * every reload showed an empty conversation until the hub reconnected and
 * backfilled it. The hub now answers `GET /api/instances/:id/messages`, which a
 * page can reach at render time — this resolves *which* read that is, and the
 * pane streams it.
 *
 * Returned as a promise rather than awaited: the shell paints on the first
 * response chunk and this streams in behind it (SvelteKit streamed data).
 */
export const load: PageServerLoad = ({ params, url, fetch }) => {
  const viewId = params.id;
  // The fleet board. Nothing is open, so there is no history to read.
  if (!viewId) return { history: null };

  // A `machine` in the query means the URL names a stored session outright —
  // everything the read needs is in the link.
  const machine = url.searchParams.get('machine');
  if (machine) {
    return {
      history: Promise.resolve<HistorySource>({
        viewId,
        machineId: machine,
        sessionId: viewId,
        cwd: url.searchParams.get('cwd') ?? '',
        harness: url.searchParams.get('harness') ?? 'claude',
        live: false,
      }),
    };
  }

  // A live session carries only its id. Its row on the hub says which machine
  // holds it — which the browser would otherwise not know until the socket
  // delivered the fleet, the wait this whole path exists to remove.
  const resolve = async (): Promise<HistorySource | null> => {
    try {
      const response = await fetch('/api/instances');
      if (!response.ok) return null;
      const rows = (await response.json()) as InstanceRow[];
      const row = rows.find((instance) => instance.id === viewId);
      if (!row) return null;
      return {
        viewId,
        machineId: row.machineId,
        sessionId: row.sessionId ?? viewId,
        cwd: row.cwd ?? '',
        harness: row.harness ?? 'claude',
        live: true,
      };
    } catch {
      // The hub being unreachable is the ordinary case, not an exotic one: the
      // pane falls back to the socket, which reports it for itself.
      return null;
    }
  };

  return { history: resolve() };
};
