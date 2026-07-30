import type { Envelope, Verb } from '@cockpit/core';
import { Elysia } from 'elysia';
import { websocket } from 'elysia/websocket';
import { HUB_VERSION } from './config';
import type { DbShape } from './db';
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
 * §6); `hostname`/`os` on register, `cwd` on spawn and `kind` on a frame are
 * the whole set of sanctioned peeks.
 */
const peek = (payload: unknown, key: string): string | undefined => {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
};

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
    .get('/api/pending', () => pending.list())
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
          case 'frames':
            if (message.requestId && peek(message.payload, 'kind') === 'permission_request')
              pending.remember(message.requestId, message);
            registry.broadcast(message);
            break;
          default:
            console.warn(`[hub] unhandled verb ${message.verb} from ${message.machineId}`);
        }
      },
      close(ws) {
        const machineId = registry.dropAgent(ws.id);
        if (machineId) db.markAgentOffline(machineId);
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
              });
            break;
          case 'send':
            forward(message, ws);
            break;
          case 'stop':
            if (forward(message, ws) && message.instanceId) db.stopInstance(message.instanceId);
            break;
          case 'control':
            if (forward(message, ws) && message.requestId) pending.resolve(message.requestId);
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
