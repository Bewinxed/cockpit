import type { HooksPayload } from "$lib/whiffle/hooks";
import type { PageLoad } from "./$types";

/**
 * Hooks are the fleet's, so they are read through the proxy rather than the
 * app socket: the page renders on the server, and a hub that is down leaves a
 * sentence to read instead of a blank page — the same bargain `/rules` and
 * `/tools` make.
 */
export const load: PageLoad = async ({ fetch }) => {
  const payload = await fetch("/api/fleet/hooks")
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`the hub answered ${response.status}`);
      }
      return (await response.json()) as HooksPayload;
    })
    .catch((error: unknown) => error as Error);

  return {
    hooks: payload instanceof Error ? [] : (payload.hooks ?? []),
    error:
      payload instanceof Error
        ? `Could not read the hooks — ${payload.message}.`
        : null,
  };
};
