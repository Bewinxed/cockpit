/**
 * The daemon-side harness abstraction (2026-08 rework).
 *
 * A harness is a plugin that turns one coding-agent runtime into whiffle's
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
  SendPayload,
  SessionMessage,
  SpawnPayload,
} from "@whiffle/core";

/** Everything a harness needs from the supervisor while it owns a session. */
export interface HarnessContext {
  /** Whether a turn is in flight — the supervisor's busy set and drain read this. */
  // biome-ignore lint/style/useConsistentMethodSignatures: method-style kept so implementers (opencode.ts, pi.ts) keep contravariant parameter checking; property-style would change signature variance
  busy(active: boolean): void;
  /** The session's event loop ended; the supervisor drops its routing entry. */
  // biome-ignore lint/style/useConsistentMethodSignatures: method-style kept so implementers (opencode.ts, pi.ts) keep contravariant parameter checking; property-style would change signature variance
  closed?(): void;
  /** The resolved working directory (after worktree / bootstrap). */
  readonly cwd: string;
  /** Put an arbitrary envelope on the daemon's hub socket (hand-offs). */
  // biome-ignore lint/style/useConsistentMethodSignatures: method-style kept so implementers (opencode.ts, pi.ts) keep contravariant parameter checking; property-style would change signature variance
  emit(envelope: Envelope): void;
  /** The session died of something the reader should see. */
  // biome-ignore lint/style/useConsistentMethodSignatures: method-style kept so implementers (opencode.ts, pi.ts) keep contravariant parameter checking; property-style would change signature variance
  failed(error: unknown): void;
  /** Ship one neutral frame toward the hub. */
  // biome-ignore lint/style/useConsistentMethodSignatures: method-style kept so implementers (opencode.ts, pi.ts) keep contravariant parameter checking; property-style would change signature variance
  frame(message: NeutralMessage): void;
  readonly instanceId: string;
  /** Park a permission request; the supervisor forwards it and tracks the reply. */
  // biome-ignore lint/style/useConsistentMethodSignatures: method-style kept so implementers (opencode.ts, pi.ts) keep contravariant parameter checking; property-style would change signature variance
  permission(request: {
    requestId: string;
    toolName: string;
    input: Record<string, unknown>;
    suggestions?: PermissionUpdate[];
    requestKind?: "tool" | "question";
  }): void;
  /** The harness's own session id, once the runtime names it. */
  // biome-ignore lint/style/useConsistentMethodSignatures: method-style kept so implementers (opencode.ts, pi.ts) keep contravariant parameter checking; property-style would change signature variance
  session(sessionId: string): void;
}

/** One live session, owned by a harness. */
export interface HarnessSession {
  /** A neutral control ({@link CONTROL_INTERRUPT}, …), mapped to the runtime. */
  // biome-ignore lint/style/useConsistentMethodSignatures: method-style kept so implementers (opencode.ts, pi.ts) keep contravariant parameter checking; property-style would change signature variance
  control(method: string, args: unknown[]): Promise<unknown>;
  /** Hard teardown, used on drain/shutdown. */
  // biome-ignore lint/style/useConsistentMethodSignatures: method-style kept so implementers (opencode.ts, pi.ts) keep contravariant parameter checking; property-style would change signature variance
  dispose(): Promise<void>;
  readonly harness: HarnessKind;
  /** Interrupt the current turn. */
  // biome-ignore lint/style/useConsistentMethodSignatures: method-style kept so implementers (opencode.ts, pi.ts) keep contravariant parameter checking; property-style would change signature variance
  interrupt(): Promise<void>;
  /** Settle a parked permission by its `requestId`. */
  // biome-ignore lint/style/useConsistentMethodSignatures: method-style kept so implementers (opencode.ts, pi.ts) keep contravariant parameter checking; property-style would change signature variance
  resolvePermission(requestId: string, result: PermissionResult): void;
  /** Push one user turn into the session's prompt stream. */
  // biome-ignore lint/style/useConsistentMethodSignatures: method-style kept so implementers (opencode.ts, pi.ts) keep contravariant parameter checking; property-style would change signature variance
  send(
    message: NeutralUserMessage,
    extras: Pick<SendPayload, "attachments" | "images" | "urgent">
  ): void;
  /** The runtime's own session id, once known. */
  sessionId: string | null;
  /** End the session gracefully: unblock, interrupt, let the turn settle, close. */
  // biome-ignore lint/style/useConsistentMethodSignatures: method-style kept so implementers (opencode.ts, pi.ts) keep contravariant parameter checking; property-style would change signature variance
  stop(): Promise<void>;
}

