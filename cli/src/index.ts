#!/usr/bin/env bun

import { Command } from 'commander';
import { hub } from './commands/hub';
import { agent } from './commands/agent';
import { status } from './commands/status';

const program = new Command();

program
  .name('cockpit')
  .description('Claude Code Management Dashboard')
  .version('0.0.1');

program
  .command('hub')
  .description('Start as hub (server mode with dashboard)')
  .option('-p, --port <port>', 'Port to listen on', '3456')
  .option('-d, --db <path>', 'Database path', './cockpit.db')
  .option('--no-discovery', 'Disable mDNS discovery')
  .action(hub);

program
  .command('agent')
  .description('Start as agent (client mode)')
  .option('--hub <url>', 'Hub URL (overrides discovery)')
  .option('-d, --db <path>', 'Local database path', './cockpit-agent.db')
  .option('--no-discovery', 'Disable mDNS discovery')
  .action(agent);

program
  .command('status')
  .description('Show system status')
  .action(status);

program.parse();
