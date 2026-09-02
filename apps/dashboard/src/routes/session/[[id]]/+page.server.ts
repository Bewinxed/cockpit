import type { InstanceRow, SessionMessage } from '@whiffle/core';
import { turnStart } from '$lib/whiffle/frames';
import { TRANSCRIPT_FIRST_CHUNK } from '$lib/config';
import type { PageServerLoad } from './$types';

/**
 * Where this conversation's stored transcript can be read from, resolved on the
 * server so the browser can start reading it without waiting for its socket.
 * Mirrors `HistorySource` in the whiffle store.
 */
interface HistorySource {
  viewId: string;
  machineId: string;
  sessionId: string;
  cwd: string;
  harness: string;
  live: boolean;
  /** The location came from the URL's own query and is sent to the hub as an override. */
  override?: boolean;
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
): Promise<{ messages: SessionMessage[]; found: Partial<HistorySource> }> {
  const response = await fetch(url);
  if (!response.ok || !response.body) return { messages: [], found: {} };
  // Where the hub found it — the one thing a bare id does not say, and the
  // pane names the machine in its header from the first paint.
  const found: Partial<HistorySource> = {};
  const machineId = response.headers.get('x-whiffle-machine');
  if (machineId) found.machineId = machineId;
  const cwd = response.headers.get('x-whiffle-cwd');
  if (cwd) found.cwd = decodeURIComponent(cwd);
  const harness = response.headers.get('x-whiffle-harness');
  if (harness) found.harness = harness;
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
  return { messages: buffered.reverse(), found };
}

/**
 * The read URL, addressed exactly as `streamHistory` addresses it: the view's
 * id alone — the hub maps a live instance to its SDK key and locates any other
 * — unless the URL that brought the reader here spelled the location out.
 */
function messagesUrl(source: HistorySource): string {
  const path = `/api/instances/${encodeURIComponent(source.viewId)}/messages`;
  if (!source.override) return path;
  return `${path}?${new URLSearchParams({
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
 * read the client still performs.
 *
 * `tail` is awaited for a DOCUMENT request and skipped for a data request, and
 * the difference is the whole point. On a cold load the awaited tail is what
 * puts real transcript rows in the server's HTML — the reason the virtualiser
 * carries an SSR path at all. On anything the client asks for afterwards it is
 * dead weight: the socket already holds the conversation, and awaiting a second
 * copy of it only delayed the answer.
 *
 * It used to be awaited on both, under a comment claiming it was awaited on
 * neither. That was the layout shift: a tab switch ran this load, the tail
 * landed after the animation had finished, and the transcript rebuilt itself
 * from the slower of two identical sources. Switching conversations no longer
 * reaches this file at all — the workspace store owns that now — so this gate
 * is what remains for arrivals from another route.
 */
export const load: PageServerLoad = async ({ params, url, fetch, untrack, isDataRequest }) => {
  const viewId = untrack(() => params.id);

  if (!viewId) return { history: null, tail: null };

  // A link minted while stored transcripts still carried their location. It
  // is honoured as an override rather than resolved, so an old bookmark reads
  // exactly what it always read.
  const machine = untrack(() => url.searchParams.get('machine'));
  if (machine) {
    const source: HistorySource = {
      viewId,
      machineId: machine,
      sessionId: viewId,
      cwd: untrack(() => url.searchParams.get('cwd')) ?? '',
      harness: untrack(() => url.searchParams.get('harness')) ?? 'claude',
      live: false,
      override: true,
    };
    return {
      history: Promise.resolve(source),
      tail: isDataRequest ? null : await tailFor(fetch, source),
    };
  }

  // Otherwise the id is the whole address. The hub's rows say whether it is a
  // running session — which decides how the client reconciles live frames
  // behind the read — and name it ahead of the transcript; a session the hub
  // does not hold is read by the same id and located on the way.
  let row: InstanceRow | undefined;
  try {
    const response = await fetch('/api/instances');
    if (response.ok) {
      const rows = (await response.json()) as InstanceRow[];
      row = rows.find((instance) => instance.id === viewId);
    }
  } catch {
    row = undefined;
  }
  const source: HistorySource = {
    viewId,
    machineId: row?.machineId ?? '',
    sessionId: row?.sessionId ?? viewId,
    cwd: row?.cwd ?? '',
    harness: row?.harness ?? 'claude',
    live: row !== undefined,
  };

  return {
    history: Promise.resolve(source),
    tail: isDataRequest ? null : await tailFor(fetch, source),
  };
};

/** The tail plus the identity the pane needs to name it before the store exists. */
async function tailFor(fetch: typeof globalThis.fetch, source: HistorySource) {
  const { messages, found } = await readTail(fetch, messagesUrl(source));
  return {
    viewId: source.viewId,
    machineId: source.machineId || (found.machineId ?? ''),
    sessionId: source.sessionId,
    cwd: source.cwd || (found.cwd ?? ''),
    harness: found.harness ?? source.harness,
    messages,
  };
}
