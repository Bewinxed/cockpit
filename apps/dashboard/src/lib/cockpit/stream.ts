/**
 * The Ledger Protocol, client side — kept out of the runes module so it can be
 * reasoned about, and tested, on its own.
 *
 * Everything here is structural: it moves numbers and stages around a plain
 * object and calls out through {@link StreamHost} for the two things it cannot
 * do itself (apply a frame, re-read a transcript). `client.svelte.ts` owns the
 * runes binding and the socket; this file owns the decisions. The split follows
 * `queue.ts` — this repo's bun tests cannot import a `.svelte.ts` module, so
 * logic that has to be proven lives in a plain one.
 *
 * The rules it enforces, in one place:
 *
 * - A session's events are applied EXACTLY once, in order, with no holes. A
 *   delta one past the cursor applies; one at or behind it is a duplicate and
 *   is dropped; one beyond it is a hole, and a hole is never papered over —
 *   nothing is buffered and nothing is applied, the client re-subscribes from
 *   what it actually has and the hub replays the middle.
 * - A backlog is checked, not trusted: contiguous from the cursor or it is a
 *   protocol violation, said once and re-subscribed rather than half-applied.
 * - A reset is the hub admitting the gap is unrecoverable. The client re-reads
 *   history through the path it already has and follows from `nextSeq`.
 * - A command is a transaction with a stage the UI can read, and stages only
 *   ever move forward.
 */
import { STREAM_V1 } from '@cockpit/core';
import type {
  CommandAck,
  CommandEnvelope,
  CommandKind,
  SessionStreamEvent,
  StreamBacklog,
  StreamClientMessage,
  StreamDelta,
  StreamReset,
} from '@cockpit/core';

/** How long a submitted command may go unacknowledged before it is called off. */
export const COMMAND_ACK_TIMEOUT_MS = 15_000;

/** How many settled commands are kept for the UI to read back. */
export const SETTLED_COMMAND_LIMIT = 50;

/** How long a settled command stays readable before it is forgotten. */
export const SETTLED_COMMAND_TTL_MS = 5 * 60_000;

/**
 * How many times a gap may be re-subscribed before the client stops believing
 * the ring can heal it and asks for the history instead. Without this a hub
 * that answers every resume with the same unusable backlog is a livelock.
 */
export const MAX_RESYNC_ATTEMPTS = 3;

/** What the client knows about one session's place in its stream. */
export interface SessionCursor {
  /** The highest seq applied. Meaningless until {@link seen}. */
  lastSeq: number;
  /**
   * Whether any event has been applied. Before the first one the client has no
   * origin, so it adopts whatever seq the hub sends first rather than reading
   * `lastSeq = 0` as a hole back to the beginning of the session.
   */
  seen: boolean;
  /** A `stream.subscribe` for this session has gone out on the current socket. */
  subscribed: boolean;
  /**
   * The `afterSeq` of the resume that is out, or null when none is. One resume
   * per gap: a burst of fifty out-of-order deltas is one hole, not fifty.
   */
  resyncAfter: number | null;
  /** Consecutive resumes that failed to heal the gap — see {@link MAX_RESYNC_ATTEMPTS}. */
  resyncFailures: number;
  /** A protocol violation has been reported for this session; don't repeat it. */
  warned: boolean;
  /**
   * The frame kinds this session has actually received over the stream.
   *
   * The hub may keep sending a subscriber the legacy per-frame envelope as well
   * as the sequenced copy, and applying both would double every turn. But only
   * SOME frames go through the per-session relay the stream wraps: a transcript
   * frame is relayed to that session's subscribers, while pulses, permission
   * requests, errors, instance lists and usage all broadcast. Assuming the
   * stream owns everything with an instance id on it would therefore starve the
   * rail of half of what it renders, forever.
   *
   * So it is learnt instead: a kind that has actually arrived on the stream for
   * this session is a kind the legacy path no longer needs to deliver for it.
   * The cost is at most one duplicated frame per kind per connection, and only
   * against a hub that sends both copies; the alternative's cost is silence.
   */
  streamed: Set<string>;
}

export type CommandStage = 'submitted' | 'accepted' | 'applied' | 'failed';

/** One operator action, from the click to the hub's last word on it. */
export interface CommandRecord {
  commandId: string;
  sessionId: string;
  kind: CommandKind;
  stage: CommandStage;
  /** When it was submitted. */
  at: number;
  /** When the stage last moved — what pruning and "how long has this been out" read. */
  changedAt: number;
  reason?: string;
  /** The stream-dialect local half still owed an outcome; see {@link StreamEffects}. */
  effects?: StreamEffects;
}

