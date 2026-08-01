import { chmod } from 'node:fs/promises';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';

/**
 * Running the daemon as a per-user service rather than by hand over SSH is not
 * only about surviving reboots. On macOS it is what makes Claude Code work at
 * all: a LaunchAgent runs inside the user's Aqua session, so it can read the
 * login keychain the credentials live in. The same daemon started from an SSH
 * shell cannot, and every turn it takes answers "Not logged in".
 */
export const SERVICE_LABEL = 'dev.cockpit.agent';

/** systemd wants a name, launchd wants a reverse-DNS label; they are the same service. */
const SYSTEMD_UNIT = 'cockpit-agent.service';

export type ServiceAction = 'install' | 'uninstall' | 'status' | 'logs';

export const SERVICE_ACTIONS: readonly ServiceAction[] = [
  'install',
  'uninstall',
  'status',
  'logs',
];

export const isServiceAction = (value: string | undefined): value is ServiceAction =>
  SERVICE_ACTIONS.includes(value as ServiceAction);

/** Thrown for anything the caller can fix — a wrong platform, a failed launchctl. */
export class ServiceError extends Error {}

const LAUNCH_AGENT_PATH = join(
  homedir(),
  'Library',
  'LaunchAgents',
  `${SERVICE_LABEL}.plist`
);
const LAUNCH_AGENT_LOG = join(homedir(), 'Library', 'Logs', 'cockpit-agent.log');
const SYSTEMD_UNIT_PATH = join(
  process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'),
  'systemd',
  'user',
  SYSTEMD_UNIT
);

/**
 * The command the service runs: this same CLI, `up`, under the same Bun that is
 * running right now. Installing from a checkout therefore installs that
 * checkout, which is what someone testing a branch means by it.
 */
const command = (): string[] => [process.execPath, Bun.main, 'up'];

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

const xml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const plist = (): string => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xml(SERVICE_LABEL)}</string>
  <key>ProgramArguments</key>
  <array>
${command()
  .map((argument) => `    <string>${xml(argument)}</string>`)
  .join('\n')}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${xml(servicePath())}</string>
  </dict>
  <key>WorkingDirectory</key>
  <string>${xml(homedir())}</string>
  <key>StandardOutPath</key>
  <string>${xml(LAUNCH_AGENT_LOG)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(LAUNCH_AGENT_LOG)}</string>
</dict>
</plist>
`;

const unit = (): string => `[Unit]
Description=Cockpit agent
After=network-online.target

