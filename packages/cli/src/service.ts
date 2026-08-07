import type { AgentRow } from '@cockpit/core';
import { COCKPIT_ENV, COCKPIT_HUB_PORT } from '@cockpit/core';
import { existsSync, readFileSync } from 'node:fs';
import { chmod } from 'node:fs/promises';
import { homedir, platform } from 'node:os';
import { dirname, join, resolve } from 'node:path';

/**
 * The whole stack, as three services this machine can run for you, in the order
 * they should come up. A machine runs whichever of them it is for: a worker only
 * wants `agent`, and the box you point a browser at wants all three.
 */
export type ServiceId = 'hub' | 'dashboard' | 'agent';

export const SERVICE_IDS: readonly ServiceId[] = ['hub', 'dashboard', 'agent'];

export const isServiceId = (value: string): value is ServiceId =>
  SERVICE_IDS.includes(value as ServiceId);

export type ServiceAction = 'install' | 'uninstall' | 'restart' | 'status' | 'logs';

export const SERVICE_ACTIONS: readonly ServiceAction[] = [
  'install',
  'uninstall',
  'restart',
  'status',
  'logs',
];

export const isServiceAction = (value: string | undefined): value is ServiceAction =>
  SERVICE_ACTIONS.includes(value as ServiceAction);

/**
 * Which flavour of the stack a machine is running: the built artefacts, or the
 * checkout as you are editing it. Only the hub and the dashboard have a dev
 * flavour — see {@link DEV}.
 */
export type ServiceMode = 'prod' | 'dev';

/**
 * Written into a dev unit and read back out of it by `status`, which is the only
 * record of how a service was installed. Never set in prod, so a unit without it
 * is a prod install.
 */
const MODE_ENV = 'COCKPIT_SERVICE_MODE';

/** Thrown for anything the caller can fix — a wrong platform, a failed launchctl. */
export class ServiceError extends Error {}

/** systemd wants a name, launchd wants a reverse-DNS label; they are one service. */
const unitName = (id: ServiceId): string => `cockpit-${id}.service`;
const label = (id: ServiceId): string => `dev.cockpit.${id}`;

const SYSTEMD_DIR = join(
  process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'),
  'systemd',
  'user'
);

const systemdPath = (id: ServiceId): string => join(SYSTEMD_DIR, unitName(id));
const launchAgentPath = (id: ServiceId): string =>
  join(homedir(), 'Library', 'LaunchAgents', `${label(id)}.plist`);
const launchAgentLog = (id: ServiceId): string =>
  join(homedir(), 'Library', 'Logs', `cockpit-${id}.log`);

/**
 * The checkout this CLI is running from. The hub and the dashboard are served
 * out of it, so installing from a branch installs that branch — the same thing
 * the daemon's command does by naming `Bun.main`.
 */
const repoRoot = (): string => {
  let dir = dirname(Bun.main);
  while (dir !== dirname(dir)) {
    const manifest = join(dir, 'package.json');
    if (existsSync(manifest)) {
      const { workspaces } = JSON.parse(readFileSync(manifest, 'utf8')) as { workspaces?: unknown };
      if (workspaces) return dir;
    }
    dir = dirname(dir);
  }
  // Nothing on the way up called itself the workspace root, so fall back to
  // where this file sits inside one: packages/cli/src/cli.ts.
  return resolve(dirname(Bun.main), '..', '..', '..');
};

const ROOT = repoRoot();
const HUB_ENTRY = join(ROOT, 'packages', 'hub', 'src', 'index.ts');
const DASHBOARD_DIR = join(ROOT, 'apps', 'dashboard');
const DASHBOARD_ENTRY = join(DASHBOARD_DIR, 'build', 'index.js');
/**
 * The dashboard's `dev` script is `vite dev`, and this is that vite. Named
 * outright because `ExecStart=` is not a shell: it cannot resolve a `.bin` entry
 * off PATH, and going through `bun run --filter` would put the port back under
 * vite.config.ts, where `status` cannot follow it.
 */
