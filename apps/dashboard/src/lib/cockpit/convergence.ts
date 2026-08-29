/**
 * What a machine's own frame data already says about whether it has converged
 * with the rest of the fleet — the board's answer to the Mac's 21-day silence
 * (see `.unlazy-liveness/gates/c2.md`): a build nobody can place, a sync stuck
 * on a decision nobody was asked to make, and a deploy clone that either
 * caught up or refused to. Every reader here is pure: given the frame data a
 * machine already carries, no reach into the network.
 */
import type { BuildInfo, FleetSyncReport } from '@cockpit/core';

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
 * Where a deployment clone stands against the branch it deploys from —
 * mirrors `DeployState['kind']` in packages/agent/src/deploy.ts (leaf C1).
 * Read structurally rather than imported: C1's `DeployTick` travels through an
 * injectable `report` callback, not the wire, so nothing on this side of the
 * hub can import that module's types without pulling in its runtime — C1's
 * own deviation 4 leaves the wiring from that callback onto the hub frame to
 * whichever leaf lands it. Until it does, an `AgentRow` simply carries no
 * `deploy` field and every reader below returns `undefined`, exactly like
 * `hubBuild` on a hub that predates C2.
 */
export type DeployKind = 'unmarked' | 'unreachable' | 'current' | 'behind' | 'ahead' | 'diverged';

export interface MachineDeployInfo {
  readonly kind: DeployKind;
  /** One sentence, the same shape `describeDeploy` in deploy.ts produces. */
  readonly detail?: string;
  readonly updated?: boolean;
  readonly failure?: string;
}

/** A `diverged` clone refuses to deploy at all — the one state that must never read as merely stale. */
export const isDeployDiverged = (deploy: MachineDeployInfo | undefined): boolean => deploy?.kind === 'diverged';

/** Whether a deploy state is worth a badge at all — `unmarked` is an ordinary dev tree, not a fact to flag. */
export const isDeployNoteworthy = (deploy: MachineDeployInfo | undefined): boolean =>
  deploy !== undefined && deploy.kind !== 'unmarked' && deploy.kind !== 'current';

/**
 * Structural, not a cast onto `AgentRow` itself: the field does not exist on
 * the core type yet (see the module doc above), so a `Machine` that never
 * carries it must read as "nothing to report" rather than throw. Callers pass
 * `(machine as unknown as { deploy?: unknown }).deploy` — the one cast this
 * leaf allows, isolated to this one call site.
 */
export function deployInfoOf(deploy: unknown): MachineDeployInfo | undefined {
  if (!deploy || typeof deploy !== 'object' || !('kind' in deploy)) return undefined;
  return deploy as MachineDeployInfo;
}
