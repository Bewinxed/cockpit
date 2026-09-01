/**
 * Turning this machine's checkout into the current one (NEW.md §12): pull,
 * install, rebuild the dashboard, restart the services running out of it. The
 * fleet is edited while it runs, so this is how a machine that fell behind is
 * caught up — without a terminal on it, and without clobbering a dev machine
 * that is mid-edit.
 */
import type { UpdateReport } from '@whiffle/core';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { REPO_ROOT } from './build';
import {
  checkDeploy,
  DEPLOY_BRANCH,
  deployRoot,
  describeDeploy,
  startDeployPoller,
  type DeployPoller,
  type DeployState,
  type DeployWatcherOptions,
} from './deploy';
import { toolEnv } from './tools';

export interface UpdateOptions {
  /** Restart this daemon too, once everything else is up — and only when idle. */
  restartAgent?: boolean;
  /** Pull onto a dirty checkout, and restart the agent mid-turn. Both are refusals. */
  force?: boolean;
  /**
   * How many turns this daemon is carrying. Filled in by the supervisor, which
   * is the only thing that knows — never read off the wire.
   */
  busy?: number;
  /**
   * Which checkout to update. Defaults to the one this daemon is running out of
   * — which is the whole of what the manual `updateWhiffle` control ever meant.
   * The deployment poller passes the marked clone explicitly (C8), because
   * "wherever this file happens to sit" is not a thing to pull into.
   */
  root?: string;
  /**
   * Pull from `origin/<branch>` by name rather than from whatever upstream the
   * checkout has configured. Set by the deployment poller (C8/G3): the deploy
   * target is pinned to `origin/main`, and a fast-forward onto a branch nobody
   * named is how a clone quietly starts following something else.
   */
  branch?: string;
}

/** The end of a command's output: enough to name what happened, not a wall of it. */
const TAIL_LINES = 4;

const tail = (output: string): string => output.trim().split('\n').slice(-TAIL_LINES).join('\n');

/** Bounds, in the order the steps run. A step that will not end must not hold the rest. */
const GIT_TIMEOUT_MS = 60_000;
const INSTALL_TIMEOUT_MS = 5 * 60_000;
const BUILD_TIMEOUT_MS = 10 * 60_000;
const SERVICE_TIMEOUT_MS = 30_000;

export interface Ran {
  ok: boolean;
  code: number;
  /** The tail of what it said: what it printed, or what it failed with. */
  said: string;
}

/**
 * One step, in the checkout and with the daemon's PATH. Killed rather than left
 * running if it hangs: a pull against an unreachable remote would otherwise hold
 * the control open forever, and the hub would never hear how the update went.
 */
export const run = async (argv: string[], timeoutMs: number, cwd: string = REPO_ROOT): Promise<Ran> => {
  const child = Bun.spawn(argv, {
    cwd,
    env: toolEnv(),
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: timeoutMs,
  });
  const [stdout, stderr] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  const code = await child.exited;
  if (child.signalCode) {
    return { ok: false, code, said: `timed out after ${timeoutMs / 1000}s` };
  }
  const ok = code === 0;
  return { ok, code, said: ok ? tail(stdout) || tail(stderr) : tail(stderr) || tail(stdout) };
};

const git = (args: string[], cwd?: string): Promise<Ran> => run(['git', ...args], GIT_TIMEOUT_MS, cwd);

const failed = (step: string, ran: Ran): Error =>
  new Error(`${step} failed: ${ran.said || `exited ${ran.code}`}`);

/** The three services `whiffle service install` puts on a machine, in start order. */
type Service = 'hub' | 'dashboard' | 'agent';

/**
 * Where that install left them — the same two paths it writes, named here
 * because the daemon cannot depend on the CLI that owns them. The unit names
 * must stay identical to the installer's in `packages/cli`.
 */
const unitPath = (id: Service): string =>
  platform() === 'darwin'
    ? join(homedir(), 'Library', 'LaunchAgents', `dev.whiffle.${id}.plist`)
    : join(
        process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'),
        'systemd',
        'user',
        `whiffle-${id}.service`
      );

