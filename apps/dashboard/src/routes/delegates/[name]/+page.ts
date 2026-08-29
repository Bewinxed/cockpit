import { error } from '@sveltejs/kit';
import type { DelegateTypesPayload } from '$lib/cockpit/delegate-types';
import type { DelegateType } from '@cockpit/core';
import type { PageLoad } from './$types';

/**
 * One delegate type, or the blank one. `new` is the name of a delegate type
 * that does not exist yet, so composing and editing are the same screen with
 * the same URL shape — the pattern `rules/[id]` already established.
 *
 * The whole table is fetched rather than a by-name endpoint: it is a handful
 * of rows, and the list of names is needed anyway to refuse a duplicate.
 */
export const load: PageLoad = async ({ fetch, params }) => {
  const payload = await fetch('/api/delegate-types')
    .then(async (response) => {
      if (!response.ok) throw new Error(`the hub answered ${response.status}`);
      return (await response.json()) as DelegateTypesPayload;
    })
    .catch((caught: unknown) => caught as Error);

  if (payload instanceof Error) {
    return {
      type: null as DelegateType | null,
      taken: [] as string[],
      composing: params.name === 'new',
      error: `Could not read the delegate types — ${payload.message}.`,
    };
  }

  const type = payload.types.find((candidate) => candidate.name === params.name) ?? null;
  if (params.name !== 'new' && !type) {
    error(404, 'That delegate type is gone — it was deleted, or the link is from another hub.');
  }

  return {
    type,
    taken: payload.types.filter((other) => other.name !== params.name).map((other) => other.name),
    composing: params.name === 'new',
    error: null as string | null,
  };
};