const DASHBOARD_VITE = join(DASHBOARD_DIR, 'node_modules', 'vite', 'bin', 'vite.js');

/**
 * Where the dashboard listens. Read from the installing shell so a second
 * machine can differ, with the defaults this one's browser expects.
 */
const DASHBOARD_PORT = process.env.PORT ?? '4030';
const DASHBOARD_HOST = process.env.HOST ?? '127.0.0.1';

/**
 * The PATH the installing shell had. A launchd job otherwise inherits a nearly
 * empty one, and the daemon shells out to `git`, `gh` and `tailscale` — found
 * the hard way on a Mac where `node` was missing from the service's PATH and
 * the Claude Code shim would not start.
 */
const servicePath = (): string => {
  const inherited = (process.env.PATH ?? '').split(':').filter(Boolean);
  // Installing over SSH inherits a thin PATH with no Homebrew, so a service
  // installed remotely would lose git, gh and node. Union the usual homes with
  // whatever the installing shell had, keeping the shell's order first.
  const usual = [
    `${homedir()}/.bun/bin`,
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
  ];
  return [...new Set([...inherited, ...usual])].join(':');
};

/** How long a liveness probe is worth waiting for before it has said enough. */
const PROBE_TIMEOUT_MS = 2000;

const hubOrigin = (): string =>
  `http://127.0.0.1:${process.env[COCKPIT_ENV.hubPort] ?? COCKPIT_HUB_PORT}`;

/** A probe answers or it does not; nothing it finds is worth throwing over. */
const probeJson = async <T>(url: string): Promise<T | undefined> => {
  const answer = await fetch(url, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) }).catch(
    () => undefined
  );
  if (!answer?.ok) return undefined;
  return (await answer.json().catch(() => undefined)) as T | undefined;
};

const probeHub = async (): Promise<string> => {
  const health = await probeJson<{ version: string }>(`${hubOrigin()}/health`);
  return health ? `${hubOrigin()} answers /health (hub ${health.version})` : `no answer from ${hubOrigin()}/health`;
};

const probeDashboard = async (): Promise<string> => {
  const url = `http://${DASHBOARD_HOST}:${DASHBOARD_PORT}/`;
  const answer = await fetch(url, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) }).catch(
    () => undefined
  );
  return answer ? `${url} answers (HTTP ${answer.status})` : `no answer from ${url}`;
};

const probeAgent = async (): Promise<string | undefined> => {
  const agents = await probeJson<AgentRow[]>(`${hubOrigin()}/api/agents`);
  // A worker machine's hub is somewhere else on the tailnet, so no hub here is
  // not a verdict on the daemon — it is a question this machine cannot answer.
  if (!agents) return undefined;
  // Imported here rather than at the top so the other two probes, and every
  // other verb, never pay for the agent SDK.
  const { machineId } = await import('@cockpit/agent');
  const id = await machineId();
  const self = agents.find((agent) => agent.machineId === id);
  return self
    ? `registered with ${hubOrigin()} as ${self.hostname} (${self.status})`
    : `not registered with ${hubOrigin()}`;
};

interface ServiceSpec {
  readonly id: ServiceId;
  readonly mode: ServiceMode;
  /** systemd `Description=`. */
  readonly description: string;
  readonly command: readonly string[];
  /** On top of PATH, which every service gets. */
  readonly environment: Readonly<Record<string, string>>;
  readonly workingDirectory: string;
  /** systemd ordering only — launchd has none, see {@link plist}. */
  readonly after: readonly string[];
  readonly wants: readonly string[];
  /**
   * Whether a clean exit is still a fault. It is for a server, which has no
   * reason to stop; it is not for the daemon, which exits 0 when it is
   * deliberately drained and must then stay down.
   */
  readonly restartOnSuccess: boolean;
  readonly restartSec: number;
  /**
   * Asked before anything is written. A returned line is a warning worth
   * printing; a throw refuses the install outright.
   */
  readonly check?: () => string | undefined;
  /** Printed after a LaunchAgent install, for the one service that has more to say. */
  readonly launchAgentNote?: readonly string[];
  /** Whether the service is really up, which the init system does not know. */
  readonly probe: () => Promise<string | undefined>;
}

