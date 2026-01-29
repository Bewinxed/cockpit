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

// Persistent session types
export {
  type SettingSource,
  type PersistentSessionOptions,
  type CanUseTool,
  type CanUseToolOptions,
  type PermissionResult,
  type RewindFilesResult,
} from './persistent-session.js';

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

// Convenience function to create and start a daemon
export async function createAgent(options: import('./daemon.js').AgentDaemonOptions = {}) {
  const { AgentDaemon } = await import('./daemon.js');
  const daemon = new AgentDaemon(options);
  await daemon.start();
  return daemon;
}
