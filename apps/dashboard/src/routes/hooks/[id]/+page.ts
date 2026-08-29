import { error } from '@sveltejs/kit';
import type { FleetHook, HooksPayload } from '$lib/cockpit/hooks';
import type { PageLoad } from './$types';

/**
 * One hook, or the blank one. `new` is the id of a hook that does not exist
 * yet, so composing and editing are the same screen with the same URL shape —
 * mirrors `/rules/[id]`.
 *
 * The whole table is fetched rather than a by-id endpoint: it is a handful of
 * rows, and the list of names is needed anyway to refuse a duplicate.
 */
export const load: PageLoad = async ({ fetch, params }) => {
  const payload = await fetch('/api/fleet/hooks')
    .then(async (response) => {
      if (!response.ok) throw new Error(`the hub answered ${response.status}`);
      return (await response.json()) as HooksPayload;
    })
    .catch((caught: unknown) => caught as Error);

  if (payload instanceof Error) {
    return {
      hook: null as FleetHook | null,
      taken: [] as string[],
      composing: params.id === 'new',
      error: `Could not read the hooks — ${payload.message}.`,
    };
  }

  const hook = payload.hooks.find((candidate) => candidate.id === params.id) ?? null;
  if (params.id !== 'new' && !hook) {
    error(404, 'That hook is gone — it was deleted, or the link is from another hub.');
  }

  return {
    hook,
    taken: payload.hooks.filter((other) => other.id !== params.id).map((other) => other.name),
    composing: params.id === 'new',
    error: null as string | null,
  };
};