const SERVICES: Record<ServiceId, ServiceSpec> = {
  hub: {
    id: 'hub',
    mode: 'prod',
    description: 'Cockpit hub',
    // `bun run --filter '@cockpit/hub' start` needs a shell for the quoting and
    // a cwd for the workspace lookup; the entry point needs neither and boots
    // the same process.
    command: [process.execPath, HUB_ENTRY],
    environment: {
      // The hub's DB_PATH defaults to `./cockpit.db` — relative to wherever it
      // was started. A unit that leaves this unset opens a second, empty
      // database in whatever directory the init system chose, and the fleet
      // comes up blank with nothing to say why.
      COCKPIT_DB_PATH: join(ROOT, 'cockpit.db'),
    },
    workingDirectory: ROOT,
    after: ['network-online.target'],
    wants: [],
    restartOnSuccess: true,
    restartSec: 2,
    check: () => {
      if (!existsSync(HUB_ENTRY)) {
        throw new ServiceError(`no hub at ${HUB_ENTRY} — is ${ROOT} a cockpit checkout?`);
      }
      return undefined;
    },
    probe: probeHub,
  },

  dashboard: {
    id: 'dashboard',
    mode: 'prod',
    description: 'Cockpit dashboard',
    command: [process.execPath, DASHBOARD_ENTRY],
    environment: { PORT: DASHBOARD_PORT, HOST: DASHBOARD_HOST },
    workingDirectory: ROOT,
    after: [unitName('hub')],
    wants: [unitName('hub')],
    restartOnSuccess: true,
    restartSec: 2,
    // A missing build is a build away, so the unit goes in either way and says
    // what is left to do — refusing here would only mean installing twice.
    check: () =>
      existsSync(DASHBOARD_ENTRY)
        ? undefined
        : `no dashboard build at ${DASHBOARD_ENTRY}, so its service will restart until there is one.\nMake it with \`bun run --filter '@cockpit/dashboard' build\`.`,
    probe: probeDashboard,
  },

  agent: {
    id: 'agent',
    mode: 'prod',
    description: 'Cockpit agent',
    /**
     * This same CLI, `up`, under the same Bun that is running right now.
     * Installing from a checkout therefore installs that checkout, which is
     * what someone testing a branch means by it.
     */
    command: [process.execPath, Bun.main, 'up'],
    environment: {},
    workingDirectory: homedir(),
    after: [unitName('hub')],
    wants: [unitName('hub')],
    restartOnSuccess: false,
    restartSec: 5,
    launchAgentNote: [
      'A LaunchAgent runs inside your desktop session, so it can read the login',
      'keychain Claude Code keeps its credentials in. No token needed.',
    ],
    probe: probeAgent,
  },
};

/**
 * What `--dev` changes, per service. Only what is here is watched, and the
 * daemon is deliberately absent: it hosts the sessions, so a restart lands in
 * the middle of somebody's turn and loses it. Restarting the hub costs nothing
 * by comparison — the sessions live in the daemons, which reconnect with
 * backoff, and everything the hub knows is already on disk. The dashboard is in
 * here only because the built bundle cannot reload itself; vite's dev server
 * picks up an edited source file without any restart at all.
 */
const DEV: Partial<Record<ServiceId, Partial<ServiceSpec>>> = {
  hub: {
    command: [process.execPath, '--watch', HUB_ENTRY],
  },
  dashboard: {
    // vite reads its config out of the working directory, which is the app, not
    // the workspace root; `--port`/`--host` then override what that config says
    // so the dev flavour answers where the prod one did.
    command: [process.execPath, DASHBOARD_VITE, 'dev', '--port', DASHBOARD_PORT, '--host', DASHBOARD_HOST],
    workingDirectory: DASHBOARD_DIR,
    check: () => {
      if (!existsSync(DASHBOARD_VITE)) {
        throw new ServiceError(`no vite at ${DASHBOARD_VITE} — run \`bun install\` in ${ROOT} first.`);
      }
      return undefined;
    },
  },
};