/** A service nobody installed here is not this machine's to restart. */
const isInstalled = (id: Service): Promise<boolean> => Bun.file(unitPath(id)).exists();

const restartCommand = (id: Service): string[] =>
  platform() === 'darwin'
    ? ['launchctl', 'kickstart', '-k', `gui/${process.getuid?.() ?? 0}/dev.whiffle.${id}`]
    : ['systemctl', '--user', 'restart', `whiffle-${id}.service`];

/** How long the reply gets to reach the hub before this daemon goes down with it. */
const RESTART_DELAY_S = 1;

/**
 * Neither the agent nor the hub can restart in front of whoever asked: the
 * report they owe is still on its way through the socket the restart kills.
 * Handed to a shell that waits a second first — every argument is a unit name
 * or a launchd label, so joining them is safe.
 */
const scheduleRestart = (id: 'agent' | 'hub'): void => {
  const command = `sleep ${RESTART_DELAY_S}; exec ${restartCommand(id).join(' ')}`;
  Bun.spawn(['sh', '-c', command], { stdio: ['ignore', 'ignore', 'ignore'] }).unref();
};

/** What the dashboard service serves, and the sign that this machine builds it. */
const dashboardBuild = (root: string): string => join(root, 'apps', 'dashboard', 'build', 'index.js');

/**
 * Whether a dashboard build is this machine's business. A worker running only
 * the daemon has no reason to spend minutes on a bundle nobody will serve, and
 * a machine that has one already is one that serves it.
 */
const buildsDashboard = async (root: string): Promise<boolean> =>
  (await Bun.file(dashboardBuild(root)).exists()) || (await isInstalled('dashboard'));

/**
 * How the checkout is moved forward, and the one line of this file that the
 * deployment channel's safety rests on (C8/G3).
 *
 * `--ff-only` always: a pull that cannot fast-forward fails loudly and leaves
 * the checkout exactly as it was. There is no merge, no rebase and no reset
 * anywhere in this module — a diverged deployment clone is a thing for a person
 * to look at, because the commits it has that origin does not may be the only
 * copy in existence.
 *
 * When the caller names a branch — the poller always does — the remote and ref
 * are given explicitly, so the fast-forward can only ever be onto
 * `origin/<branch>` rather than onto whatever upstream the checkout has picked
 * up since.
 */
export const pullArgs = (branch?: string): string[] =>
  branch ? ['pull', '--ff-only', 'origin', branch] : ['pull', '--ff-only'];

/**
 * Everything the `updateWhiffle` control does, in the order it has to happen.
 * Every field of the report is what actually took place: a step that was
 * asked for and did not run says why in `skipped` rather than reading as done.
 */
export const updateCheckout = async ({
  restartAgent,
  force,
  busy = 0,
  root = REPO_ROOT,
  branch,
}: UpdateOptions = {}): Promise<UpdateReport> => {
  const head = await git(['rev-parse', '--short', 'HEAD'], root);
  if (!head.ok) throw new Error(`${root} is not a git checkout, so there is nothing to pull`);

  const dirty = await git(['status', '--porcelain'], root);
  if (!dirty.ok) throw failed('git status', dirty);
  if (dirty.said && !force) {
    throw new Error('the checkout has uncommitted changes; refusing to pull');
  }

  const args = pullArgs(branch);
  const pulled = await git(args, root);
  if (!pulled.ok) throw failed(`git ${args.join(' ')}`, pulled);
  const moved = await git(['rev-parse', '--short', 'HEAD'], root);
  if (!moved.ok) throw failed('git rev-parse', moved);

  const report: UpdateReport = {
    from: head.said,
    to: moved.said,
    pulled: pulled.said,
    installed: false,
    built: false,
    restarted: [],
  };
  const skipped: string[] = [];

  // Nothing arrived, so nothing to install and nothing to build — but the
  // services are still restarted, because being asked to update a machine that
  // is already current is how a wedged one gets picked up off the floor.
  if (report.to !== report.from) {
    const installed = await run([process.execPath, 'install'], INSTALL_TIMEOUT_MS, root);
    if (!installed.ok) throw failed('bun install', installed);
    report.installed = true;

    if (await buildsDashboard(root)) {
      const built = await run(
        [process.execPath, 'run', '--filter', '@whiffle/dashboard', 'build'],
        BUILD_TIMEOUT_MS,
        root
      );
      if (!built.ok) throw failed('the dashboard build', built);
      report.built = true;
    } else {
      skipped.push('this machine serves no dashboard, so none was built');
    }
  }

  return restartStack(report, { restartAgent, force, busy }, skipped);
};

