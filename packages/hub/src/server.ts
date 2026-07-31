import type { Envelope, Verb } from '@cockpit/core';
import { Elysia, t } from 'elysia';
import { websocket } from 'elysia/websocket';
import { HUB_VERSION } from './config';
import type { DbShape, InstanceKind } from './db';
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

  return new Elysia()
    .use(websocket())
    .get('/health', () => ({ ok: true, version: HUB_VERSION }))
    .get('/api/agents', () => db.listAgents())
    .get('/api/instances', () => db.listInstances())
    .patch(
      '/api/instances/:id',
      { body: t.Object({ kind: t.Union([t.Literal('mainline'), t.Literal('scratch')]) }) },
      ({ params, body }) => db.setInstanceKind(params.id, body.kind)
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
            });
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
        db.markInstancesUnknown(machineId);
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
            if (forward(message, ws) && message.instanceId)
              db.openInstance({
                id: message.instanceId,
                machineId: message.machineId,
                cwd: peek(message.payload, 'cwd') ?? '',
                sessionId: peekResume(message.payload),
                projectId: peek(message.payload, 'projectId'),
                kind: peekKind(message.payload),
              });
            break;
          case 'send':
            forward(message, ws);
            break;
          case 'stop':
            if (forward(message, ws) && message.instanceId) {
              if (peekDiscard(message.payload)) db.discardInstance(message.instanceId);
              else db.stopInstance(message.instanceId);
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
