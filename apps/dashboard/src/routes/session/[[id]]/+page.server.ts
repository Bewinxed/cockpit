import type { InstanceRow, SessionMessage } from '@cockpit/core';
import { turnStart } from '$lib/cockpit/frames';
import { TRANSCRIPT_FIRST_CHUNK } from '$lib/config';
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

/** Beyond this many entries the tail read gives up looking for a clean cut. */
const TAIL_CEILING = TRANSCRIPT_FIRST_CHUNK * 4;

/** The content blocks of a stored entry, for the tool pairing a cut must not split. */
function contentBlocks(entry: SessionMessage): { type?: string; id?: string; tool_use_id?: string }[] {
  const content = (entry.message as { content?: unknown } | null)?.content;
  return Array.isArray(content) ? (content as { type?: string; id?: string; tool_use_id?: string }[]) : [];
}

/**
 * The newest turns of a transcript, as one bounded read.
 *
 * This is what the page PAINTS: the pane renders these rows into the server's
 * HTML, so a reload shows the conversation before the bundle has hydrated.
 * Deliberately the same cut `streamHistory`'s first chunk makes — at least
 * TRANSCRIPT_FIRST_CHUNK entries, ending on a turn opener with no tool result
 * left hanging over the edge — so when the live store takes over, the rows it
 * publishes are the rows already on screen and the swap moves nothing.
 *
 * The stream is cancelled at the cut. The rest of the file is the client's
 * problem, and reading it here would put the whole transcript in front of the
 * first byte.
 */
async function readTail(
  fetch: typeof globalThis.fetch,
  url: string
): Promise<SessionMessage[]> {
  const response = await fetch(url);
  if (!response.ok || !response.body) return [];
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  /** Newest first, as the hub sends it. */
  const buffered: SessionMessage[] = [];
  /** Tool results whose `tool_use` is older still — a cut here would split them. */
  const dangling = new Set<string>();
  let carry = '';
  let cut = false;

  /** True once `buffered` is a chunk that can stand on its own. */
  const consume = (entry: SessionMessage): boolean => {
    for (const block of contentBlocks(entry)) {
      if (block.type === 'tool_result' && block.tool_use_id) dangling.add(block.tool_use_id);
      else if (block.type === 'tool_use' && block.id) dangling.delete(block.id);
    }
    buffered.push(entry);
    if (buffered.length >= TAIL_CEILING) return true;
    if (buffered.length < TRANSCRIPT_FIRST_CHUNK || dangling.size > 0) return false;
    return turnStart(entry) !== null;
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      carry += decoder.decode(value, { stream: true });
      for (let newline = carry.indexOf('\n'); newline >= 0; newline = carry.indexOf('\n')) {
        const line = carry.slice(0, newline);
        carry = carry.slice(newline + 1);
        if (line && consume(JSON.parse(line) as SessionMessage)) {
          cut = true;
          break;
        }
      }
      if (cut) break;
    }
    if (!cut) {
      carry += decoder.decode();
      if (carry.trim()) consume(JSON.parse(carry) as SessionMessage);
    }
  } catch {
    // A half-read tail is still a tail; whatever arrived whole is rendered.
  } finally {
    await reader.cancel().catch(() => {});
  }

  // Newest-first off the wire, oldest-first on screen.
  return buffered.reverse();
}

/** The read URL, addressed exactly as `streamHistory` addresses it. */
function messagesUrl(source: HistorySource): string {
  return source.live
    ? `/api/instances/${encodeURIComponent(source.viewId)}/messages`
    : `/api/instances/${encodeURIComponent(source.sessionId)}/messages?${new URLSearchParams({
        machine: source.machineId,
        harness: source.harness,
        ...(source.cwd && { cwd: source.cwd }),
      })}`;
}

/**
 * A transcript used to be readable only over the dashboard's own WebSocket, so
 * every reload showed an empty conversation until the hub reconnected and
 * backfilled it. The hub now answers `GET /api/instances/:id/messages`, which a
 * page can reach at render time — so this resolves *which* read that is AND
 * takes the newest turns off it, which the pane renders into the server's HTML.
 *
 * `history` stays a promise the shell paints around: it names the full streamed
 * read the client still performs. `tail` is NOT awaited — it streams to the
 * client as a deferred promise so navigation is instant. On SSR (first load),
 * the page renders its loading state; the tail resolves and fills in the
 * transcript. On client-side tab switches, the pane is already mounted with
 * WebSocket data, so the streamed tail is just a confirmation.
 */
export const load: PageServerLoad = async ({ params, url, fetch, depends, untrack }) => {
  depends('data:session-tail');
  const viewId = untrack(() => params.id);

  if (!viewId) return { history: null, tail: null };

  const machine = untrack(() => url.searchParams.get('machine'));
  if (machine) {
    const source: HistorySource = {
      viewId,
      machineId: machine,
      sessionId: viewId,
      cwd: untrack(() => url.searchParams.get('cwd')) ?? '',
      harness: untrack(() => url.searchParams.get('harness')) ?? 'claude',
      live: false,
    };
    return { history: Promise.resolve(source), tail: await tailFor(fetch, source) };
  }

  let source: HistorySource | null = null;
  try {
    const response = await fetch('/api/instances');
    if (response.ok) {
      const rows = (await response.json()) as InstanceRow[];
      const row = rows.find((instance) => instance.id === viewId);
      if (row) {
        source = {
          viewId,
          machineId: row.machineId,
          sessionId: row.sessionId ?? viewId,
          cwd: row.cwd ?? '',
          harness: row.harness ?? 'claude',
          live: true,
        };
      }
    }
  } catch {
    source = null;
  }

  return {
    history: Promise.resolve(source),
    tail: source ? await tailFor(fetch, source) : null,
  };
};

/** The tail plus the identity the pane needs to name it before the store exists. */
async function tailFor(fetch: typeof globalThis.fetch, source: HistorySource) {
  return {
    viewId: source.viewId,
    machineId: source.machineId,
    sessionId: source.sessionId,
    cwd: source.cwd,
    harness: source.harness,
    messages: await readTail(fetch, messagesUrl(source)),
  };
}
