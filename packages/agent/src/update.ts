/**
 * Turning this machine's checkout into the current one (NEW.md §12): pull,
 * install, rebuild the dashboard, restart the services running out of it. The
 * fleet is edited while it runs, so this is how a machine that fell behind is
 * caught up — without a terminal on it, and without clobbering a dev machine
 * that is mid-edit.
 */
import type { UpdateReport } from '@cockpit/core';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { REPO_ROOT } from './build';
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
}

/** The end of a command's output: enough to name what happened, not a wall of it. */
const TAIL_LINES = 4;

const tail = (output: string): string => output.trim().split('\n').slice(-TAIL_LINES).join('\n');

/** Bounds, in the order the steps run. A step that will not end must not hold the rest. */
const GIT_TIMEOUT_MS = 60_000;
const INSTALL_TIMEOUT_MS = 5 * 60_000;
const BUILD_TIMEOUT_MS = 10 * 60_000;
const SERVICE_TIMEOUT_MS = 30_000;

interface Ran {
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
const run = async (argv: string[], timeoutMs: number): Promise<Ran> => {
  const child = Bun.spawn(argv, {
    cwd: REPO_ROOT,
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

const git = (args: string[]): Promise<Ran> => run(['git', ...args], GIT_TIMEOUT_MS);

const failed = (step: string, ran: Ran): Error =>
  new Error(`${step} failed: ${ran.said || `exited ${ran.code}`}`);

/** The three services `cockpit service install` puts on a machine, in start order. */
type Service = 'hub' | 'dashboard' | 'agent';

/**
 * Where that install left them — the same two paths it writes, named here
 * because the daemon cannot depend on the CLI that owns them.
 */
const unitPath = (id: Service): string =>
  platform() === 'darwin'
    ? join(homedir(), 'Library', 'LaunchAgents', `dev.cockpit.${id}.plist`)
    : join(
        process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'),
        'systemd',
        'user',
        `cockpit-${id}.service`
      );

/** A service nobody installed here is not this machine's to restart. */
const isInstalled = (id: Service): Promise<boolean> => Bun.file(unitPath(id)).exists();

const restartCommand = (id: Service): string[] =>
  platform() === 'darwin'
    ? ['launchctl', 'kickstart', '-k', `gui/${process.getuid?.() ?? 0}/dev.cockpit.${id}`]
    : ['systemctl', '--user', 'restart', `cockpit-${id}.service`];

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
const DASHBOARD_BUILD = join(REPO_ROOT, 'apps', 'dashboard', 'build', 'index.js');

/**
 * Whether a dashboard build is this machine's business. A worker running only
 * the daemon has no reason to spend minutes on a bundle nobody will serve, and
 * a machine that has one already is one that serves it.
 */
const buildsDashboard = async (): Promise<boolean> =>
  (await Bun.file(DASHBOARD_BUILD).exists()) || (await isInstalled('dashboard'));

/**
 * Everything the `updateCockpit` control does, in the order it has to happen.
 * Every field of the report is what actually took place: a step that was
 * asked for and did not run says why in `skipped` rather than reading as done.
 */
export const updateCheckout = async ({
  restartAgent,
  force,
  busy = 0,
}: UpdateOptions = {}): Promise<UpdateReport> => {
  const head = await git(['rev-parse', '--short', 'HEAD']);
  if (!head.ok) throw new Error(`${REPO_ROOT} is not a git checkout, so there is nothing to pull`);

  const dirty = await git(['status', '--porcelain']);
  if (!dirty.ok) throw failed('git status', dirty);
  if (dirty.said && !force) {
    throw new Error('the checkout has uncommitted changes; refusing to pull');
  }

  const pulled = await git(['pull', '--ff-only']);
  if (!pulled.ok) throw failed('git pull --ff-only', pulled);
  const moved = await git(['rev-parse', '--short', 'HEAD']);
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
    const installed = await run([process.execPath, 'install'], INSTALL_TIMEOUT_MS);
    if (!installed.ok) throw failed('bun install', installed);
    report.installed = true;

    if (await buildsDashboard()) {
      const built = await run(
        [process.execPath, 'run', '--filter', '@cockpit/dashboard', 'build'],
        BUILD_TIMEOUT_MS
      );
      if (!built.ok) throw failed('the dashboard build', built);
      report.built = true;
    } else {
      skipped.push('this machine serves no dashboard, so none was built');
    }
  }

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