/** Whether `--dev` makes this service watch its own source. */
const watches = (id: ServiceId): boolean => id in DEV;

const specFor = (id: ServiceId, mode: ServiceMode): ServiceSpec => {
  const base = SERVICES[id];
  if (mode === 'prod') return base;
  // The daemon has no dev flavour to merge, and still carries the mode: it was
  // installed by the same command, and `status` should say so.
  return { ...base, ...DEV[id], mode, description: `${base.description} (dev)` };
};

const environment = (spec: ServiceSpec): [string, string][] =>
  Object.entries({
    PATH: servicePath(),
    ...spec.environment,
    ...(spec.mode === 'dev' ? { [MODE_ENV]: spec.mode } : {}),
  });

const xml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * launchd has no ordering: each service is bootstrapped on its own, and the hub
 * may well not be up when the dashboard or the daemon starts. That costs
 * nothing, because every service already tolerates the others being absent —
 * the daemon reconnects with backoff, the dashboard proxies on demand — which
 * is also why systemd gets `Wants=` rather than `Requires=`.
 */
const plist = (spec: ServiceSpec): string => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xml(label(spec.id))}</string>
  <key>ProgramArguments</key>
  <array>
${spec.command.map((argument) => `    <string>${xml(argument)}</string>`).join('\n')}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
${
  spec.restartOnSuccess
    ? '  <true/>'
    : `  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>`
}
  <key>EnvironmentVariables</key>
  <dict>
${environment(spec)
  .map(([key, value]) => `    <key>${xml(key)}</key>\n    <string>${xml(value)}</string>`)
  .join('\n')}
  </dict>
  <key>WorkingDirectory</key>
  <string>${xml(spec.workingDirectory)}</string>
  <key>StandardOutPath</key>
  <string>${xml(launchAgentLog(spec.id))}</string>
  <key>StandardErrorPath</key>
  <string>${xml(launchAgentLog(spec.id))}</string>
</dict>
</plist>
`;

/**
 * `StartLimitIntervalSec=0` because the default gives up after five restarts in
 * ten seconds and leaves the unit wedged until someone runs `reset-failed` — a
 * crash loop should stay a crash loop, visible and still trying, rather than
 * quietly become a stopped service.
 */
const unit = (spec: ServiceSpec): string => `[Unit]
Description=${spec.description}
${[...spec.wants.map((target) => `Wants=${target}`), ...spec.after.map((target) => `After=${target}`)].join('\n')}
StartLimitIntervalSec=0

[Service]
ExecStart=${spec.command.join(' ')}
WorkingDirectory=${spec.workingDirectory}
${environment(spec)
  .map(([key, value]) => `Environment=${key}=${value}`)
  .join('\n')}
Restart=${spec.restartOnSuccess ? 'always' : 'on-failure'}
RestartSec=${spec.restartSec}

