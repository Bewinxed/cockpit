import type { FleetConfig } from '@cockpit/core';
import type { FleetSnapshot } from '$lib/cockpit/fleet';
import type { ToolsSnapshot } from '$lib/cockpit/tools';
import type { PageLoad } from './$types';

const EMPTY: FleetConfig = { mcp: [], marketplaces: [], plugins: [] };

/**
 * The catalog, the policy table and the fleet's desired state are all the
 * hub's, so they are read through the proxy rather than the app socket — the
 * page renders on the server, and a hub that is down leaves a sentence to read
 * instead of a blank page. Both reads run once for all three tabs: switching
 * tabs is a search param, which this load never touches.
 */
export const load: PageLoad = async ({ fetch }) => {
  const [tools, fleet] = await Promise.all([
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
  ]);

  return {
    catalog: tools instanceof Error ? [] : (tools.catalog ?? []),
    policies: tools instanceof Error ? [] : (tools.policies ?? []),
    toolsError: tools instanceof Error ? `Could not read the tool catalog — ${tools.message}.` : null,
    config: fleet instanceof Error ? EMPTY : { ...EMPTY, ...fleet.config },
    skills: fleet instanceof Error ? [] : (fleet.skills ?? []),
    memory: fleet instanceof Error ? null : (fleet.memory ?? null),
    fleetError: fleet instanceof Error ? `Could not read the fleet's setup — ${fleet.message}.` : null,
  };
};
