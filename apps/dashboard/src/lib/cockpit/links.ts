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

/** How long a title derived from a first message runs before it is cut. */
const TITLE_LIMIT = 80;

/**
 * A session's first message as a title. A slash command's first message is the
 * harness echo, which wraps the invocation in `<command-message>` /
 * `<command-name>` — show the command, not the raw XML. Anything else has its
 * markup stripped and is folded onto one line.
 */
function fromFirstMessage(raw: string): string {
  const command = /<command-(?:message|name)>([\s\S]*?)<\/command-(?:message|name)>/
    .exec(raw)?.[1]
    ?.trim();
  const cleaned = (command ?? raw.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  return cleaned.slice(0, TITLE_LIMIT);
}

/**
 * What a session is called, wherever it is named — the tab strip, the session
 * header, the rail, the palette. One function so the tab and the header can
 * never disagree about which conversation the reader clicked.
 *
 * In order: a real title somebody or the harness gave it, then what it was
 * first asked to do, then the folder it works in. A session that has said
 * anything at all is never "untitled".
 */
export function resolveSessionTitle(input: {
  /** A named title: a custom one, or the harness's own summary. */
  title?: string | null;
  /** The first thing the session was asked, raw and still wrapped in markup. */
  firstMessage?: string | null;
  /** Where it works; its leaf names the session when nothing else can. */
  cwd?: string | null;
  /** The last resort, shortened — better than a word that says nothing. */
  id?: string | null;
}): string {
  const named = input.title?.trim();
  if (named) return named;

  const first = input.firstMessage?.trim();
  if (first) {
    const derived = fromFirstMessage(first);
    if (derived) return derived;
  }

  const leaf = (input.cwd ?? '').split('/').filter(Boolean).pop();
  if (leaf) return leaf;

  return input.id ? input.id.slice(0, 8) : 'session';
}

/** The same title, for a stored session the machine's catalog described. */
export function sessionTitle(info: SDKSessionInfo): string {
  return resolveSessionTitle({
    title: info.customTitle || info.summary,
    firstMessage: info.firstPrompt,
    cwd: info.cwd,
    id: info.sessionId,
  });
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
