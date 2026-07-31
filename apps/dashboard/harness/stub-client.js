/** Stands in for the live WS client so the rail can be server-rendered offline. */
const machines = [
  {
    machineId: 'm-mac',
    hostname: 'Omars-MacBook-Pro.local',
    os: 'darwin-arm64',
    status: 'online',
    lastSeenAt: new Date().toISOString(),
  },
  {
    machineId: 'm-obelisk',
    hostname: 'obelisk-of-light',
    os: 'linux-x64',
    status: 'online',
    lastSeenAt: new Date().toISOString(),
  },
];

export const cockpit = {
  machines,
  projects: [],
  scratchInstances: [],
  status: 'connected',
  blockedCount: 0,
  activityOf: () => 'idle',
  runningOn: () => [],
  catalogOf: () => [],
};

export function loadCatalog() {}
export function ensureConnected() {}
