// Agent Registry
export { AgentRegistry, getAgentRegistry, resetAgentRegistry } from './agent-registry';
export type { ConnectedAgent } from './agent-registry';

// Dashboard Registry (WebSocket)
export { DashboardRegistry, getDashboardRegistry, resetDashboardRegistry } from './dashboard-registry';
export type { DashboardClient } from './dashboard-registry';

// Instance Tracker
export { InstanceTracker, createInstanceTracker } from './instance-tracker';
export type { InstanceFilters } from './instance-tracker';
