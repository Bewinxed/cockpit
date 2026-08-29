import type { DelegateTypesPayload } from '$lib/cockpit/delegate-types';
import type { PageLoad } from './$types';

/**
 * Delegate types are the hub's, so they are read through the proxy rather
 * than the app socket: the page renders on the server, and a hub that is
 * down leaves a sentence to read instead of a blank page — the same bargain
 * `/rules` and `/hooks` make.
 */
export const load: PageLoad = async ({ fetch }) => {
  const payload = await fetch('/api/delegate-types')
    .then(async (response) => {
      if (!response.ok) throw new Error(`the hub answered ${response.status}`);
      return (await response.json()) as DelegateTypesPayload;
    })
    .catch((error: unknown) => error as Error);

  return {
    types: payload instanceof Error ? [] : (payload.types ?? []),
    error: payload instanceof Error ? `Could not read the delegate types — ${payload.message}.` : null,
  };
};
