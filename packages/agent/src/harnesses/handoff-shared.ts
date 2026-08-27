/**
 * The hand-off tools' shared logic, apart from any harness.
 *
 * A session hands work to another session through six tools — list the fleet,
 * hand a note to a peer, start a new session, delegate to a sub-session, and
 * stop or interrupt one of its own delegates — and their bodies are the same
 * whichever harness exposes them: the roster is read off the hub over HTTP, the
 * note is an envelope the daemon already knows how to send. Each harness wraps
 * these in its own tool mechanism (claude's in-process MCP server, pi's
 * `customTools`), and this file is the body they share.
 */
import type {
  Envelope,
  InstanceRow,
  PermissionResult,
  SendPayload,
  SpawnPayload,
} from '@cockpit/core';
import { COCKPIT_ENV, COCKPIT_HUB_PORT, QUESTION_DISMISSED } from '@cockpit/core';
import { briefTitle } from '../brief-title';

/** Where the hub answers REST, derived from the websocket url the daemon uses. */
const hubHttpUrl = (): string => {
  const ws = process.env[COCKPIT_ENV.hubUrl] ?? `ws://localhost:${COCKPIT_HUB_PORT}/ws`;
  return ws.replace(/^ws/, 'http').replace(/\/ws$/, '');
};

/** The last path segment — how the rail names a session, and how the model will. */
const leafOf = (path: string): string => path.split('/').filter(Boolean).pop() ?? path;

interface Peer {
  row: InstanceRow;
  name: string;
  label: string;
  host: string;
}

/** Enough of a UUID to name one session among a fleet's worth. */
const shortId = (id: string): string => id.slice(0, 8);

/** How long ago the row moved, for a reader choosing between identical names. */
const ageOf = (at: InstanceRow['updatedAt']): string => {
  if (!at) return 'age unknown';
  const ms = Date.now() - new Date(at).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 'age unknown';
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return 'active now';
  if (minutes < 60) return `active ${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `active ${hours}h ago` : `active ${Math.round(hours / 24)}d ago`;
};

/**
 * The fleet, read from the hub rather than from this daemon's own sessions:
 * the whole point is reaching a session that is usually somewhere else.
 */
async function roster(exceptInstanceId: string): Promise<{ peers: Peer[]; own: InstanceRow | undefined }> {
  const base = hubHttpUrl();
  const [instancesRes, agentsRes] = await Promise.all([
    fetch(`${base}/api/instances`, { signal: AbortSignal.timeout(5000) }),
    fetch(`${base}/api/agents`, { signal: AbortSignal.timeout(5000) }).catch(() => undefined),
  ]);
  if (!instancesRes.ok) throw new Error(`the hub answered ${instancesRes.status}`);
  const rows = (await instancesRes.json()) as InstanceRow[];
  const hosts = new Map<string, string>();
  if (agentsRes?.ok) {
    for (const agent of (await agentsRes.json()) as { machineId: string; hostname: string }[]) {
      hosts.set(agent.machineId, agent.hostname);
    }
  }
  const own = rows.find((row) => row.id === exceptInstanceId);
  const peers = rows
    .filter((row) => row.id !== exceptInstanceId && (row.status === 'running' || row.status === 'starting'))
    .map((row) => {
      const name = leafOf(row.cwd);
      return {
        row,
        name,
        label: `${name}#${shortId(row.id)}`,
        host: hosts.get(row.machineId) ?? row.machineId,
      };
    });
  return { peers, own };
}

