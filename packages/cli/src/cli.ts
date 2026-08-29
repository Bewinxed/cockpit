#!/usr/bin/env bun
import type { AgentRow, AuthState } from '@cockpit/core';
import { COCKPIT_ENV, COCKPIT_HUB_PORT } from '@cockpit/core';
import { CONFIG_PATH, readConfig } from './config';
import { discoverHub, type Hub } from './discover';
import { clearToken, login, LoginError, saveToken } from './login';
import {
  CHECKOUT_ROOT,
  DEPLOY_BRANCH,
  DEPLOY_MARKER,
  deployInit,
  deployRoot,
  isServiceAction,
  isServiceId,
  service,
  ServiceError,
  SERVICE_ACTIONS,
  SERVICE_IDS,
} from './service';

/** Reported by `--version`; keep in sync with package.json. */
const CLI_VERSION = '0.1.0';

const HELP = `cockpit ${CLI_VERSION} — join this machine to a cockpit fleet

Usage
  cockpit up [--hub <url>] [--verbose]      run the agent daemon on this machine
  cockpit hub [--verbose]                   run the hub here
  cockpit status [--hub <url>] [--verbose]  print the hub it found, and the fleet
  cockpit service <${SERVICE_ACTIONS.join('|')}> [service...]
                                            run cockpit as per-user services
  cockpit deploy init [--origin <url>]      run the services from a clean clone
  cockpit login [--token <token>]           give this machine a Claude Code token
  cockpit logout                            forget it

Services
  ${SERVICE_IDS.join(', ')} — each its own per-user service, started by systemd or
  launchd and kept up across reboots. \`install\`, \`uninstall\`, \`restart\` and
  \`status\` take any of them and act on all three when given none; \`logs\` takes
  exactly one. A machine nobody points a browser at wants \`agent\` alone.

  \`install --dev\` runs them out of the checkout instead of the build: the hub
  watches its own source and restarts itself on every edit, which costs nothing
  because the sessions live in the daemons and reconnect; the dashboard runs
  vite, which reloads an edited file without restarting at all. The agent is
  never watched in either mode — it hosts your sessions, and a restart ends
  whatever turn is in flight. \`status\` reads the mode back out of the unit.

  \`restart agent\` is therefore always deliberate: it asks the hub how many of
  this machine's sessions are mid-turn and refuses while any are. \`--when-idle\`
  waits up to five minutes for those turns to finish and then restarts; \`--force\`
  restarts regardless, and is also the only way through when the hub cannot be
  reached to answer the question at all.

Deploying
  \`cockpit deploy init\` clones ${DEPLOY_BRANCH} into ${deployRoot()} — a checkout
  that is nobody's working copy — installs it, builds the dashboard, writes a
  ${DEPLOY_MARKER} marker and installs the services pointing at that clone
  instead of at your editor's checkout. From then on the daemon fetches
  ${DEPLOY_BRANCH} every minute and, when the clone is strictly behind, pulls
  \`--ff-only\`, reinstalls, rebuilds and restarts. Pushing to ${DEPLOY_BRANCH} is
  the fleet deploy.

  The marker is the whole safety story: a checkout without one is never fetched
  and never pulled, so a dev tree cannot auto-update no matter what is running
  in it. A clone that has diverged from origin refuses loudly and is left
  exactly as it is — resetting it would destroy work nobody else has a copy of.

Options
  --hub <url>     hub to use, as http://host:port or ws://host:port/ws
  --token <token> a \`claude setup-token\` token, for \`login\` without a terminal
  --dev           for \`service install\`: run from the checkout, watching it
  --origin <url>  for \`deploy init\`: the remote to clone (default this one's)
  --when-idle     for \`service restart\`: wait for this machine's sessions first
  --force         for \`service restart\`: restart the agent mid-turn anyway
  --follow, -f    keep printing, for \`service logs\`
  --verbose       narrate the discovery ladder
  --help          this
  --version       print the version

Signing in
  The daemon runs Claude Code as you, so it needs the credentials you logged in
  with. Run it as a service — \`cockpit service install\` — and on macOS it
  inherits your desktop session and reads them from the login keychain, which is
  the whole fix. A daemon started over SSH cannot: the keychain refuses a process
  with no GUI session, and every turn comes back "Not logged in".

  Where that is not possible — a headless box — \`cockpit login\` mints a token
  instead, kept in ${CONFIG_PATH} at mode 0600 and exported to the daemon as
  CLAUDE_CODE_OAUTH_TOKEN, which skips the keychain entirely.

Finding the hub, in order — the first that answers wins
  1. --hub, then ${COCKPIT_ENV.hubUrl}
  2. the last hub that answered, remembered in ${CONFIG_PATH}
  3. mDNS on the local link (_cockpit._tcp)
  4. online Tailscale peers, on ${COCKPIT_ENV.hubPort} (default ${COCKPIT_HUB_PORT})
  5. http://localhost:${COCKPIT_HUB_PORT}

  Step 3 only ever sees the local link. mDNS is multicast, and multicast does
  not travel over Tailscale — a hub on the far side of a tailnet is found by
  step 4, never by step 3.

Environment
  ${COCKPIT_ENV.hubUrl}    hub to use, same as --hub
  ${COCKPIT_ENV.hubPort}   port the probes try (default ${COCKPIT_HUB_PORT})
  ${COCKPIT_ENV.noMdns}=1  stop \`cockpit hub\` advertising itself
`;

