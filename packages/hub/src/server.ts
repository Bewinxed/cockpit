import type { AgentRow, Envelope, InstanceRow, Verb } from '@cockpit/core';
import { Elysia, t } from 'elysia';
import { websocket } from 'elysia/websocket';
import { HUB_VERSION } from './config';
import type { AgentAuth, DbShape, InstanceKind } from './db';
import type { PendingShape } from './pending';
import type { HubSocket, RegistryShape } from './registry';

export interface HubServices {
  readonly registry: RegistryShape;
  readonly db: DbShape;
  readonly pending: PendingShape;
}

const isEnvelope = (value: unknown): value is Envelope =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as Envelope).verb === 'string' &&
  typeof (value as Envelope).machineId === 'string';

const ack = (envelope: Envelope): Envelope<{ ok: true }> => ({
  verb: envelope.verb,
  machineId: envelope.machineId,
  payload: { ok: true },
});

/** Sent back as a frame, the only verb a dashboard renders. */
const failure = (
  envelope: Envelope,
  message: string,
): Envelope<{ kind: 'error'; verb: Verb; message: string }> => ({
  verb: 'frames',
  machineId: envelope.machineId,
  instanceId: envelope.instanceId,
  requestId: envelope.requestId,
  payload: { kind: 'error', verb: envelope.verb, message },
});

/**
 * The hub routes on envelope fields and is otherwise payload-opaque (NEW.md
 * §6); `hostname`/`os` on register, `cwd`/`options.resume`/`scratch`/`projectId`
 * on spawn, `discard` on stop and `kind` on a frame are the sanctioned peeks.
 */
const peek = (payload: unknown, key: string): string | undefined => {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
};

/** The SDK session a `spawn` resumes, so the instance row records what it re-opened. */
const peekResume = (payload: unknown): string | undefined => {
  if (typeof payload !== 'object' || payload === null) return undefined;
  return peek((payload as Record<string, unknown>).options, 'resume');
};

/** A spawn asking for scratch isolation, or for a session the SDK never stores. */
const peekKind = (payload: unknown): InstanceKind => {
  if (typeof payload !== 'object' || payload === null) return 'mainline';
  const { scratch, options } = payload as { scratch?: unknown; options?: unknown };
  const ephemeral =
    typeof options === 'object' &&
    options !== null &&
    (options as { persistSession?: unknown }).persistSession === false;
  return scratch || ephemeral ? 'scratch' : 'mainline';
};

/** The states a daemon is allowed to claim; anything else is a daemon we do not know. */
const AUTH_STATES: readonly AgentAuth[] = [
  'authenticated',
  'unauthenticated',
  'unreadable-credentials',
];

/** `register`'s word on whether the machine can reach Claude Code's credentials. */
const peekAuth = (payload: unknown): AgentAuth => {
  const claimed = peek(payload, 'auth') as AgentAuth | undefined;
  return claimed && AUTH_STATES.includes(claimed) ? claimed : 'unknown';
};

/** `register`'s list of the sessions the daemon still has running. */
const peekInstances = (payload: unknown): string[] => {
  if (typeof payload !== 'object' || payload === null) return [];
  const value = (payload as { instances?: unknown }).instances;
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
};

/**
 * What an `init` frame announces: the SDK session, which is what lets a
 * dashboard that joins a live session late read its transcript back, and the
 * directory the agent really opened it in — the spawn's `cwd` after the agent
 * expanded it.
 */
const peekInit = (payload: unknown): { sessionId: string; cwd?: string } | undefined => {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const message = (payload as { message?: unknown }).message;
  if (typeof message !== 'object' || message === null) return undefined;
  const sdk = message as Record<string, unknown>;
  if (sdk.type !== 'system' || sdk.subtype !== 'init') return undefined;
  if (typeof sdk.session_id !== 'string') return undefined;
  return { sessionId: sdk.session_id, cwd: typeof sdk.cwd === 'string' ? sdk.cwd : undefined };
};

/** `stop { discard: true }`: the side quest is being thrown away, not paused. */
const peekDiscard = (payload: unknown): boolean =>
  typeof payload === 'object' &&
  payload !== null &&
  (payload as { discard?: unknown }).discard === true;