/** Resolves what the model typed to one session; ambiguity is reported, not guessed. */
function resolve(peers: Peer[], target: string): Peer {
  const needle = target.trim().toLowerCase().replace(/^@/, '');
  const byId = peers.find((peer) => peer.row.id === needle);
  if (byId) return byId;

  const idPart = needle.includes('#') ? needle.split('#').pop() ?? '' : needle;
  if (idPart.length >= 6) {
    const byShortId = peers.filter((peer) => peer.row.id.startsWith(idPart));
    if (byShortId.length === 1) return byShortId[0];
  }

  const exact = peers.filter((peer) => peer.name.toLowerCase() === needle);
  if (exact.length === 1) return exact[0];

  const partial = peers.filter((peer) => peer.name.toLowerCase().includes(needle));
  const candidates = exact.length > 1 ? exact : partial;
  if (candidates.length === 1) return candidates[0];
  if (candidates.length === 0) {
    const known = peers.map((peer) => peer.label).join(', ') || 'none are running';
    throw new Error(`No running session matches "${target}". Running now: ${known}.`);
  }
  const listed = candidates
    .map((peer) => `${peer.label} on ${peer.host} (${ageOf(peer.row.updatedAt)})`)
    .join(', ');
  throw new Error(
    `"${target}" matches ${candidates.length} sessions: ${listed}. ` +
      `Name one by its short id — and if you cannot tell them apart, ask rather than guess.`
  );
}

export interface HandoffDeps {
  /** The session doing the handing over. */
  readonly instanceId: string;
  /** What it is working on, so the receiver knows who is calling. */
  readonly cwd: string;
  /** Puts an envelope on the daemon's hub socket. */
  readonly emit: (envelope: Envelope) => void;
}

/** The three hand-off actions, each answering with the text the tool returns. */
export interface HandoffActions {
  listSessions(): Promise<string>;
  handoff(target: string, message: string, urgent?: boolean): Promise<string>;
  startSession(cwd: string, prompt: string, sideQuest?: boolean, model?: string): Promise<HandoffResult>;
  delegate(
    prompt: string,
    opts?: { cwd?: string; harness?: 'claude' | 'opencode' | 'pi'; model?: string; skills?: string[] }
  ): Promise<HandoffResult>;
  stopDelegate(target: string): Promise<string>;
  interruptDelegate(target: string): Promise<string>;
  /**
   * Answers a delegate's parked ask. `answers` is keyed by the exact question
   * text, each value the chosen option label; `deny` refuses it. Neither means
   * "allow with no changes" — the tool ask's own input stands.
   */
  answerDelegate(
    target: string,
    requestId: string,
    answers?: Record<string, string>,
    deny?: boolean
  ): Promise<string>;
  /** Pushes a note to the owner's Telegram — no peer, no ask, fire-and-forget. */
  sendToUser(message: string): Promise<string>;
  /**
   * Records what the session did about a concern the user raised. It is
   * session-scoped on purpose: the caller is never told which rule fired, or
   * that a rule fired at all, so it has no id to name — the hub settles
   * everything outstanding for the session from the note alone.
   */
  acknowledgeConcern(note: string): Promise<string>;
}

/** The structured result of startSession / delegate — the id, title, and the model-facing prose. */
export interface HandoffResult {
  id: string;
  title: string;
  text: string;
}

/** Resolves a target among the caller's own delegates; anything else is refused. */
function resolveDelegate(peers: Peer[], target: string, instanceId: string): Peer {
  const mine = peers.filter((peer) => peer.row.parentInstanceId === instanceId);
  try {
    return resolve(mine, target);
  } catch (error) {
    let outside = false;
    try {
      resolve(peers, target);
      outside = true;
    } catch {
      outside = false;
    }
    if (outside) {
      throw new Error(
        `"${target}" is not your delegate — you can only stop or interrupt your own delegates.`
      );
    }
    throw error;
  }
}

