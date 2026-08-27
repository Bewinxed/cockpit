/**
 * The Ledger Protocol: one canonical, ordered event stream per session, and
 * every operator action an acknowledged transaction.
 *
 * WHY (JOURNEY.md, cross-cutting error state): "an empty surface must assert
 * that the connection is live before it is allowed to claim zero" — and its
 * generalisation: a client must never render a guess as truth. The dashboard's
 * historical failure class (fabricated echoes, invented timestamps, banners on
 * healthy connects, seams like `absorbLive` reconciling client guesses with
 * server state) all follow from state being duplicated or inferred client-side.
 * This protocol removes the inference: the hub assigns each session a monotonic
 * sequence, clients follow it gap-free or resynchronise explicitly, and
 * commands carry ids the hub acknowledges stage by stage.
 *
 * Compatibility is capability-negotiated: a hub that speaks this advertises
 * {@link STREAM_V1}; a client that does not see it uses the legacy paths
 * unchanged. Every shape here is additive — no existing wire type changes.
 */

/** Capability string a stream-speaking hub advertises in its handshake. */
export const STREAM_V1 = 'stream.v1';

/**
 * One event on a session's canonical stream. `seq` is hub-assigned, monotonic
 * per session, starting at 1 — and NO GAP is ever delivered: a client that
 * observes `seq > lastSeq + 1` re-subscribes with `afterSeq = lastSeq` instead
 * of applying the delta.
 */
export interface SessionStreamEvent {
  seq: number;
  /** The instance id — what the dashboard calls a viewId. */
  sessionId: string;
  /** The existing relay frame payload, verbatim. The stream orders; it does not reshape. */
  frame: unknown;
}

/**
 * Client → hub. `afterSeq` present is a resume ("I have up to here — replay the
 * rest"); absent is a fresh join ("start me from now", history arriving through
 * the existing read paths as today).
 */
export interface StreamSubscribe {
  type: 'stream.subscribe';
  sessionId: string;
  afterSeq?: number;
}

/**
 * Hub → client when the requested gap is inside its ring: events contiguous
 * ascending from `afterSeq + 1`. The client applies them in order, then
 * follows live deltas.
 */
export interface StreamBacklog {
  type: 'stream.backlog';
  sessionId: string;
  events: SessionStreamEvent[];
}

/**
 * Hub → client when the gap is unrecoverable (older than the ring holds):
 * an honest refusal, never a partial replay. The client re-reads history
 * through the existing paths, then follows from `nextSeq`.
 */
export interface StreamReset {
  type: 'stream.reset';
  sessionId: string;
  nextSeq: number;
}

/** Hub → client, live fan-out of one sequenced event. */
export interface StreamDelta {
  type: 'stream.event';
  event: SessionStreamEvent;
}

/** The operations a command envelope can carry — 1:1 with existing relay ops. */
export type CommandKind =
  | 'send'
  | 'permission.answer'
  | 'interrupt'
  | 'set-model'
  | 'set-permission-mode'
  | 'set-effort';

/**
 * Client → hub: an operator action as a durable, trackable object rather than
 * a fire-and-forget call. `commandId` is client-generated and unique per
 * submission; `payload` is exactly what the corresponding legacy relay
 * operation takes today.
 */
export interface CommandEnvelope {
  type: 'command';
  commandId: string;
  sessionId: string;
  machineId: string;
  kind: CommandKind;
  payload: unknown;
}

/**
 * Hub → client, the command's lifecycle:
 * - `accepted` — validated, the target daemon reachable, dispatched;
 * - `applied`  — the daemon confirmed, where its protocol carries a
 *   confirmation today; where it does not, the hub stops at `accepted` and
 *   the stream event reflecting the change is the proof of application;
 * - `failed`   — terminal, with the reason a human can read.
 */
export interface CommandAck {
  type: 'command.ack';
  commandId: string;
  stage: 'accepted' | 'applied' | 'failed';
  reason?: string;
}

/** Everything the stream protocol can put on the dashboard socket. */
export type StreamServerMessage = StreamBacklog | StreamReset | StreamDelta | CommandAck;
export type StreamClientMessage = StreamSubscribe | CommandEnvelope;