export const createServer = ({ registry, db, pending }: HubServices) => {
  /** Relays a dashboard envelope to its machine; reports back if nobody is home. */
  const forward = (envelope: Envelope, dashboard: HubSocket): boolean => {
    const agent = registry.agent(envelope.machineId);
    if (!agent) {
      dashboard.send(failure(envelope, `machine ${envelope.machineId} is not connected`));
      return false;
    }
    agent.send(envelope);
    return true;
  };

  /**
   * Every row, to every dashboard, after any one of them moves — a session
   * opening, failing, settling or being discarded is fleet news, and a rail
   * that only learns it by re-fetching is a rail that lies until you reload.
   * The whole table because it is small and a snapshot cannot drift.
   */
  const publishInstances = (machineId: string): void => {
    const instances: InstanceRow[] = db.listInstances();
    const agents: AgentRow[] = db.listAgents();
    registry.broadcast({
      verb: 'frames',
      machineId,
      payload: { kind: 'instances', instances, agents },
    });
  };

  return new Elysia()
    .use(websocket())
    .get('/health', () => ({ ok: true, version: HUB_VERSION }))
    .get('/api/agents', () => db.listAgents())
    .get('/api/instances', () => db.listInstances())
    .patch(
      '/api/instances/:id',
      { body: t.Object({ kind: t.Union([t.Literal('mainline'), t.Literal('scratch')]) }) },
      ({ params, body }) => {
        const row = db.setInstanceKind(params.id, body.kind);
        if (row) publishInstances(row.machineId);
        return row;
      }
    )
    .get('/api/pending', () => pending.list())
    .get('/api/projects', () => db.listProjects())
    .post(
      '/api/projects',
      { body: t.Object({ name: t.String(), cwd: t.String(), machineId: t.String() }) },
      ({ body }) => db.createProject({ id: crypto.randomUUID(), ...body })
    )
    .delete('/api/projects/:id', ({ params }) => {
      db.deleteProject(params.id);
      return { ok: true };
    })
    .ws('/ws', {
      message(ws, message) {
        if (!isEnvelope(message)) {
          console.warn('[hub] dropped malformed frame', message);
          return;
        }

        switch (message.verb) {
          case 'register':
            registry.registerAgent(message.machineId, ws);
            db.upsertAgent({
              machineId: message.machineId,
              hostname: peek(message.payload, 'hostname') ?? message.machineId,
              os: peek(message.payload, 'os') ?? 'unknown',
              auth: peekAuth(message.payload),
            });
            db.settleInstances(message.machineId, peekInstances(message.payload));
            publishInstances(message.machineId);
            ws.send(ack(message));
            break;
          case 'heartbeat':
            db.touchAgent(message.machineId);
            ws.send(ack(message));
            break;
          case 'frames': {
            const kind = peek(message.payload, 'kind');
            if (message.requestId && kind === 'permission_request')
              pending.remember(message.requestId, message);
            if (kind === 'sdk' && message.instanceId) {
              const init = peekInit(message.payload);
              if (init) {
                db.noteInstanceSession(message.instanceId, init.sessionId, init.cwd);
                publishInstances(message.machineId);
              }
            }
            // An agent only frames an error about a session that failed to start
            // or died on its own, so the row records it for whoever looks later.
            if (kind === 'error' && message.instanceId) {
              db.failInstance(
                message.instanceId,
                peek(message.payload, 'message') ?? 'the session failed'
              );
              pending.forget(message.instanceId);
              publishInstances(message.machineId);
            }
            // A control's reply belongs to the dashboard that asked; the rest is fan-out.
            const requester =
              message.requestId && kind === 'control_result'
                ? registry.takeRequester(message.requestId)
                : undefined;
            if (requester) requester.send(message);
            else registry.broadcast(message);
            break;
          }
          default:
            console.warn(`[hub] unhandled verb ${message.verb} from ${message.machineId}`);
        }
      },
      close(ws) {
        const machineId = registry.dropAgent(ws.id);
        if (!machineId) return;
        db.markAgentOffline(machineId);
        db.reconcileInstances(machineId, []);
        publishInstances(machineId);
      },
    })
    .ws('/ws/dashboard', {
      open(ws) {
        registry.addDashboard(ws);
      },
      message(ws, message) {
        if (!isEnvelope(message)) {
          console.warn('[hub] dropped malformed dashboard frame', message);
          return;
        }

        switch (message.verb) {
          case 'spawn':
            if (forward(message, ws) && message.instanceId) {
              // A relaunch replaces the process — questions the old one had
              // open are settled by its teardown and must not replay.
              pending.forget(message.instanceId);
              db.openInstance({
                id: message.instanceId,
                machineId: message.machineId,
                cwd: peek(message.payload, 'cwd') ?? '',
                sessionId: peekResume(message.payload),
                projectId: peek(message.payload, 'projectId'),
                kind: peekKind(message.payload),
              });
              publishInstances(message.machineId);
            }
            break;
          case 'send':
            forward(message, ws);
            break;
          case 'stop':
            if (forward(message, ws) && message.instanceId) {
              if (peekDiscard(message.payload)) db.discardInstance(message.instanceId);
              else db.stopInstance(message.instanceId);
              publishInstances(message.machineId);
            }
            break;
          case 'control':
            if (forward(message, ws) && message.requestId) {
              registry.rememberRequester(message.requestId, ws);
              pending.resolve(message.requestId);
            }
            break;
          case 'fs':
            // Answered on `control_result` too, so the same requester map routes it.
            if (forward(message, ws) && message.requestId)
              registry.rememberRequester(message.requestId, ws);
            break;
          default:
            console.warn(`[hub] unhandled dashboard verb ${message.verb}`);
        }
      },
      close(ws) {
        registry.dropDashboard(ws);
      },
    });
};