export const handoffActions = ({ instanceId, cwd, emit }: HandoffDeps): HandoffActions => ({
  async listSessions(): Promise<string> {
    const { peers, own } = await roster(instanceId);
    if (peers.length === 0) return 'No other sessions are running.';
    return peers
      .map((peer) => {
        const facts = [
          peer.host,
          peer.row.model ?? 'default model',
          ageOf(peer.row.updatedAt),
          ...(peer.row.kind === 'scratch' ? ['side quest'] : []),
          ...(peer.row.parentInstanceId === instanceId ? ['your delegate'] : []),
          ...(own?.parentInstanceId && own.parentInstanceId === peer.row.id ? ['your parent session'] : []),
        ];
        return `- ${peer.label} — ${peer.row.cwd} · ${facts.join(' · ')}`;
      })
      .join('\n');
  },

  async handoff(target: string, message: string, urgent = false): Promise<string> {
    const { peers } = await roster(instanceId);
    const peer = urgent ? resolveDelegate(peers, target, instanceId) : resolve(peers, target);
    const from = leafOf(cwd);
    const body = `[Hand-off from the ${from} session — another agent, not the user]\n\n${message}`;
    const payload: SendPayload = {
      instanceId: peer.row.id,
      message: {
        type: 'user',
        message: { role: 'user', content: body },
        parent_tool_use_id: null,
        origin: { kind: 'peer', from: instanceId, name: from, fromSession: instanceId },
        shouldQuery: false,
      },
      ...(urgent ? { urgent: true, from: instanceId } : {}),
    };
    emit({ verb: 'send', machineId: peer.row.machineId, instanceId: peer.row.id, payload });
    if (urgent) {
      return (
        `Delivered urgently to your delegate ${peer.label}. Its current turn was interrupted to ` +
        `read it now — a claude delegate reads it mid-turn instead.`
      );
    }
    return (
      `Handed to ${peer.label} (${peer.row.cwd} on ${peer.host}). It is queued there and will be ` +
      `picked up when that session finishes its current turn — it was not interrupted.`
    );
  },

  async startSession(workdir: string, prompt: string, sideQuest = false, model?: string): Promise<HandoffResult> {
    const id = crypto.randomUUID();
    const from = leafOf(cwd);
    const payload: SpawnPayload = {
      instanceId: id,
      cwd: workdir,
      ...(model ? { model } : {}),
      ...(sideQuest ? { scratch: { baseCwd: workdir } } : {}),
    };
    emit({ verb: 'spawn', machineId: '', instanceId: id, payload });
    // The marker prefix survives SDK storage (which strips `origin`) so that
    // `mapTranscript` → `handoffFrom()` can still detect the opening prompt as
    // a peer message and render it as `user.peer` instead of the reader's own
    // words — the same marker `handoff()` already uses.
    const body = `[Hand-off from the ${from} session — another agent, not the user]\n\n${prompt}`;
    const opening: SendPayload = {
      instanceId: id,
      message: {
        type: 'user',
        message: { role: 'user', content: body },
        parent_tool_use_id: null,
        origin: { kind: 'peer', from: instanceId, name: from, fromSession: instanceId },
      },
    };
    emit({ verb: 'send', machineId: '', instanceId: id, payload: opening });
    return {
      id,
      title: leafOf(workdir),
      text: `Started ${leafOf(workdir)}${sideQuest ? ' as a side quest' : ''} in ${workdir}. ` +
        `It is in the sidebar now and the user can open its transcript. ` +
        `Hand it more work later with handoff("${id}", ...).`,
    };
  },

  async delegate(
    prompt: string,
    opts?: { cwd?: string; harness?: 'claude' | 'opencode' | 'pi'; model?: string; skills?: string[] }
  ): Promise<HandoffResult> {
    const id = crypto.randomUUID();
    const workdir = opts?.cwd ?? cwd;
    const from = leafOf(cwd);
    // The brief is the only thing that says what this session is for, and the
    // rail would otherwise have nothing to call it but its directory and its id.
    const title = briefTitle(prompt);
    const payload: SpawnPayload = {
      instanceId: id,
      cwd: workdir,
      ...(opts?.harness ? { harness: opts.harness } : {}),
      ...(opts?.model ? { model: opts.model } : {}),
      ...(title ? { title } : {}),
      ...(opts?.skills?.length ? { skills: opts.skills } : {}),
      scratch: { baseCwd: workdir },
      parent: { instanceId },
      // A delegate is autonomous by definition: it must never sit waiting on a
      // tool-permission prompt nobody is watching for. Questions still ask.
      permissionMode: 'bypassPermissions',
    };
    emit({ verb: 'spawn', machineId: '', instanceId: id, payload });

    // Same marker as `handoff()` and `startSession()` — survives SDK storage so
    // stored transcripts render the opening as `user.peer` and `mergePeerMessage`
    // deduplicates against the live echo that carries `origin`.
    const body = `[Hand-off from the ${from} session — another agent, not the user]\n\n${prompt}`;
    const opening: SendPayload = {
      instanceId: id,
      message: {
        type: 'user',
        message: { role: 'user', content: body },
        parent_tool_use_id: null,
        origin: { kind: 'peer', from: instanceId, name: from, fromSession: instanceId },
      },
    };
    emit({ verb: 'send', machineId: '', instanceId: id, payload: opening });

    const harness = opts?.harness ?? 'claude';
    return {
      id,
      title: title || `${leafOf(workdir)}#${shortId(id)}`,
      text: `Delegated to ${harness} session ${leafOf(workdir)}#${shortId(id)}. It runs as a ` +
        `temporary session nested under this one; its report arrives here automatically when each ` +
        `of its turns completes. Guide it or send follow-ups with handoff("${id}", ...).`,
    };
  },

  async stopDelegate(target: string): Promise<string> {
    const { peers } = await roster(instanceId);
    const peer = resolveDelegate(peers, target, instanceId);
    emit({
      verb: 'stop',
      machineId: peer.row.machineId,
      instanceId: peer.row.id,
      payload: { instanceId: peer.row.id, from: instanceId },
    });
    return `Stopped your delegate ${peer.label}. Its transcript is preserved; delegate again to resume from it.`;
  },

  async interruptDelegate(target: string): Promise<string> {
    const { peers } = await roster(instanceId);
    const peer = resolveDelegate(peers, target, instanceId);
    emit({
      verb: 'control',
      machineId: peer.row.machineId,
      instanceId: peer.row.id,
      payload: {
        instanceId: peer.row.id,
        requestId: crypto.randomUUID(),
        method: 'interrupt',
        args: [],
        from: instanceId,
      },
    });
    return (
      `Interrupted your delegate ${peer.label}. Its current turn stopped; it keeps all state. ` +
      `Resume or redirect it with handoff("${peer.row.id}", ...).`
    );
  },

  async answerDelegate(
    target: string,
    requestId: string,
    answers?: Record<string, string>,
    deny = false
  ): Promise<string> {
    const { peers } = await roster(instanceId);
    const peer = resolveDelegate(peers, target, instanceId);
    // The answers alone are all this side has: the delegate's tool call never
    // came here, only the question text and its options did. A question's
    // `updatedInput` has to carry the whole call back or the harness refuses it
    // for the `questions` it is missing, so the harness that parked the ask
    // folds these into the input it kept (settledQuestionResult in
    // @cockpit/core, mirroring the dashboard's questionAnswer). A denial says so
    // in words for the same reason: the model is told why, not merely that.
    const result: PermissionResult = deny
      ? { behavior: 'deny', message: QUESTION_DISMISSED }
      : answers
        ? { behavior: 'allow', updatedInput: { answers } }
        : { behavior: 'allow' };
    emit({
      verb: 'control',
      machineId: peer.row.machineId,
      instanceId: peer.row.id,
      requestId,
      payload: {
        instanceId: peer.row.id,
        requestId,
        method: 'resolvePermission',
        args: [requestId, result],
        from: instanceId,
      },
    });
    return deny
      ? `Denied your delegate ${peer.label}'s ask (${requestId}).`
      : `Answered your delegate ${peer.label}'s ask (${requestId}).`;
  },

  async sendToUser(message: string): Promise<string> {
    emit({
      verb: 'frames',
      machineId: '',
      instanceId,
      payload: { kind: 'user_message', instanceId, text: message },
    });
    return 'Sent to the user — it lands in their Telegram when the hub has a bridge, and is dropped otherwise.';
  },

  async acknowledgeConcern(note: string): Promise<string> {
    const res = await fetch(`${hubHttpUrl()}/api/rules/ack`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ instanceId, note }),
      signal: AbortSignal.timeout(5000),
    });
    // A refusal comes back as the hub's own bare sentence; it says the useful
    // thing better than anything this side could invent, so pass it through.
    if (res.status === 400) return await res.text();
    if (!res.ok) throw new Error(`the hub answered ${res.status}`);
    return 'Recorded. The user sees this note in their dashboard.';
  },
});