[Service]
ExecStart=${command().join(' ')}
Environment=PATH=${servicePath()}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
`;

const run = async (argv: string[]) => Bun.$`${argv}`.quiet().nothrow();

const failed = (what: string, result: Awaited<ReturnType<typeof run>>): ServiceError =>
  new ServiceError(`${what} failed: ${result.stderr.toString().trim() || `exit ${result.exitCode}`}`);

const guiDomain = (): string => `gui/${process.getuid?.() ?? 0}`;

/**
 * `bootstrap` replaced `load` in the launchd rewrite, and `load` is still there
 * as a deprecated alias on the systems that have both — so which one exists is
 * asked rather than assumed from the OS version.
 */
const hasBootstrap = async (): Promise<boolean> => {
  // `launchctl help` writes its subcommand list to stderr on some releases.
  const help = await run(['launchctl', 'help']);
  return `${help.stdout.toString()}${help.stderr.toString()}`.includes('bootstrap');
};

/**
 * A service definition someone else can rewrite is a service someone else can
 * run as you, so it is written owner-only — and set on the way out, because a
 * file that already existed keeps the mode it had.
 */
const writeUnit = async (path: string, contents: string): Promise<void> => {
  await Bun.write(path, contents);
  await chmod(path, 0o600);
};

const installLaunchAgent = async (note: (line: string) => void): Promise<void> => {
  await writeUnit(LAUNCH_AGENT_PATH, plist());
  note(`wrote ${LAUNCH_AGENT_PATH}`);

  // An install over a running service has to replace it, and launchd refuses to
  // bootstrap a label it already knows.
  await run(['launchctl', 'bootout', `${guiDomain()}/${SERVICE_LABEL}`]);

  if (await hasBootstrap()) {
    const bootstrapped = await run(['launchctl', 'bootstrap', guiDomain(), LAUNCH_AGENT_PATH]);
    if (bootstrapped.exitCode !== 0) throw failed('launchctl bootstrap', bootstrapped);
    note(`bootstrapped into ${guiDomain()}`);
  } else {
    const loaded = await run(['launchctl', 'load', '-w', LAUNCH_AGENT_PATH]);
    if (loaded.exitCode !== 0) throw failed('launchctl load', loaded);
    note('loaded (legacy launchctl)');
  }

  note(`logs ${LAUNCH_AGENT_LOG}`);
  note('');
  note('A LaunchAgent runs inside your desktop session, so it can read the login');
  note('keychain Claude Code keeps its credentials in. No token needed.');
};

const uninstallLaunchAgent = async (note: (line: string) => void): Promise<void> => {
  if (await hasBootstrap()) await run(['launchctl', 'bootout', `${guiDomain()}/${SERVICE_LABEL}`]);
  else await run(['launchctl', 'unload', '-w', LAUNCH_AGENT_PATH]);
  await Bun.file(LAUNCH_AGENT_PATH).delete().catch(() => {});
  note(`removed ${LAUNCH_AGENT_PATH}`);
};

/**
 * Without lingering, systemd tears the user manager down at logout and takes the
 * daemon with it — the same "it dies when I disconnect" the service is meant to
 * fix. Only worth saying when it is actually off.
 */
const lingerHint = async (note: (line: string) => void): Promise<void> => {
  const user = process.env.USER ?? '';
  const shown = await run(['loginctl', 'show-user', user, '--property=Linger']);
  if (shown.exitCode !== 0 || shown.stdout.toString().includes('Linger=yes')) return;
  note('');
  note(`This user has no persistent session, so the daemon stops at logout. Fix with:`);
  note(`  sudo loginctl enable-linger ${user}`);
};

const installSystemdUnit = async (note: (line: string) => void): Promise<void> => {
  await writeUnit(SYSTEMD_UNIT_PATH, unit());
  note(`wrote ${SYSTEMD_UNIT_PATH}`);

  const reloaded = await run(['systemctl', '--user', 'daemon-reload']);
  if (reloaded.exitCode !== 0) throw failed('systemctl --user daemon-reload', reloaded);
  const enabled = await run(['systemctl', '--user', 'enable', '--now', SYSTEMD_UNIT]);
  if (enabled.exitCode !== 0) throw failed('systemctl --user enable --now', enabled);
  note(`enabled and started ${SYSTEMD_UNIT}`);
  note(`logs journalctl --user -u ${SYSTEMD_UNIT} -f`);
  await lingerHint(note);
};

const uninstallSystemdUnit = async (note: (line: string) => void): Promise<void> => {
  await run(['systemctl', '--user', 'disable', '--now', SYSTEMD_UNIT]);
  await Bun.file(SYSTEMD_UNIT_PATH).delete().catch(() => {});
  await run(['systemctl', '--user', 'daemon-reload']);
  note(`removed ${SYSTEMD_UNIT_PATH}`);
};

const launchAgentStatus = async (note: (line: string) => void): Promise<void> => {
  const listed = await run(['launchctl', 'list', SERVICE_LABEL]);
  const pid = /"PID"\s*=\s*(\d+)/.exec(listed.stdout.toString())?.[1];
  note(`service  ${SERVICE_LABEL}`);
  note(`unit     ${LAUNCH_AGENT_PATH}`);
  note(
    `state    ${listed.exitCode !== 0 ? 'not loaded' : pid ? `running (pid ${pid})` : 'loaded, not running'}`
  );
  note(`logs     ${LAUNCH_AGENT_LOG}`);
};

const systemdStatus = async (note: (line: string) => void): Promise<void> => {
  const active = await run(['systemctl', '--user', 'is-active', SYSTEMD_UNIT]);
  const enabled = await run(['systemctl', '--user', 'is-enabled', SYSTEMD_UNIT]);
  note(`service  ${SYSTEMD_UNIT}`);
  note(`unit     ${SYSTEMD_UNIT_PATH}`);
  note(`state    ${active.stdout.toString().trim() || 'unknown'} (${enabled.stdout.toString().trim() || 'not installed'})`);
  note(`logs     journalctl --user -u ${SYSTEMD_UNIT} -f`);
};

/** How many lines of a service's history are worth reading without asking for more. */
const LOG_TAIL_LINES = 200;

const launchAgentLogs = async (follow: boolean): Promise<void> => {
  if (!(await Bun.file(LAUNCH_AGENT_LOG).exists())) {
    throw new ServiceError(`no log yet at ${LAUNCH_AGENT_LOG} — is the service installed?`);
  }
  const tail = follow ? ['tail', '-n', `${LOG_TAIL_LINES}`, '-f'] : ['tail', '-n', `${LOG_TAIL_LINES}`];
  await Bun.spawn([...tail, LAUNCH_AGENT_LOG], { stdio: ['inherit', 'inherit', 'inherit'] }).exited;
};

const systemdLogs = async (follow: boolean): Promise<void> => {
  const journal = ['journalctl', '--user', '-u', SYSTEMD_UNIT, '-n', `${LOG_TAIL_LINES}`];
  if (follow) journal.push('-f');
  await Bun.spawn(journal, { stdio: ['inherit', 'inherit', 'inherit'] }).exited;
};

export interface ServiceOptions {
  follow: boolean;
  note: (line: string) => void;
}

/**
 * Runs one of the four service verbs against whichever init system this machine
 * has. Everything it touches is per-user: no sudo, and nothing outside `$HOME`.
 */
export const service = async (
  action: ServiceAction,
  { follow, note }: ServiceOptions
): Promise<void> => {
  const host = platform();
  if (host !== 'darwin' && host !== 'linux') {
    throw new ServiceError(`cockpit service does not know how to manage a service on ${host}`);
  }
  const mac = host === 'darwin';

  switch (action) {
    case 'install':
      return mac ? installLaunchAgent(note) : installSystemdUnit(note);
    case 'uninstall':
      return mac ? uninstallLaunchAgent(note) : uninstallSystemdUnit(note);
    case 'status':
      return mac ? launchAgentStatus(note) : systemdStatus(note);
    case 'logs':
      return mac ? launchAgentLogs(follow) : systemdLogs(follow);
  }
};
