/**
 * What a machine's own frame data already says about whether it has converged
 * with the rest of the fleet — the board's answer to the Mac's 21-day silence
 * (see `.unlazy-liveness/gates/c2.md`): a build nobody can place, a sync stuck
 * on a decision nobody was asked to make, and a deploy clone that either
 * caught up or refused to. Every reader here is pure: given the frame data a
 * machine already carries, no reach into the network.
 */
import type { BuildInfo, DeployInfo, FleetSyncReport } from '@cockpit/core';

/** Whether a machine's own reported build is level with the hub's. */
export type BuildConvergence = 'unknown' | 'current' | 'behind';

/**
 * `unknown` whenever either side has nothing to compare — most importantly a
 * machine that never reported a commit at all, which must never read as
 * "current" just because it also never read as "behind". That is the exact
 * shape of the incident this leaf exists to catch: 21 days of `commit: None`
 * rendering as nothing, rather than as the absence it is.
 */
export function buildConvergence(build: BuildInfo | undefined, hubBuild: BuildInfo | undefined): BuildConvergence {
  if (!build?.commit || !hubBuild?.commit) return 'unknown';
  return build.commit === hubBuild.commit ? 'current' : 'behind';
}

/** One fleet-config row a machine could not apply — a first-class fact, not a footnote. */
export interface SyncFailure {
  readonly category: 'mcp' | 'marketplaces' | 'plugins' | 'skills' | 'memory' | 'memoryDocs' | 'memoryHook' | 'hooks';
  /** The entry's own key (a server/plugin/doc name); empty for the singular memory/memoryHook rows. */
  readonly key: string;
  readonly detail?: string;
}

const scanFailures = (
  category: Exclude<SyncFailure['category'], 'memory' | 'memoryHook'>,
  record: Record<string, { state: string; detail?: string }> | undefined
): SyncFailure[] =>
  Object.entries(record ?? {})
    .filter(([, item]) => item.state === 'failed')
    .map(([key, item]) => ({ category, key, detail: item.detail }));

/**
 * Every row of a machine's fleet-sync report that is stuck `failed` — the
 * hub's own conflict-detection working correctly and then parking, waiting on
 * a decision (adopt or overwrite) nobody was told to make. Rendered, never
 * resolved, here: the hub's `/api/fleet/memory/adopt` and `/push` routes stay
 * a click the operator makes, not one this reader makes for them.
 */
export function fleetSyncFailures(fleet: FleetSyncReport | undefined): SyncFailure[] {
  if (!fleet) return [];
  const failures: SyncFailure[] = [
    ...scanFailures('mcp', fleet.mcp),
    ...scanFailures('marketplaces', fleet.marketplaces),
    ...scanFailures('plugins', fleet.plugins),
    ...scanFailures('skills', fleet.skills),
    ...scanFailures('memoryDocs', fleet.memoryDocs),
    ...scanFailures('hooks', fleet.hooks),
  ];
  if (fleet.memory?.state === 'failed') failures.push({ category: 'memory', key: '', detail: fleet.memory.detail });
  if (fleet.memoryHook?.state === 'failed') {
    failures.push({ category: 'memoryHook', key: '', detail: fleet.memoryHook.detail });
  }
  return failures;
}

/**
 * Where the affordance for one category's failure already lives on `/tools`
 * (ids set on that page's own panels) — a badge links here rather than
 * growing a second adopt/overwrite control of its own.
 */
export const SYNC_FAILURE_ANCHOR: Record<SyncFailure['category'], string> = {
  mcp: 'fleet-mcp',
  marketplaces: 'fleet-skills',
  plugins: 'fleet-skills',
  skills: 'fleet-skills',
  memory: 'fleet-memory',
  memoryDocs: 'fleet-memory',
  memoryHook: 'fleet-memory',
  hooks: 'fleet-hooks',
};

/**
 * How long ago a machine's fleet report was taken, in ms — `undefined` for a
 * machine that has never synced at all. "11 days" is the number that would
 * have made the Mac's drift visible on day one; this is where it comes from.
 */
export function fleetSyncAgeMs(fleet: FleetSyncReport | undefined, now: number = Date.now()): number | undefined {
  return fleet ? Math.max(0, now - fleet.at) : undefined;
}

/**
 * Where a deployment clone stands against the branch it deploys from. The type
 * now comes from `@cockpit/core` — leaf Y2 carried C1's `DeployTick` onto the
 * wire (flattened to `{ kind, detail?, updated?, failure? }`, which is the
 * shape this file already read), so `AgentRow.deploy` is a real field and the
 * structural read below is tolerance rather than a workaround. It stays
 * tolerant: a daemon that predates the deployment channel, or one whose watcher
 * has never ticked, sends no field at all, and every reader here must answer
 * `undefined` for it exactly as `hubBuild` does on an older hub.
 */
export type { DeployKind } from '@cockpit/core';

export type MachineDeployInfo = DeployInfo;

/** A `diverged` clone refuses to deploy at all — the one state that must never read as merely stale. */
export const isDeployDiverged = (deploy: MachineDeployInfo | undefined): boolean => deploy?.kind === 'diverged';

/** Whether a deploy state is worth a badge at all — `unmarked` is an ordinary dev tree, not a fact to flag. */
export const isDeployNoteworthy = (deploy: MachineDeployInfo | undefined): boolean =>
  deploy !== undefined && deploy.kind !== 'unmarked' && deploy.kind !== 'current';

/** The kinds a machine may claim; anything else is not one, and badges nothing. */
const DEPLOY_KINDS: readonly string[] = ['unmarked', 'unreachable', 'current', 'behind', 'ahead', 'diverged'];

/**
 * Structural, and deliberately still so. `AgentRow.deploy` is typed now, but
 * this is the boundary where an *older or newer* machine's word arrives, and a
 * kind this build cannot render must read as nothing to report rather than as a
 * badge with no meaning. Callers may pass `machine.deploy` directly.
 */
export function deployInfoOf(deploy: unknown): MachineDeployInfo | undefined {
  if (!deploy || typeof deploy !== 'object' || !('kind' in deploy)) return undefined;
  if (!DEPLOY_KINDS.includes((deploy as { kind: unknown }).kind as string)) return undefined;
  return deploy as MachineDeployInfo;
}