[Install]
WantedBy=default.target
`;

const run = async (argv: string[]) => Bun.$`${argv}`.quiet().nothrow();

const failed = (what: string, result: Awaited<ReturnType<typeof run>>): ServiceError =>
  new ServiceError(`${what} failed: ${result.stderr.toString().trim() || `exit ${result.exitCode}`}`);

const guiDomain = (): string => `gui/${process.getuid?.() ?? 0}`;

/**
 * `bootstrap` and `kickstart` replaced `load` in the launchd rewrite, and `load`
 * is still there as a deprecated alias on the systems that have both — so which
 * one exists is asked rather than assumed from the OS version.
 */
const launchctlHas = async (subcommand: string): Promise<boolean> => {
  // `launchctl help` writes its subcommand list to stderr on some releases.
  const help = await run(['launchctl', 'help']);
  return `${help.stdout.toString()}${help.stderr.toString()}`.includes(subcommand);
};

const hasBootstrap = (): Promise<boolean> => launchctlHas('bootstrap');

/**
 * A service definition someone else can rewrite is a service someone else can
 * run as you, so it is written owner-only — and set on the way out, because a
 * file that already existed keeps the mode it had.
 */
const writeUnit = async (path: string, contents: string): Promise<void> => {
  await Bun.write(path, contents);
  await chmod(path, 0o600);
};

/**
 * Puts whatever the plist now says in front of launchd, replacing whatever it
 * was running under that label — which is both what an install over a running
 * service means and what a restart means on a launchctl too old for `kickstart`.
 */
const loadLaunchAgent = async (
  spec: ServiceSpec,
  bootstrap: boolean,
  note: (line: string) => void
): Promise<void> => {
  const path = launchAgentPath(spec.id);
  // launchd refuses to bootstrap a label it already knows.
  await run(['launchctl', 'bootout', `${guiDomain()}/${label(spec.id)}`]);

  if (bootstrap) {
    const bootstrapped = await run(['launchctl', 'bootstrap', guiDomain(), path]);
    if (bootstrapped.exitCode !== 0) throw failed('launchctl bootstrap', bootstrapped);
    note(`bootstrapped into ${guiDomain()}`);
  } else {
    const loaded = await run(['launchctl', 'load', '-w', path]);
    if (loaded.exitCode !== 0) throw failed('launchctl load', loaded);
    note('loaded (legacy launchctl)');
  }
};

const installLaunchAgents = async (
  specs: ServiceSpec[],
  note: (line: string) => void
): Promise<void> => {
  const bootstrap = await hasBootstrap();

  for (const [index, spec] of specs.entries()) {
    if (index > 0) note('');
    const path = launchAgentPath(spec.id);
    await writeUnit(path, plist(spec));
    note(`wrote ${path}`);

    await loadLaunchAgent(spec, bootstrap, note);

    note(`logs ${launchAgentLog(spec.id)}`);
    if (spec.launchAgentNote) {
      note('');
      for (const line of spec.launchAgentNote) note(line);
    }
  }
};

const uninstallLaunchAgents = async (
  specs: ServiceSpec[],
  note: (line: string) => void
): Promise<void> => {
  const bootstrap = await hasBootstrap();
  for (const spec of specs) {
    const path = launchAgentPath(spec.id);
    if (bootstrap) await run(['launchctl', 'bootout', `${guiDomain()}/${label(spec.id)}`]);
    else await run(['launchctl', 'unload', '-w', path]);
    await Bun.file(path).delete().catch(() => {});
    note(`removed ${path}`);
  }
};

/**
 * Without lingering, systemd tears the user manager down at logout and takes the
 * services with it — the same "it dies when I disconnect" they are meant to
 * fix. Only worth saying when it is actually off.
 */
const lingerHint = async (note: (line: string) => void): Promise<void> => {
  const user = process.env.USER ?? '';
  const shown = await run(['loginctl', 'show-user', user, '--property=Linger']);
  if (shown.exitCode !== 0 || shown.stdout.toString().includes('Linger=yes')) return;
  note('');
  note(`This user has no persistent session, so the services stop at logout. Fix with:`);
  note(`  sudo loginctl enable-linger ${user}`);
};

const installSystemdUnits = async (
  specs: ServiceSpec[],
  note: (line: string) => void
): Promise<void> => {
  for (const spec of specs) {
    await writeUnit(systemdPath(spec.id), unit(spec));
    note(`wrote ${systemdPath(spec.id)}`);
  }

  // Once for the set: systemd re-reads every file it was handed, and enabling a
  // unit it has not read yet is what makes an install look like it did nothing.
  const reloaded = await run(['systemctl', '--user', 'daemon-reload']);
  if (reloaded.exitCode !== 0) throw failed('systemctl --user daemon-reload', reloaded);

  for (const spec of specs) {
    const enabled = await run(['systemctl', '--user', 'enable', '--now', unitName(spec.id)]);
    if (enabled.exitCode !== 0) throw failed('systemctl --user enable --now', enabled);
    note(`enabled and started ${unitName(spec.id)}`);
    note(`logs journalctl --user -u ${unitName(spec.id)} -f`);
  }

  await lingerHint(note);
};

const uninstallSystemdUnits = async (
  specs: ServiceSpec[],
  note: (line: string) => void
): Promise<void> => {
  for (const spec of specs) {
    await run(['systemctl', '--user', 'disable', '--now', unitName(spec.id)]);
    await Bun.file(systemdPath(spec.id)).delete().catch(() => {});
    note(`removed ${systemdPath(spec.id)}`);
  }
  await run(['systemctl', '--user', 'daemon-reload']);
};

/** What the hub reports for one machine's daemon. */
interface BusyReport {
  /** Sessions on this machine with a turn in flight. */
  busy: number;
  instances: string[];
}

/**
 * How many of this machine's sessions are mid-turn, or `unknown` when the hub
 * could not be asked at all — it is down, or it is old enough not to have the
 * route. A hub that cannot answer is never read as an idle one.
 */
const agentBusy = async (): Promise<number | 'unknown'> => {
  // Imported here rather than at the top so no other verb pays for the agent SDK.
  const { machineId } = await import('@cockpit/agent');
  const report = await probeJson<BusyReport>(
    `${hubOrigin()}/api/agents/${await machineId()}/busy`
  );
  return typeof report?.busy === 'number' ? report.busy : 'unknown';
};

export interface RestartRequest {
  /** What {@link agentBusy} found, or `0` for a service that hosts no sessions. */
  readonly busy: number | 'unknown';
  readonly whenIdle: boolean;
  readonly force: boolean;
}

export type RestartDecision =
  | { readonly kind: 'go' }
  | { readonly kind: 'wait'; readonly busy: number }
  | { readonly kind: 'refuse'; readonly reason: string };

const sessions = (count: number): string => `${count} session${count === 1 ? '' : 's'}`;

/**
 * Whether restarting the daemon now is allowed to interrupt what it is doing.
 * The daemon is the one service that hosts the user's work, so the only way to
 * restart it while it is busy — or while nobody can say whether it is — is to
 * ask for that outright.
 */
export const restartDecision = ({ busy, whenIdle, force }: RestartRequest): RestartDecision => {
  if (force) return { kind: 'go' };
  if (busy === 'unknown') {
    return {
      kind: 'refuse',
      reason:
        'could not ask the hub whether this machine is busy, and restarting the agent blind ends whatever turn is in flight. Restart anyway with --force.',
    };
  }
  if (busy === 0) return { kind: 'go' };
  if (whenIdle) return { kind: 'wait', busy };
  return {
    kind: 'refuse',
    reason: `the agent on this machine is mid-turn in ${sessions(busy)}, and a restart ends that work. Wait for it to finish with --when-idle, or restart anyway with --force.`,
  };
};

/** How often `--when-idle` asks again, and how long it keeps asking. */
const IDLE_POLL_MS = 2000;
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * One line that rewrites itself, so a five-minute wait leaves one line behind
 * rather than 150. There is nothing to rewrite without a terminal, so there each
 * count is its own line.
 */
const waiting = (line: string): void => {
  if (process.stdout.isTTY) process.stdout.write(`\r\u001b[2K${line}`);
  else console.log(line);
};

const waitForIdle = async (busy: number, note: (line: string) => void): Promise<void> => {
  const deadline = Date.now() + IDLE_TIMEOUT_MS;
  let outstanding = busy;
  try {
    for (;;) {
      waiting(`waiting for ${sessions(outstanding)} to finish…`);
      await Bun.sleep(IDLE_POLL_MS);
      const now = await agentBusy();
      // The hub going away mid-wait is the same not-knowing as never reaching it.
      if (now === 'unknown') {
        throw new ServiceError(
          'the hub stopped answering while waiting, so the agent was left alone. Restart anyway with --force.'
        );
      }
      if (now === 0) break;
      outstanding = now;
      if (Date.now() > deadline) {
        throw new ServiceError(
          `${sessions(outstanding)} still mid-turn after ${IDLE_TIMEOUT_MS / 60_000} minutes, so the agent was left alone. Try again, or restart anyway with --force.`
        );
      }
    }
  } finally {
    // Whatever happened, the line that was rewriting itself is finished with.
    if (process.stdout.isTTY) process.stdout.write('\n');
  }
  note('every session finished');
};

/**
 * Asked before the daemon is restarted, and only the daemon: the hub and the
 * dashboard hold nothing that a restart can interrupt.
 */
const clearToRestart = async (
  spec: ServiceSpec,
  { whenIdle, force }: Pick<RestartRequest, 'whenIdle' | 'force'>,
  note: (line: string) => void
): Promise<void> => {
  if (spec.id !== 'agent') return;
  const busy = await agentBusy();
  const decision = restartDecision({ busy, whenIdle, force });
  switch (decision.kind) {
    case 'go':
      return;
    case 'refuse':
      throw new ServiceError(decision.reason);
    case 'wait':
      return waitForIdle(decision.busy, note);
  }
};

const restartLaunchAgent = async (
  spec: ServiceSpec,
  note: (line: string) => void
): Promise<void> => {
  if (!existsSync(launchAgentPath(spec.id))) {
    throw new ServiceError(`${spec.id} is not installed — \`cockpit service install ${spec.id}\` first.`);
  }
  if (await launchctlHas('kickstart')) {
    const kicked = await run(['launchctl', 'kickstart', '-k', `${guiDomain()}/${label(spec.id)}`]);
    if (kicked.exitCode !== 0) throw failed('launchctl kickstart -k', kicked);
  } else {
    await loadLaunchAgent(spec, await hasBootstrap(), note);
  }
  note(`restarted ${label(spec.id)}`);
};

