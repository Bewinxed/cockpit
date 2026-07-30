/**
 * The session views are driven entirely by the hub WebSocket, which only exists
 * in the browser — and rendering them on the server would drag the legacy
 * layout's remote functions (pointed at the dead hub) into every request.
 */
export const ssr = false;
