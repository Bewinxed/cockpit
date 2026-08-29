import type { FleetConfig } from '@cockpit/core';
import type { FleetSnapshot } from '$lib/cockpit/fleet';
import type { HooksPayload } from '$lib/cockpit/hooks';
import type { ToolsSnapshot } from '$lib/cockpit/tools';
import type { PageLoad } from './$types';

const EMPTY: FleetConfig = { mcp: [], marketplaces: [], plugins: [] };

/**
 * The catalog, the policy table, the fleet's desired state and the hooks are
 * all the hub's, so they are read through the proxy rather than the app
 * socket — the page renders on the server, and a hub that is down leaves a
 * sentence to read instead of a blank page. All four reads run once for the
 * whole page: switching panels never touches this load again.
 *
 * Hooks are their own hub read (`/api/fleet/hooks`), not folded into
 * `/api/fleet`, the same way `/rules` stands apart from it — a hook is a row
 * the reader manages on its own page, and this load only needs enough of it
 * to draw the fleet panel.
 */
export const load: PageLoad = async ({ fetch }) => {
  const [tools, fleet, hooks] = await Promise.all([
    fetch('/api/tools')
      .then(async (response) => {
        if (!response.ok) throw new Error(`the hub answered ${response.status}`);
        return (await response.json()) as ToolsSnapshot;
      })
      .catch((error: unknown) => error as Error),
    fetch('/api/fleet')
      .then(async (response) => {
        if (!response.ok) throw new Error(`the hub answered ${response.status}`);
        return (await response.json()) as FleetSnapshot;
      })
      .catch((error: unknown) => error as Error),
    fetch('/api/fleet/hooks')
      .then(async (response) => {
        if (!response.ok) throw new Error(`the hub answered ${response.status}`);
        return (await response.json()) as HooksPayload;
      })
      .catch((error: unknown) => error as Error),
  ]);

  return {
    catalog: tools instanceof Error ? [] : (tools.catalog ?? []),
    policies: tools instanceof Error ? [] : (tools.policies ?? []),
    toolsError: tools instanceof Error ? `Could not read the tool catalog — ${tools.message}.` : null,
    config: fleet instanceof Error ? EMPTY : { ...EMPTY, ...fleet.config },
    skills: fleet instanceof Error ? [] : (fleet.skills ?? []),
    agents: fleet instanceof Error ? [] : (fleet.agents ?? []),
    memory: fleet instanceof Error ? null : (fleet.memory ?? null),
    // Absent from a hub that predates the set, which is a fleet of one document.
    memoryDocs: fleet instanceof Error ? [] : (fleet.memoryDocs ?? []),
    fleetError: fleet instanceof Error ? `Could not read the fleet's setup — ${fleet.message}.` : null,
    hooks: hooks instanceof Error ? [] : (hooks.hooks ?? []),
    hooksError: hooks instanceof Error ? `Could not read the hooks — ${hooks.message}.` : null,
  };
};