const restartSystemdUnit = async (
  spec: ServiceSpec,
  note: (line: string) => void
): Promise<void> => {
  if (!existsSync(systemdPath(spec.id))) {
    throw new ServiceError(`${spec.id} is not installed — \`cockpit service install ${spec.id}\` first.`);
  }
  const restarted = await run(['systemctl', '--user', 'restart', unitName(spec.id)]);
  if (restarted.exitCode !== 0) throw failed('systemctl --user restart', restarted);
  note(`restarted ${unitName(spec.id)}`);
};

/**
 * The mode a service was installed in, read back from the unit it was installed
 * as — nothing else remembers it.
 */
const installedMode = async (path: string): Promise<ServiceMode | undefined> => {
  const file = Bun.file(path);
  if (!(await file.exists())) return undefined;
  return (await file.text()).includes(MODE_ENV) ? 'dev' : 'prod';
};

const modeLine = async (spec: ServiceSpec, path: string): Promise<string> => {
  const installed = await installedMode(path);
  if (!installed) return 'not installed';
  if (installed === 'prod') return 'prod';
  return watches(spec.id) ? 'dev (watching)' : 'dev (never watched)';
};

const launchAgentStatus = async (
  spec: ServiceSpec,
  note: (line: string) => void
): Promise<void> => {
  const listed = await run(['launchctl', 'list', label(spec.id)]);
  const pid = /"PID"\s*=\s*(\d+)/.exec(listed.stdout.toString())?.[1];
  note(`service  ${spec.id} (${label(spec.id)})`);
  note(`unit     ${launchAgentPath(spec.id)}`);
  note(
    `state    ${listed.exitCode !== 0 ? 'not loaded' : pid ? `running (pid ${pid})` : 'loaded, not running'}`
  );
  note(`mode     ${await modeLine(spec, launchAgentPath(spec.id))}`);
  const live = await spec.probe();
  if (live) note(`live     ${live}`);
  note(`logs     ${launchAgentLog(spec.id)}`);
};

