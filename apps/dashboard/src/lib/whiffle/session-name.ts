/**
 * What a conversation is called, the one way — the tab, the group header
 * and the pane's bar all read this, so none of them names a different
 * session than the others, and none of them flashes through the id, the
 * folder and a mid-transcript message on the way to the real title.
 */
import { whiffle } from './client.svelte';
import { resolveSessionTitle } from './links';
import { workingSet } from './working-set.svelte';
import { contextOf } from './workspace/workspace.svelte';

export interface SessionName {
  label: string;
  /** Whether the fleet or the transcript has named it, rather than a stand-in. */
  named: boolean;
}

/**
 * `served` is what the layout server resolved for every open tab before the
 * first paint, so the very first render already carries the right name and a
 * reload morphs nothing. The transcript names a session only once it is fully
 * read: the fetch streams newest-first, so the first user message a half-read
 * transcript holds is one from the middle of the conversation.
 */
export function sessionName(
  id: string,
  served: Record<string, string>,
  cwdFallback?: string
): SessionName {
  const row = whiffle.instances.find((instance) => instance.id === id);
  const view = whiffle.session(id);
  const ctx = contextOf(id);
  const title = row?.title;
  const settled = !!view && !view.loading && !view.hydrating;
  const firstMessage = settled
    ? view.messages.find((m) => m.type === 'user' && m.content.trim())?.content
    : undefined;
  const named = !!title?.trim() || !!firstMessage?.trim();
  const resolved = resolveSessionTitle({
    title,
    firstMessage,
    cwd: view?.cwd || row?.cwd || ctx?.cwd || cwdFallback,
    id,
  });
  return {
    // A conversation this browser has named before keeps that name, and a
    // name the server resolved stands in after it, until the fleet and the
    // transcript have both answered; falling back to the folder for that
    // moment is the flash the remembered title removes.
    label: named ? resolved : (workingSet.titleOf(id) ?? served[id] ?? resolved),
    named,
  };
}
