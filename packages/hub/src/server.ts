import type { Envelope } from '@cockpit/core';
import { Elysia } from 'elysia';
import { websocket } from 'elysia/websocket';
import { HUB_VERSION } from './config';
import type { RegistryShape } from './registry';

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

export const createServer = (registry: RegistryShape) =>
  new Elysia()
    .use(websocket())
    .get('/health', () => ({ ok: true, version: HUB_VERSION }))
    .ws('/ws', {
      message(ws, message) {
        if (!isEnvelope(message)) {
          console.warn('[hub] dropped malformed frame', message);
          return;
        }

        switch (message.verb) {
          case 'register':
            registry.register(message.machineId, ws);
            ws.send(ack(message));
            break;
          case 'heartbeat':
            ws.send(ack(message));
            break;
          default:
            console.warn(`[hub] unhandled verb ${message.verb} from ${message.machineId}`);
        }
      },
      close(ws) {
        registry.drop(ws.id);
      },
    });
