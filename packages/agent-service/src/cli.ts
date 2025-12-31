#!/usr/bin/env bun
/**
 * CLI entry point for the Cockpit Agent Service
 */

import { AgentDaemon, type AgentDaemonOptions } from './daemon.js';

async function main() {
  const args = process.argv.slice(2);
  const options: AgentDaemonOptions = {};

  // Parse command line arguments
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];

    switch (arg) {
      case '--hub-url':
      case '-h':
        options.hubUrl = nextArg;
        i++;
        break;
      case '--agent-id':
      case '-i':
        options.agentId = nextArg;
        i++;
        break;
      case '--no-discovery':
        options.useDiscovery = false;
        break;
      case '--advertise':
        options.advertise = true;
        break;
      case '--advertise-port':
        options.advertisePort = parseInt(nextArg, 10);
        i++;
        break;
      case '--heartbeat-interval':
        options.heartbeatInterval = parseInt(nextArg, 10);
        i++;
        break;
      case '--help':
        printHelp();
        process.exit(0);
        break;
      default:
        if (arg.startsWith('-')) {
          console.error(`Unknown option: ${arg}`);
          printHelp();
          process.exit(1);
        }
    }
  }

  // Create and start daemon
  const daemon = new AgentDaemon(options);

  // Handle shutdown signals
  const shutdown = async () => {
    console.log('\nReceived shutdown signal...');
    await daemon.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Handle uncaught errors
  process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error);
    daemon.stop().finally(() => process.exit(1));
  });

  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled rejection:', reason);
  });

  try {
    await daemon.start();
    console.log('Agent daemon is running. Press Ctrl+C to stop.');
  } catch (error) {
    console.error('Failed to start agent daemon:', error);
    process.exit(1);
  }
}

function printHelp() {
  console.log(`
Cockpit Agent Service

Usage: bun run src/cli.ts [options]

Options:
  -h, --hub-url <url>         Hub WebSocket URL to connect to
  -i, --agent-id <id>         Agent ID (auto-generated if not provided)
  --no-discovery              Disable mDNS discovery
  --advertise                 Advertise agent via mDNS
  --advertise-port <port>     Port for advertising
  --heartbeat-interval <ms>   Heartbeat interval in milliseconds
  --help                      Show this help message

Examples:
  bun run src/cli.ts --hub-url ws://localhost:3001
  bun run src/cli.ts --agent-id my-agent --no-discovery --hub-url ws://hub.local:3001
`);
}

main();