const systemdStatus = async (spec: ServiceSpec, note: (line: string) => void): Promise<void> => {
  const active = await run(['systemctl', '--user', 'is-active', unitName(spec.id)]);
  const enabled = await run(['systemctl', '--user', 'is-enabled', unitName(spec.id)]);
  note(`service  ${spec.id} (${unitName(spec.id)})`);
  note(`unit     ${systemdPath(spec.id)}`);
  note(`state    ${active.stdout.toString().trim() || 'unknown'} (${enabled.stdout.toString().trim() || 'not installed'})`);
  note(`mode     ${await modeLine(spec, systemdPath(spec.id))}`);
  const live = await spec.probe();
  if (live) note(`live     ${live}`);
  note(`logs     journalctl --user -u ${unitName(spec.id)} -f`);
};

/** How many lines of a service's history are worth reading without asking for more. */
const LOG_TAIL_LINES = 200;

const launchAgentLogs = async (spec: ServiceSpec, follow: boolean): Promise<void> => {
  const path = launchAgentLog(spec.id);
  if (!(await Bun.file(path).exists())) {
    throw new ServiceError(`no log yet at ${path} — is the service installed?`);
  }
  const tail = follow ? ['tail', '-n', `${LOG_TAIL_LINES}`, '-f'] : ['tail', '-n', `${LOG_TAIL_LINES}`];
  await Bun.spawn([...tail, path], { stdio: ['inherit', 'inherit', 'inherit'] }).exited;
};