/** Everything the stream half of the store keeps. Plain data, so a runes module can `$state` it. */
export interface StreamState {
  /** The hub has advertised {@link STREAM_V1} on this connection. */
  capable: boolean;
  cursors: Record<string, SessionCursor>;
  commands: Record<string, CommandRecord>;
}

/** The two things the logic cannot do itself, plus its clock and its voice. */
export interface StreamHost {
  /**
   * THE CHOKEPOINT. Apply one relay frame to the session it belongs to —
   * the same function the legacy per-frame path calls, given the unwrapped
   * frame. The stream orders; it does not reshape.
   */
  applyFrame(sessionId: string, frame: unknown): void;
  /** Re-read this session's transcript through the path that already exists. */
  rereadHistory(sessionId: string): void;
  /** Put a client message on the dashboard socket; false when it is not open. */
  sendToHub(message: StreamClientMessage): boolean;
  now(): number;
  warn(message: string, detail?: unknown): void;
}

export function createStreamState(): StreamState {
  return { capable: false, cursors: {}, commands: {} };
}

function newCursor(): SessionCursor {
  return {
    lastSeq: 0,
    seen: false,
    subscribed: false,
    resyncAfter: null,
    resyncFailures: 0,
    warned: false,
    streamed: new Set(),
  };
}

function cursorFor(state: StreamState, sessionId: string): SessionCursor {
  // Written then read back: under `$state` the write lands on the proxy, and
  // holding the literal would file every later mutation where nothing sees it.
  state.cursors[sessionId] ??= newCursor();
  return state.cursors[sessionId];
}

/* ------------------------------------------------------------------ *
 * Capability
 * ------------------------------------------------------------------ */

/**
 * Feature-detection, deliberately blind to WHICH message carries the flag.
 *
 * The hub adds `capabilities` to whichever existing dashboard message a new
 * subscriber happens to receive first, and the two ends are built in parallel:
 * depending on that choice would couple them. Any inbound message carrying an
 * array with {@link STREAM_V1} in it is the handshake.
 *
 * Returns true only on the flip, so the caller can subscribe the sessions that
 * were already open — capability can arrive long after frames have been
 * flowing down the legacy path, and the switch has to be clean either way.
 */
export function noteCapabilities(state: StreamState, message: unknown): boolean {
  if (state.capable) return false;
  if (!carriesStreamV1(message)) return false;
  state.capable = true;
  return true;
}

/**
 * Whether this message advertises {@link STREAM_V1} — at its top level OR one
 * nesting level down. The hub attaches `capabilities` to the `instances`
 * frame's PAYLOAD (the only place a legacy dashboard already parses), while a
 * future message may carry it at the top; "blind to which message" has to mean
 * blind to the nesting too, or the handshake silently never fires against the
 * real hub (defect E-1, caught by the stream e2e suite).
 */
function carriesStreamV1(message: unknown): boolean {
  if (typeof message !== 'object' || message === null) return false;
  const { capabilities, payload } = message as { capabilities?: unknown; payload?: unknown };
  if (Array.isArray(capabilities) && capabilities.includes(STREAM_V1)) return true;
  if (typeof payload !== 'object' || payload === null) return false;
  const nested = (payload as { capabilities?: unknown }).capabilities;
  return Array.isArray(nested) && nested.includes(STREAM_V1);
}

/**
 * Whether the stream has taken over delivery of this kind of frame for this
 * session — i.e. whether the legacy copy of it is now a duplicate. See
 * {@link SessionCursor.streamed} for why this is learnt rather than assumed.
 */
export function streamCarries(state: StreamState, sessionId: string, kind: string): boolean {
  if (!state.capable) return false;
  const cursor = state.cursors[sessionId];
  return !!cursor && cursor.subscribed && cursor.streamed.has(kind);
}

/* ------------------------------------------------------------------ *
 * Subscriptions
 * ------------------------------------------------------------------ */

/**
 * Subscribes a session's stream: a resume when this client already has a
 * cursor (the hub replays the middle out of its ring, or refuses honestly with
 * a reset), a fresh join when it does not.
 */
