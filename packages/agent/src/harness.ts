/**
 * The daemon-side harness abstraction (2026-08 rework).
 *
 * A harness is a plugin that turns one coding-agent runtime into cockpit's
 * neutral spine: it spawns sessions, translates their events into
 * {@link NeutralMessage} frames, parks permission requests under a `requestId`,
 * and answers the machine-scoped session catalog. The supervisor
 * ({@link ./session SessionSupervisor}) is harness-agnostic — it owns the git
 * worktrees, side-quest bookkeeping, busy tracking and the routing, and defers
 * to whichever {@link Harness} a spawn names.
 *
 * Adding a harness: implement {@link Harness}, register it in
 * `./harnesses/index.ts`, and if it ships new UI concepts, teach the dashboard's
 * folding layer about them (they arrive as `raw` frames until then).
 */
import type {
  AuthState,
  Envelope,
  FleetConfig,
  FleetSyncReport,
  HarnessCapabilities,
  HarnessKind,
  HarnessReport,
  NeutralMessage,
  NeutralSessionInfo,
  NeutralUserMessage,
  PermissionResult,
  PermissionUpdate,
  SessionMessage,
  SpawnPayload,
} from '@cockpit/core';
import type { SendPayload } from '@cockpit/core';

/** Everything a harness needs from the supervisor while it owns a session. */
export interface HarnessContext {
  readonly instanceId: string;
  /** The resolved working directory (after worktree / bootstrap). */
  readonly cwd: string;
  /** Ship one neutral frame toward the hub. */
  frame(message: NeutralMessage): void;
  /** Park a permission request; the supervisor forwards it and tracks the reply. */
  permission(request: {
    requestId: string;
    toolName: string;
    input: Record<string, unknown>;
    suggestions?: PermissionUpdate[];
    requestKind?: 'tool' | 'question';
  }): void;
  /** Whether a turn is in flight — the supervisor's busy set and drain read this. */
  busy(active: boolean): void;
  /** The harness's own session id, once the runtime names it. */
  session(sessionId: string): void;
  /** The session died of something the reader should see. */
  failed(error: unknown): void;
  /** The session's event loop ended; the supervisor drops its routing entry. */
  closed?(): void;
  /** Put an arbitrary envelope on the daemon's hub socket (hand-offs). */
  emit(envelope: Envelope): void;
}

/** One live session, owned by a harness. */
export interface HarnessSession {
  readonly harness: HarnessKind;
  /** The runtime's own session id, once known. */
  sessionId: string | null;
  /** Push one user turn into the session's prompt stream. */
  send(message: NeutralUserMessage, extras: Pick<SendPayload, 'attachments' | 'images' | 'urgent'>): void;
  /** A neutral control ({@link CONTROL_INTERRUPT}, …), mapped to the runtime. */
  control(method: string, args: unknown[]): Promise<unknown>;
  /** Settle a parked permission by its `requestId`. */
  resolvePermission(requestId: string, result: PermissionResult): void;
  /** Interrupt the current turn. */
  interrupt(): Promise<void>;
  /** End the session gracefully: unblock, interrupt, let the turn settle, close. */
  stop(): Promise<void>;
  /** Hard teardown, used on drain/shutdown. */
  dispose(): Promise<void>;
}

/** One harness adapter. Implemented per runtime; registered in `./harnesses`. */
export interface Harness {
  readonly kind: HarnessKind;
  readonly capabilities: HarnessCapabilities;
  /** What this machine can do with the harness — install, version, auth. */
  detect(): Promise<HarnessReport>;
  /** Start a session; resolves once the runtime handle is in place. */
  spawn(spec: SpawnPayload, ctx: HarnessContext): Promise<HarnessSession>;
  /** The stored sessions this harness can resume. */
  listSessions(dir?: string): Promise<NeutralSessionInfo[]>;
  getSessionInfo(sessionKey: string, dir?: string): Promise<NeutralSessionInfo | undefined>;
  getSessionMessages(sessionKey: string, dir?: string): Promise<SessionMessage[]>;
  renameSession(sessionKey: string, title: string, dir?: string): Promise<void>;
  tagSession(sessionKey: string, tag: string | null, dir?: string): Promise<void>;
  deleteSession(sessionKey: string, dir?: string): Promise<void>;
  /** A machine-scoped control this harness owns; `undefined` when it is not its word. */
  machine?(method: string, args: unknown[]): Promise<unknown> | undefined;
  /** Applies the hub's fleet config to this harness's own files; reports per entry. */
  syncFleet?(config: FleetConfig): Promise<FleetSyncReport>;
  /** What the harness has of what cockpit last put on it, without changing it. */
  fleetStatus?(): Promise<FleetSyncReport>;
  /** What `register` reports as this harness's auth, cached from {@link detect}. */
  auth: AuthState;
  dispose?(): Promise<void>;
}