const NO_HUB = `cockpit: no hub found.

Start one with \`cockpit hub\`, or point this machine at an existing one with
\`cockpit up --hub http://host:${COCKPIT_HUB_PORT}\`. Run again with --verbose to
see what each step tried.`;

interface Args {
  command?: string;
  /** The verb after the command, for the one command that takes one: `service`. */
  action?: string;
  /** Everything after the verb — the services `service` acts on. */
  rest: string[];
  hub?: string;
  token?: string;
  origin?: string;
  dev: boolean;
  whenIdle: boolean;
  force: boolean;
  follow: boolean;
  verbose: boolean;
  help: boolean;
  version: boolean;
}

class UsageError extends Error {}

const parseArgs = (argv: string[]): Args => {
  const args: Args = {
    rest: [],
    dev: false,
    whenIdle: false,
    force: false,
    follow: false,
    verbose: false,
    help: false,
    version: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] as string;
    switch (arg) {
      case '--hub':
        args.hub = argv[++index];
        if (!args.hub) throw new UsageError('--hub needs a URL');
        break;
      case '--token':
        args.token = argv[++index];
        if (!args.token) throw new UsageError('--token needs a token');
        break;
      case '--origin':
        args.origin = argv[++index];
        if (!args.origin) throw new UsageError('--origin needs a git URL');
        break;
      case '--dev':
        args.dev = true;
        break;
      case '--when-idle':
        args.whenIdle = true;
        break;
      case '--force':
        args.force = true;
        break;
      case '--follow':
      case '-f':
        args.follow = true;
        break;
      case '--verbose':
      case '-v':
        args.verbose = true;
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      case '--version':
        args.version = true;
        break;
      default:
        if (arg.startsWith('-')) throw new UsageError(`unknown option ${arg}`);
        if (!args.command) args.command = arg;
        else if (!args.action) args.action = arg;
        else args.rest.push(arg);
    }
  }
  return args;
};

const note = (line: string): void => console.error(line);

const resolve = async (args: Args): Promise<Hub | undefined> =>
  discoverHub({ hub: args.hub, log: args.verbose ? note : undefined });