export function subscribeSession(state: StreamState, host: StreamHost, sessionId: string): void {
  const cursor = cursorFor(state, sessionId);
  const afterSeq = cursor.seen ? cursor.lastSeq : undefined;
  const sent = host.sendToHub({
    type: 'stream.subscribe',
    sessionId,
    ...(afterSeq === undefined ? {} : { afterSeq }),
  });
  if (!sent) return;
  cursor.subscribed = true;
  // A resume IS an outstanding resync: a delta that lands ahead of the replay
  // must not send a second one for the same hole.
  cursor.resyncAfter = afterSeq ?? null;
}

/**
 * Brings the subscribed set into line with what the dashboard is watching:
 * subscribes what is new, forgets what has been closed.
 *
 * Forgetting drops the cursor with it, so a session re-opened later joins fresh
 * rather than resuming from a seq the ring has long since dropped — the reset
 * that would answer that resume costs a whole transcript re-read.
 */
export function syncStreamSubscriptions(
  state: StreamState,
  host: StreamHost,
  sessionIds: string[]
): void {
  if (!state.capable) return;
  const wanted = new Set(sessionIds);
  for (const sessionId of Object.keys(state.cursors)) {
    if (!wanted.has(sessionId)) delete state.cursors[sessionId];
  }
  for (const sessionId of wanted) {
    const cursor = state.cursors[sessionId];
    if (cursor?.subscribed) continue;
    subscribeSession(state, host, sessionId);
  }
}

/**
 * The socket dropped.
 *
 * Cursors keep their `lastSeq` — that number is the whole point of the ring,
 * and the reconnect resumes from it — but every subscription and every resume
 * died with the connection, and so did any acknowledgement still owed. The
 * capability is re-advertised by the new connection, so it is dropped too: until
 * it arrives the legacy path is the honest one.
 */
export function noteDisconnect(state: StreamState, now: number): void {
  state.capable = false;
  for (const cursor of Object.values(state.cursors)) {
    cursor.subscribed = false;
    cursor.resyncAfter = null;
    // The stream is not delivering anything right now, so it owns nothing:
    // the legacy path must be free to feed the session again.
    cursor.streamed.clear();
  }
  for (const record of Object.values(state.commands)) {
    if (isSettled(record.stage)) continue;
    // Through advanceStage, not a raw write: a dying socket is a settling like
    // any other, and an optimistic value whose command it took down must roll
    // back here exactly as it would on a refusal.
    advanceStage(record, 'failed', now, 'The connection to the hub dropped before that finished.');
  }
}

/* ------------------------------------------------------------------ *
 * Ingestion
 * ------------------------------------------------------------------ */

const STREAM_MESSAGE_TYPES = new Set([
  'stream.event',
  'stream.backlog',
  'stream.reset',
  'command.ack',
]);

/**
 * Takes one inbound socket message if it belongs to this protocol, and says so.
 * A message it does not take is the caller's legacy business, untouched.
 *
 * Receiving one of these at all is itself evidence the hub speaks the protocol,
 * so it flips the flag: a client that missed the handshake message still ends
 * up in the right mode rather than ingesting a stream it does not believe in.
 */
export function handleStreamMessage(
  state: StreamState,
  host: StreamHost,
  message: unknown
): boolean {
  if (typeof message !== 'object' || message === null) return false;
  const type = (message as { type?: unknown }).type;
  if (typeof type !== 'string' || !STREAM_MESSAGE_TYPES.has(type)) return false;
  state.capable = true;

  switch (type) {
    case 'stream.event':
      applyDelta(state, host, message as StreamDelta);
      return true;
    case 'stream.backlog':
      applyBacklog(state, host, message as StreamBacklog);
      return true;
    case 'stream.reset':
      applyReset(state, host, message as StreamReset);
      return true;
    case 'command.ack':
      noteCommandAck(state, message as CommandAck, host.now());
      return true;
    default:
      return false;
  }
}

/** What a delta did, for tests and for anyone reading a trace. */
export type DeltaOutcome = 'applied' | 'duplicate' | 'gap' | 'malformed';

