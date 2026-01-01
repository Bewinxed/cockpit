/**
 * Dashboard configuration
 */

// Hub API URL - in production this would be configured via environment
export const HUB_URL = import.meta.env.VITE_HUB_URL || 'http://localhost:3456';

// SSE reconnection settings
export const SSE_RECONNECT_MAX_ATTEMPTS = 10;
export const SSE_RECONNECT_BASE_DELAY = 1000;
export const SSE_RECONNECT_MAX_DELAY = 30000;