/** One harness adapter. Implemented per runtime; registered in `./harnesses`. */
export interface Harness {
  /** What `register` reports as this harness's auth, cached from {@link detect}. */
  auth: AuthState;
  readonly capabilities: HarnessCapabilities;
  // biome-ignore lint/style/useConsistentMethodSignatures: method-style kept so implementers (opencode.ts, pi.ts) keep contravariant parameter checking; property-style would change signature variance
  deleteSession(sessionKey: string, dir?: string): Promise<void>;
  /** What this machine can do with the harness — install, version, auth. */
  // biome-ignore lint/style/useConsistentMethodSignatures: method-style kept so implementers (opencode.ts, pi.ts) keep contravariant parameter checking; property-style would change signature variance
  detect(): Promise<HarnessReport>;
  // biome-ignore lint/style/useConsistentMethodSignatures: method-style kept so implementers (opencode.ts, pi.ts) keep contravariant parameter checking; property-style would change signature variance
  dispose?(): Promise<void>;
  /** What the harness has of what whiffle last put on it, without changing it. */
  // biome-ignore lint/style/useConsistentMethodSignatures: method-style kept so implementers (opencode.ts, pi.ts) keep contravariant parameter checking; property-style would change signature variance
  fleetStatus?(): Promise<FleetSyncReport>;
  // biome-ignore lint/style/useConsistentMethodSignatures: method-style kept so implementers (opencode.ts, pi.ts) keep contravariant parameter checking; property-style would change signature variance
  getSessionInfo(
    sessionKey: string,
    dir?: string
  ): Promise<NeutralSessionInfo | undefined>;
  // biome-ignore lint/style/useConsistentMethodSignatures: method-style kept so implementers (opencode.ts, pi.ts) keep contravariant parameter checking; property-style would change signature variance
  getSessionMessages(
    sessionKey: string,
    dir?: string
  ): Promise<SessionMessage[]>;
  readonly kind: HarnessKind;
  /** The stored sessions this harness can resume. */
  // biome-ignore lint/style/useConsistentMethodSignatures: method-style kept so implementers (opencode.ts, pi.ts) keep contravariant parameter checking; property-style would change signature variance
  listSessions(dir?: string): Promise<NeutralSessionInfo[]>;
  /** A machine-scoped control this harness owns; `undefined` when it is not its word. */
  // biome-ignore lint/style/useConsistentMethodSignatures: method-style kept so implementers (opencode.ts, pi.ts) keep contravariant parameter checking; property-style would change signature variance
  machine?(method: string, args: unknown[]): Promise<unknown> | undefined;
  // biome-ignore lint/style/useConsistentMethodSignatures: method-style kept so implementers (opencode.ts, pi.ts) keep contravariant parameter checking; property-style would change signature variance
  renameSession(sessionKey: string, title: string, dir?: string): Promise<void>;
  /** Start a session; resolves once the runtime handle is in place. */
  // biome-ignore lint/style/useConsistentMethodSignatures: method-style kept so implementers (opencode.ts, pi.ts) keep contravariant parameter checking; property-style would change signature variance
  spawn(spec: SpawnPayload, ctx: HarnessContext): Promise<HarnessSession>;
  /** Applies the hub's fleet config to this harness's own files; reports per entry. */
  // biome-ignore lint/style/useConsistentMethodSignatures: method-style kept so implementers (opencode.ts, pi.ts) keep contravariant parameter checking; property-style would change signature variance
  syncFleet?(config: FleetConfig): Promise<FleetSyncReport>;
  // biome-ignore lint/style/useConsistentMethodSignatures: method-style kept so implementers (opencode.ts, pi.ts) keep contravariant parameter checking; property-style would change signature variance
  tagSession(
    sessionKey: string,
    tag: string | null,
    dir?: string
  ): Promise<void>;
}
