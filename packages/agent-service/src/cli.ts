#!/usr/bin/env bun
/**
 * CLI entry point for the AgentDeck Agent Service
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
      // Note: --agent-id is deprecated - machineId is now derived from hardware
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

  // Environment variable fallback (CLI flag takes precedence)
  if (!options.hubUrl) {
    options.hubUrl = process.env.AGENTDECK_HUB_URL;
  }

  // Auto-disable discovery when explicit URL is provided
  if (options.hubUrl && options.useDiscovery === undefined) {
    options.useDiscovery = false;
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
AgentDeck Agent Service

Usage: bunx @agentdeck/agent [options]

Options:
  -h, --hub-url <url>         Hub WebSocket URL to connect to
  --no-discovery              Disable mDNS discovery
  --advertise                 Advertise agent via mDNS
  --advertise-port <port>     Port for advertising
  --heartbeat-interval <ms>   Heartbeat interval in milliseconds
  --help                      Show this help message

Environment Variables:
  AGENTDECK_HUB_URL           Hub WebSocket URL (overridden by --hub-url)

Note: Machine ID is automatically derived from hardware identifiers.
      When --hub-url or AGENTDECK_HUB_URL is set, mDNS discovery is disabled by default.

Examples:
  bunx @agentdeck/agent --hub-url ws://localhost:3456/ws/hub
  bunx @agentdeck/agent --no-discovery --hub-url ws://hub.local:3456/ws/hub
  AGENTDECK_HUB_URL=wss://hub.example.com/ws/hub bunx @agentdeck/agent
`);
}

main();
