#!/usr/bin/env bun
import { COCKPIT_ENV, COCKPIT_HUB_PORT } from '@cockpit/core';
import { CONFIG_PATH } from './config';
import { discoverHub, type Hub } from './discover';

/** Reported by `--version`; keep in sync with package.json. */
const CLI_VERSION = '0.1.0';

const HELP = `cockpit ${CLI_VERSION} — join this machine to a cockpit fleet

Usage
  cockpit up [--hub <url>] [--verbose]      run the agent daemon on this machine
  cockpit hub [--verbose]                   run the hub here
  cockpit status [--hub <url>] [--verbose]  print the hub it found, and the fleet

Options
  --hub <url>   hub to use, as http://host:port or ws://host:port/ws
  --verbose     narrate the discovery ladder
  --help        this
  --version     print the version

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
  hub?: string;
  verbose: boolean;
  help: boolean;
  version: boolean;
}

class UsageError extends Error {}

const parseArgs = (argv: string[]): Args => {
  const args: Args = { verbose: false, help: false, version: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] as string;
    switch (arg) {
      case '--hub':
        args.hub = argv[++index];
        if (!args.hub) throw new UsageError('--hub needs a URL');
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
        if (args.command) throw new UsageError(`unexpected argument ${arg}`);
        args.command = arg;
    }
  }
  return args;
};

const note = (line: string): void => console.error(line);

const resolve = async (args: Args): Promise<Hub | undefined> =>
  discoverHub({ hub: args.hub, log: args.verbose ? note : undefined });

/** One row of the hub's `/api/agents`, which is all the fleet listing needs. */
interface AgentRow {
  machineId: string;
  hostname: string;
  os: string;
  status: string;
  lastSeenAt: string | number | null;
}

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
    agent.os,
    seen(agent.lastSeenAt),
    agent.machineId,
  ]);
  const headers = ['MACHINE', 'STATUS', 'OS', 'LAST SEEN', 'ID'];
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

const up = async (args: Args): Promise<number> => {
  const hub = await resolve(args);
  if (!hub) {
    console.error(NO_HUB);
    return 1;
  }
  console.log(`cockpit: hub ${hub.httpUrl} (found by ${hub.source})`);

  // The daemon reads its hub from the environment, so this is the handoff.
  process.env[COCKPIT_ENV.hubUrl] = hub.wsUrl;
  // Loaded here rather than at the top so `status` never pays for the agent SDK.
  const { runDaemon } = await import('@cockpit/agent');
  runDaemon();
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
    default:
      throw new UsageError(`unknown command ${args.command}`);
  }
};

const code = await run(Bun.argv.slice(2)).catch((error: unknown) => {
  if (error instanceof UsageError) {
    console.error(`cockpit: ${error.message}\n\nRun \`cockpit --help\`.`);
    return 2;
  }
  throw error;
});

// A command that left something running — the daemon, the hub — keeps the
// process alive on its own; exiting here would cut it off.
if (code !== 0) process.exit(code);
