import type { RulesPayload } from '$lib/whiffle/rules';
import type { PageLoad } from './$types';

/**
 * Rules are the hub's, so they are read through the proxy rather than the app
 * socket: the page renders on the server, and a hub that is down leaves a
 * sentence to read instead of a blank page — the same bargain `/tools` makes.
 */
export const load: PageLoad = async ({ fetch }) => {
  const payload = await fetch('/api/rules')
    .then(async (response) => {
      if (!response.ok) throw new Error(`the hub answered ${response.status}`);
      return (await response.json()) as RulesPayload;
    })
    .catch((error: unknown) => error as Error);

  return {
    rules: payload instanceof Error ? [] : (payload.rules ?? []),
    error: payload instanceof Error ? `Could not read the rules — ${payload.message}.` : null,
  };
};