function applyDelta(state: StreamState, host: StreamHost, message: StreamDelta): DeltaOutcome {
  const event = message.event;
  if (!event || typeof event.seq !== 'number' || typeof event.sessionId !== 'string') {
    host.warn('stream: a delta arrived without a sequenced event', message);
    return 'malformed';
  }
  const cursor = cursorFor(state, event.sessionId);

  // No origin yet: the hub's first word IS the origin. Reading `lastSeq = 0` as
  // a hole here would make every late join demand a replay of a whole session.
  if (!cursor.seen) cursor.lastSeq = event.seq - 1;

  if (event.seq <= cursor.lastSeq) return 'duplicate';

  if (event.seq > cursor.lastSeq + 1) {
    // A hole. Nothing is applied and NOTHING IS BUFFERED: the replay the resume
    // asks for carries these events again, and a buffer here would be a second,
    // slower copy of the hub's ring with its own bugs.
    requestResync(host, event.sessionId, cursor);
    return 'gap';
  }

  applyEvent(host, cursor, event);
  return 'applied';
}

function applyEvent(host: StreamHost, cursor: SessionCursor, event: SessionStreamEvent): void {
  const frame = event.frame;
  if (typeof frame === 'object' && frame !== null) {
    const kind = (frame as { kind?: unknown }).kind;
    if (typeof kind === 'string') cursor.streamed.add(kind);
    host.applyFrame(event.sessionId, frame);
  } else if (!cursor.warned) {
    // A sequenced event the hub could not fill. The cursor still advances: this
    // seq happened, and refusing to move past it would turn one empty event
    // into a permanent hole and an endless resume.
    cursor.warned = true;
    host.warn(`stream: an event arrived with no frame for ${event.sessionId}`, event.seq);
  }
  cursor.lastSeq = event.seq;
  cursor.seen = true;
  // A session the hub is streaming to us is one it considers subscribed, even
  // if this tab has not yet sent the subscribe that says so.
  cursor.subscribed = true;
}

/** Asks for the replay, once per hole. */
function requestResync(host: StreamHost, sessionId: string, cursor: SessionCursor): void {
  if (cursor.resyncAfter === cursor.lastSeq) return;
  const sent = host.sendToHub({ type: 'stream.subscribe', sessionId, afterSeq: cursor.lastSeq });
  // A resume that never left cannot be waited for: leaving `resyncAfter` unset
  // means the next delta through the hole tries again.
  if (!sent) return;
  cursor.subscribed = true;
  cursor.resyncAfter = cursor.lastSeq;
}

function applyBacklog(state: StreamState, host: StreamHost, message: StreamBacklog): void {
  const sessionId = message.sessionId;
  const events = Array.isArray(message.events) ? message.events : [];
  const cursor = cursorFor(state, sessionId);
  cursor.subscribed = true;

  if (events.length === 0) {
    // "Nothing to replay" is a complete answer, and a healed one.
    cursor.resyncAfter = null;
    cursor.resyncFailures = 0;
    return;
  }

  if (!cursor.seen) cursor.lastSeq = events[0].seq - 1;

  let broken = false;
  for (const event of events) {
    // A backlog re-sent after a retried resume repeats what is already applied.
    // Dropping by seq is what makes that harmless rather than a doubled turn.
    if (event.seq <= cursor.lastSeq) continue;
    if (event.seq !== cursor.lastSeq + 1) {
      broken = true;
      break;
    }
    applyEvent(host, cursor, event);
  }

  if (!broken) {
    cursor.resyncAfter = null;
    cursor.resyncFailures = 0;
    cursor.warned = false;
    return;
  }

  // The hub promised contiguity and did not deliver it. Say it once — a broken
  // hub would otherwise fill the console faster than anyone can read it — keep
  // the prefix that WAS contiguous, and ask again from there.
  if (!cursor.warned) {
    cursor.warned = true;
    host.warn(`stream: non-contiguous backlog for ${sessionId}`, {
      lastSeq: cursor.lastSeq,
      seqs: events.map((event) => event.seq),
    });
  }
  cursor.resyncFailures += 1;
  cursor.resyncAfter = null;
  if (cursor.resyncFailures >= MAX_RESYNC_ATTEMPTS) {
    // The ring cannot heal this. Stop asking it to and go and read the truth,
    // exactly as a reset would have us do.
    cursor.resyncFailures = 0;
    cursor.seen = false;
    cursor.streamed.clear();
    host.rereadHistory(sessionId);
    subscribeSession(state, host, sessionId);
    return;
  }
  requestResync(host, sessionId, cursor);
}

/**
 * The hub's honest refusal: the gap is older than its ring, so there is nothing
 * to replay. The client re-reads history through the path it already has and
 * follows from `nextSeq`.
 *
 * The cursor moves to `nextSeq - 1` BEFORE the re-read is asked for, so live
 * deltas racing the read are contiguous and apply immediately. That is not a
 * race the store has to referee: the existing backfill holds frames that arrive
 * while it is reading and replays them behind the transcript, deduplicated by
 * uuid — the same discipline every other late join uses.
 */
