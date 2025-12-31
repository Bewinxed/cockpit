// Main daemon
export { AgentDaemon, type AgentDaemonOptions, type AgentDaemonEvents } from './daemon.js';

// Instance manager
export {
  InstanceManager,
  type SpawnInstanceParams,
  type McpServerConfig,
  type InstanceManagerEvents,
  type InstanceStatusInfo,
} from './instance-manager.js';

// Hub client
export {
  HubClient,
  type HubClientOptions,
  type HubClientEvents,
} from './hub-client.js';

// Discovery
export {
  AgentDiscovery,
  type HubService,
  type AgentDiscoveryOptions,
  type AgentDiscoveryEvents,
} from './discovery.js';

// Handlers
export * from './handlers/index.js';

// Default export
export { AgentDaemon as default } from './daemon.js';

// Convenience function to create and start a daemon
export async function createAgent(options: import('./daemon.js').AgentDaemonOptions = {}) {
  const daemon = new (await import('./daemon.js')).AgentDaemon(options);
  await daemon.start();
  return daemon;
}
