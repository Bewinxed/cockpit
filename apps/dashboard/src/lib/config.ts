/**
 * Dashboard configuration
 */

// WebSocket reconnection settings
export const WS_RECONNECT_MAX_ATTEMPTS = 10;
export const WS_RECONNECT_BASE_DELAY = 1000;
export const WS_RECONNECT_MAX_DELAY = 30000;

/** How many stored sessions per machine the sidebar asks `listSessions` for. */
export const SESSION_CATALOG_LIMIT = 25;

/** How long a control call waits for the frame that answers its `requestId`. */
export const CONTROL_TIMEOUT_MS = 15000;

/** Discarding a side quest removes a git worktree, which is slower disk work. */
export const DISCARD_TIMEOUT_MS = 30000;