function applyReset(state: StreamState, host: StreamHost, message: StreamReset): void {
  const cursor = cursorFor(state, message.sessionId);
  cursor.lastSeq = message.nextSeq - 1;
  cursor.seen = true;
  cursor.subscribed = true;
  cursor.resyncAfter = null;
  cursor.resyncFailures = 0;
  cursor.warned = false;
  host.rereadHistory(message.sessionId);
}

/* ------------------------------------------------------------------ *
 * Commands
 * ------------------------------------------------------------------ */

const isSettled = (stage: CommandStage): boolean => stage === 'applied' || stage === 'failed';

/** Which stage may follow which. Terminal is terminal: a late ack cannot undo it. */
const NEXT_STAGES: Record<CommandStage, Set<CommandStage>> = {
  submitted: new Set<CommandStage>(['accepted', 'applied', 'failed']),
  accepted: new Set<CommandStage>(['applied', 'failed']),
  applied: new Set<CommandStage>(),
  failed: new Set<CommandStage>(),
};

/**
 * Moves a command forward, or leaves it alone. Acks can overtake each other on
 * the wire — an `accepted` landing after the `applied` it preceded must not
 * walk the composer's "Landed." back to "Applying…".
 */
function advanceStage(
  record: CommandRecord,
  stage: CommandStage,
  now: number,
  reason?: string
): boolean {
  if (!NEXT_STAGES[record.stage].has(stage)) return false;
  record.stage = stage;
  record.changedAt = now;
  if (reason !== undefined) record.reason = reason;
  // Stream-dialect records carry the LOCAL half of their operation (see
  // {@link CommandSubmission.streamEffects}); settling is when its outcome
  // hooks run — including a timeout-swept failure, which must roll back an
  // optimistic value exactly like a refused one.
  if (record.effects && (stage === 'applied' || stage === 'failed')) {
    const settled = record.effects.settled;
    record.effects = undefined;
    settled?.(stage, record.reason);
  }
  return true;
}

/**
 * The LOCAL half of a command, on the stream dialect only.
 *
 * Every legacy relay function is really two halves — the wire call, and the
 * local bookkeeping around it (the send's transcript echo and busy flip, the
 * interrupt's busy clear, the answered permission leaving `pending`, a
 * setting's optimistic value with rollback-on-refusal). `wirePayload` extracts
 * only the wire half; a stream dialect that dispatches the envelope and skips
 * the local half renders NOTHING for a sent message — the defect this type
 * repairs. The legacy branch never reads these: its `legacy()` thunk is the
 * whole original function and already owns its own bookkeeping.
 */
export interface StreamEffects {
  /** Runs once, when the envelope is dispatched (before any ack). */
  submitted?: () => void;
  /** Runs once, when the record settles — ack, refusal, or timeout sweep. */
  settled?: (stage: 'applied' | 'failed', reason?: string) => void;
}

export interface CommandSubmission {
  commandId: string;
  sessionId: string;
  machineId: string;
  kind: CommandKind;
  /** Exactly the payload the corresponding relay op takes today. */
  payload: unknown;
  /**
   * What to do instead when the hub does not speak the protocol: today's call,
   * unchanged. Its own promise semantics are the stages — a synchronous return
   * is `accepted` (the send went out), a resolved promise is `applied` (the
   * daemon answered), a throw or rejection is `failed`.
   */
  legacy: () => void | Promise<unknown>;
  /** The command's local half, applied on the STREAM branch only. */
  streamEffects?: StreamEffects;
}

/**
 * Submits one operator action as a tracked transaction and returns its id.
 *
 * Never throws: the stage IS the report, which is the point of the tracker —
 * a caller that wants the failure reads it off the record rather than wrapping
 * the call. Existing callers are untouched; this is an additive path.
 */