const seen = (at: AgentRow['lastSeenAt']): string => {
  if (!at) return 'never';
  const seconds = Math.round((Date.now() - new Date(at).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  return `${Math.round(seconds / 3600)}h ago`;
};

const printFleet = (agents: AgentRow[]): void => {
  if (agents.length === 0) {
    console.log('\nfleet    empty — nothing has registered yet');
    return;
  }
  const rows = agents.map((agent) => [
    agent.hostname,
    agent.status,
    agent.auth === 'authenticated' ? 'yes' : agent.auth === 'unknown' ? '?' : 'NO',
    agent.os,
    seen(agent.lastSeenAt),
    agent.machineId,
  ]);
  const headers = ['MACHINE', 'STATUS', 'SIGNED IN', 'OS', 'LAST SEEN', 'ID'];
  const widths = headers.map((header, column) =>
    Math.max(header.length, ...rows.map((row) => (row[column] as string).length))
  );
  const line = (cells: string[]): string =>
    cells.map((cell, column) => cell.padEnd(widths[column] as number)).join('  ').trimEnd();
  console.log(`\n${line(headers)}`);
  for (const row of rows) console.log(line(row));
};

const status = async (args: Args): Promise<number> => {
  const hub = await resolve(args);
  if (!hub) {
    console.error(NO_HUB);
    return 1;
  }

  console.log(`hub      ${hub.httpUrl}`);
  console.log(`socket   ${hub.wsUrl}`);
  console.log(`found    ${hub.source}`);
  console.log(`config   ${CONFIG_PATH}`);

  const agents = await fetch(`${hub.httpUrl}/api/agents`)
    .then((response) => (response.ok ? (response.json() as Promise<AgentRow[]>) : undefined))
    .catch(() => undefined);
  if (!agents) {
    console.error(`\ncockpit: ${hub.httpUrl} did not answer /api/agents`);
    return 1;
  }
  printFleet(agents);
  return 0;
};

/**
 * Hands the daemon the stored token, unless the environment already names one —
 * whoever set that meant it. Returns whether the SDK will find a token; the
 * value itself is never logged, framed, or written anywhere but the config.
 */
const applyToken = async (): Promise<boolean> => {
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) return true;
  const token = (await readConfig())?.claudeToken;
  if (!token) return false;
  process.env.CLAUDE_CODE_OAUTH_TOKEN = token;
  return true;
};

/**
 * What a machine that cannot reach its credentials should be told, and how it
 * differs by why. The macOS case is the one worth spelling out: the credentials
 * are there and correct, so "log in again" is the one thing that will not work.
 */
const authNote = (state: Exclude<AuthState, 'authenticated'>): string =>
  state === 'unreadable-credentials'
    ? `cockpit: this machine has Claude Code credentials, but this process cannot read them.
They live in your login keychain, and the keychain only opens for a process
inside your desktop session — a daemon started over SSH is not one, so sessions
will start and then answer "Not logged in". Logging in again will not change it.`
    : `cockpit: nobody is signed in to Claude Code on this machine, so sessions will
start and then answer "Not logged in".`;

/**
 * Asked before registering, because a machine that cannot start a session should
 * say so rather than sit in the fleet looking ready. With a terminal this offers
 * the fix; without one it prints it and carries on — a daemon under launchd or
 * systemd has nobody to ask, and blocking on stdin there is a hang, not a prompt.
 */
const preflight = async (): Promise<AuthState> => {
  // Loaded here rather than at the top so `status` never pays for the agent SDK.
  const { probeAuth } = await import('@cockpit/agent');
  const state = await probeAuth();
  if (state === 'authenticated') return state;

  console.error(authNote(state));

  if (!process.stdin.isTTY) {
    console.error(`
Fix it from this machine with \`cockpit login\`, or run the daemon as a service
— \`cockpit service install\` — which on macOS is enough on its own. Starting
anyway; the fleet will show this machine as needing sign-in.`);
    return state;
  }

  const answer = prompt('\nRun `claude setup-token` now to fix it? [Y/n]')?.trim().toLowerCase();
  if (answer && answer !== 'y' && answer !== 'yes') return state;

  await login();
  // The token the flow produced is loaded like any other, so `up` continues with
  // exactly what a later start would have.
  return (await applyToken()) ? 'authenticated' : state;
};

const up = async (args: Args): Promise<number> => {
  const hub = await resolve(args);
  if (!hub) {
    console.error(NO_HUB);
    return 1;
  }
  console.log(`cockpit: hub ${hub.httpUrl} (found by ${hub.source})`);

  await applyToken();
  const auth = await preflight();
  if (process.stdin.isTTY) {
    console.log('cockpit: `cockpit service install` runs this in the background instead.');
  }

  // The daemon reads its hub from the environment, so this is the handoff.
  process.env[COCKPIT_ENV.hubUrl] = hub.wsUrl;
  const { runDaemon, watchDeployment } = await import('@cockpit/agent');
  runDaemon(auth);
  // Started unconditionally, because it is safe unconditionally: the first
  // thing every poll does is look for the marker, and a checkout without one is
  // never fetched, compared or pulled. On a dev machine this is a no-op that
  // costs one `stat` a minute; on a deployed machine it is what makes a push to
  // main reach it (C8).
  //
  // Pointed at THIS agent's own checkout, not at `deployRoot()`. The default
  // would aim every agent at `~/.cockpit/app` regardless of where it runs from,
  // so a dev-tree agent would poll the clone, pull into it, and restart the
  // service stack it is not part of — the safety the comment above claims is
  // only true when the root is the poller's own tree.
  watchDeployment({ root: CHECKOUT_ROOT });
  return 0;
};

const runService = async (args: Args): Promise<number> => {
  if (!isServiceAction(args.action)) {
    throw new UsageError(`cockpit service needs one of: ${SERVICE_ACTIONS.join(', ')}`);
  }
  const named = args.rest.map((id) => {
    if (!isServiceId(id)) {
      throw new UsageError(`cockpit service does not know ${id} — one of: ${SERVICE_IDS.join(', ')}`);
    }
    return id;
  });
  // Naming nothing means the whole stack, which is what someone setting a
  // machine up wants; `logs` is the exception and says so itself.
  const ids = named.length > 0 ? named : SERVICE_IDS;
  await service(args.action, {
    ids,
    mode: args.dev ? 'dev' : 'prod',
    follow: args.follow,
    whenIdle: args.whenIdle,
    force: args.force,
    note: (line) => console.log(line),
  });
  return 0;
};

/**
 * `cockpit deploy init` (PLAN.md C8). One verb, and deliberately only one: the
 * clone is created here, and every deploy after it is a push to the deploy
 * branch that the daemon's poller picks up.
 */
const runDeploy = async (args: Args): Promise<number> => {
  if (args.action !== 'init') {
    throw new UsageError('cockpit deploy takes one verb: init');
  }
  const result = await deployInit({
    ...(args.origin === undefined ? {} : { origin: args.origin }),
    note: (line) => console.log(line),
  });
  console.log('');
  console.log(`clone    ${result.root} (${result.origin}, ${result.branch}) at ${result.head}`);
  console.log(`marker   ${result.root}/${DEPLOY_MARKER}`);
  for (const generated of result.units) console.log(`unit     ${generated.path}`);
  console.log('');
  console.log(`This machine now deploys on every push to ${result.branch}.`);
  return 0;
};

/** Importing the hub boots it: its entry point listens, and then stays up. */
const hub = async (): Promise<number> => {
  await import('@cockpit/hub');
  return 0;
};

const run = async (argv: string[]): Promise<number> => {
  const args = parseArgs(argv);
  if (args.help || (!args.command && !args.version)) {
    console.log(HELP);
    return 0;
  }
  if (args.version) {
    console.log(CLI_VERSION);
    return 0;
  }

  switch (args.command) {
    case 'up':
      return up(args);
    case 'hub':
      return hub();
    case 'status':
      return status(args);
    case 'service':
      return runService(args);
    case 'deploy':
      return runDeploy(args);
    case 'login':
      if (args.token) await saveToken(args.token);
      else await login();
      console.log(`cockpit: token saved to ${CONFIG_PATH}. Restart the daemon to use it.`);
      return 0;
    case 'logout':
      console.log(
        (await clearToken())
          ? `cockpit: token cleared from ${CONFIG_PATH}.`
          : 'cockpit: no token was stored.'
      );
      return 0;
    default:
      throw new UsageError(`unknown command ${args.command}`);
  }
};

const code = await run(Bun.argv.slice(2)).catch((error: unknown) => {
  if (error instanceof UsageError) {
    console.error(`cockpit: ${error.message}\n\nRun \`cockpit --help\`.`);
    return 2;
  }
  if (error instanceof LoginError || error instanceof ServiceError) {
    console.error(`cockpit: ${error.message}`);
    return 1;
  }
  throw error;
});

// A command that left something running — the daemon, the hub — keeps the
// process alive on its own; exiting here would cut it off.
if (code !== 0) process.exit(code);