/**
 * Bring the services onto whatever code is now on disk.
 *
 * Split out from the git flow because the interesting part of an update is not
 * how the bytes arrived — it is the order the stack comes back in, and which
 * pieces are allowed to go down while somebody is waiting on the answer. That
 * reasoning is identical whether the new code came from a pull or from a
 * registry install, and it is the part that is easy to get subtly wrong.
 */
export const restartStack = async (
  report: UpdateReport,
  { restartAgent, force, busy = 0 }: { restartAgent?: boolean; force?: boolean; busy?: number },
  skipped: string[]
): Promise<UpdateReport> => {
  // The dashboard restarts in front of whoever asked; the hub cannot. An update
  // is asked for *through* the hub, so restarting it inline kills the socket the
  // reply is still travelling on and the caller reads a timeout for an update
  // that worked. It is scheduled for a second later, exactly as this daemon
  // schedules its own restart, and for exactly the same reason.
  if (await isInstalled('dashboard')) {
    const restarted = await run(restartCommand('dashboard'), SERVICE_TIMEOUT_MS);
    if (!restarted.ok) throw failed('restarting dashboard', restarted);
    report.restarted.push('dashboard');
  }
  if (await isInstalled('hub')) {
    report.restarted.push('hub');
    scheduleRestart('hub');
  }

  // Last, and only when asked: this daemon is hosting the sessions the restart
  // would cut in half. Reported as restarted rather than as scheduled — the
  // second it waits is only there so this report can leave first.
  if (restartAgent) {
    if (busy > 0 && !force) {
      skipped.push(`the agent is carrying ${busy} turn(s), so it was left running`);
    } else if (!(await isInstalled('agent'))) {
      skipped.push('the agent runs no service here, so nothing could restart it');
    } else {
      report.restarted.push('agent');
      scheduleRestart('agent');
    }
  }

  if (skipped.length > 0) report.skipped = skipped.join('; ');
  return report;
};

/**
 * The deployment trigger (C8): the poller decides *whether*, this decides
 * *what*. Kept here rather than in `deploy.ts` so that module stays a pure
 * observer — it can be read, and tested, without the ability to pull anything.
 *
 * `restartAgent: true` is the point of the whole channel. A daemon that pulled
 * a new commit and kept running the old one has not deployed; and post-cutover
 * the daemon's restart is free by construction, because the harness children
 * live in sessiond's cgroup and not in the agent's (PLAN.md C7/D4).
 */
export const deployUpdate = (state: DeployState): Promise<UpdateReport> => {
  if (state.kind !== 'behind') {
    throw new Error(`refusing to update a checkout that is ${state.kind}: ${describeDeploy(state)}`);
  }
  return updateCheckout({ root: state.root, branch: DEPLOY_BRANCH, restartAgent: true });
};

export type DeployWatchOptions = Partial<Omit<DeployWatcherOptions, 'update'>> & {
  readonly intervalMs?: number;
};

/**
 * What the daemon's entry point starts: poll the deployment clone, and run the
 * update flow when — and only when — a marked clone is strictly behind
 * `origin/main`. Started unconditionally: on a machine that was never deployed
 * to, the very first thing every tick does is fail the marker check, so the
 * poller is a no-op in a dev tree by construction rather than by configuration.
 */
export const watchDeployment = (options: DeployWatchOptions = {}): DeployPoller =>
  startDeployPoller({ ...options, update: deployUpdate });

/**
 * Where this machine stands against the deployment branch, asked once. What
 * `whiffle deploy status` prints, and what the daemon can answer with.
 */
export const deploymentState = (root: string = deployRoot()): Promise<DeployState> =>
  checkDeploy({ root });