export function submitCommand(
  state: StreamState,
  host: StreamHost,
  submission: CommandSubmission
): string {
  const { commandId, sessionId, machineId, kind, payload } = submission;
  const now = host.now();
  state.commands[commandId] = {
    commandId,
    sessionId,
    kind,
    stage: 'submitted',
    at: now,
    changedAt: now,
  };
  const record = state.commands[commandId];

  if (state.capable) {
    const envelope: CommandEnvelope = {
      type: 'command',
      commandId,
      sessionId,
      machineId,
      kind,
      payload,
    };
    // The local half rides the record so every settling path — ack, refusal,
    // timeout sweep — runs its outcome hook exactly once. Applied BEFORE the
    // send, so a dispatch that fails synchronously still settles it (the
    // rollback below the failure).
    record.effects = submission.streamEffects;
    submission.streamEffects?.submitted?.();
    if (!host.sendToHub(envelope)) {
      advanceStage(record, 'failed', now, 'Not connected to the hub. Check that it is running, then try again.');
    }
    sweepCommands(state, now);
    return commandId;
  }

  try {
    const result = submission.legacy();
    if (result instanceof Promise) {
      result.then(
        () => advanceStage(record, 'applied', host.now()),
        (error: unknown) => advanceStage(record, 'failed', host.now(), messageOf(error))
      );
    } else {
      // Nothing further will be said about it: the legacy relay ops that return
      // nothing are fire-and-forget, and claiming `applied` for one would be the
      // fabrication this protocol exists to remove.
      advanceStage(record, 'accepted', now);
    }
  } catch (error) {
    advanceStage(record, 'failed', now, messageOf(error));
  }
  sweepCommands(state, now);
  return commandId;
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Folds the hub's word on a command in. Acks for commands this tab never sent are not ours. */
export function noteCommandAck(state: StreamState, ack: CommandAck, now: number): boolean {
  const record = state.commands[ack.commandId];
  if (!record) return false;
  return advanceStage(record, ack.stage, now, ack.reason);
}

/**
 * Keeps the tracker bounded, and calls off commands nothing ever answered.
 *
 * A tab left open for a week must not accumulate a record per keystroke-sent
 * message, and a spinner that spins forever is worse than a stated failure — so
 * settled records age out by count and by time, and an unsettled one that has
 * been out longer than a control call is allowed to take is failed with a
 * reason a human can read.
 */
export function sweepCommands(state: StreamState, now: number): void {
  const settled: CommandRecord[] = [];
  for (const record of Object.values(state.commands)) {
    if (!isSettled(record.stage)) {
      if (now - record.at >= COMMAND_ACK_TIMEOUT_MS) {
        advanceStage(record, 'failed', now, 'The hub never acknowledged that.');
        settled.push(record);
      }
      continue;
    }
    if (now - record.changedAt >= SETTLED_COMMAND_TTL_MS) {
      delete state.commands[record.commandId];
      continue;
    }
    settled.push(record);
  }
  if (settled.length <= SETTLED_COMMAND_LIMIT) return;
  settled.sort((a, b) => a.changedAt - b.changedAt);
  for (const record of settled.slice(0, settled.length - SETTLED_COMMAND_LIMIT)) {
    delete state.commands[record.commandId];
  }
}

/** Every command this tab has submitted for a session, oldest first. */
export function sessionCommands(state: StreamState, sessionId: string): CommandRecord[] {
  return Object.values(state.commands)
    .filter((record) => record.sessionId === sessionId)
    .sort((a, b) => a.at - b.at);
}

/**
 * The newest command of one kind on one session — what a control reads to know
 * whether the thing it just asked for has landed.
 */
export function latestCommand(
  state: StreamState,
  sessionId: string,
  kind: CommandKind
): CommandRecord | null {
  let latest: CommandRecord | null = null;
  for (const record of Object.values(state.commands)) {
    if (record.sessionId !== sessionId || record.kind !== kind) continue;
    if (!latest || record.at >= latest.at) latest = record;
  }
  return latest;
}

/**
 * Whether THIS client interrupted the session moments ago — the classifier
 * that turns the SDK's `result.error` receipt of a deliberate stop into a
 * quiet "Interrupted" line instead of a failure card. The command records are
 * the memory: any interrupt on the session inside the window that was not
 * refused counts. Only this client's own stops are recognisable — another
 * device's interrupt still reads as an error here until the daemon tags the
 * result itself (protocol v2, noted in the plan).
 */
export function interruptedRecently(
  state: StreamState,
  sessionId: string,
  now: number,
  windowMs = 15_000
): boolean {
  for (const record of Object.values(state.commands)) {
    if (record.kind !== 'interrupt' || record.sessionId !== sessionId) continue;
    if (record.stage === 'failed') continue;
    if (now - record.at <= windowMs) return true;
  }
  return false;
}