const systemdLogs = async (spec: ServiceSpec, follow: boolean): Promise<void> => {
  const journal = ['journalctl', '--user', '-u', unitName(spec.id), '-n', `${LOG_TAIL_LINES}`];
  if (follow) journal.push('-f');
  await Bun.spawn(journal, { stdio: ['inherit', 'inherit', 'inherit'] }).exited;
};

export interface ServiceOptions {
  /** Which services the verb acts on. `logs` reads exactly one. */
  ids: readonly ServiceId[];
  /** Which flavour `install` writes. Every other verb reads the mode off disk. */
  mode: ServiceMode;
  follow: boolean;
  /** `restart` only: wait for the daemon's sessions rather than refusing. */
  whenIdle: boolean;
  /** `restart` only: interrupt them, or restart without knowing whether it will. */
  force: boolean;
  note: (line: string) => void;
}

/**
 * Runs one of the service verbs against whichever init system this machine has.
 * Everything it touches is per-user: no sudo, and nothing outside `$HOME`.
 */
export const service = async (
  action: ServiceAction,
  { ids, mode, follow, whenIdle, force, note }: ServiceOptions
): Promise<void> => {
  const host = platform();
  if (host !== 'darwin' && host !== 'linux') {
    throw new ServiceError(`cockpit service does not know how to manage a service on ${host}`);
  }
  const mac = host === 'darwin';
  const specs = ids.map((id) => specFor(id, mode));

  switch (action) {
    case 'install': {
      // Every check first, so a refusal costs nothing rather than leaving half
      // the stack installed.
      const warnings = specs.flatMap((spec) => spec.check?.()?.split('\n') ?? []);
      for (const line of warnings) note(line);
      if (warnings.length > 0) note('');
      return mac ? installLaunchAgents(specs, note) : installSystemdUnits(specs, note);
    }
    case 'uninstall':
      return mac ? uninstallLaunchAgents(specs, note) : uninstallSystemdUnits(specs, note);
    case 'restart':
      for (const [index, spec] of specs.entries()) {
        if (index > 0) note('');
        // Asked per service and not up front, so the two that are safe to bounce
        // are already back up by the time the daemon's question is answered.
        await clearToRestart(spec, { whenIdle, force }, note);
        await (mac ? restartLaunchAgent(spec, note) : restartSystemdUnit(spec, note));
      }
      return;
    case 'status':
      for (const [index, spec] of specs.entries()) {
        if (index > 0) note('');
        await (mac ? launchAgentStatus(spec, note) : systemdStatus(spec, note));
      }
      return;
    case 'logs': {
      const [spec] = specs;
      if (!spec || specs.length > 1) {
        throw new ServiceError(`cockpit service logs reads one service: ${SERVICE_IDS.join(', ')}`);
      }
      return mac ? launchAgentLogs(spec, follow) : systemdLogs(spec, follow);
    }
  }
};
