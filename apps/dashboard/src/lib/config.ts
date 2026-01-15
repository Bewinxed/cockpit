/**
 * Dashboard configuration
 */

// API URL - uses the SvelteKit backend as a proxy to the hub
// This avoids CORS issues and works in cloud IDEs
export const HUB_URL = '';

// WebSocket reconnection settings
export const WS_RECONNECT_MAX_ATTEMPTS = 10;
export const WS_RECONNECT_BASE_DELAY = 1000;
export const WS_RECONNECT_MAX_DELAY = 30000;
