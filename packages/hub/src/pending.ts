import type { Envelope } from '@cockpit/core';
import { Context, Effect, Layer } from 'effect';

/**
 * Permission and dialog requests the agent is blocked on, keyed by SDK
 * `requestId`, so a dashboard that connects mid-prompt can still answer it.
 */
export interface PendingShape {
  readonly remember: (requestId: string, envelope: Envelope) => void;
  readonly resolve: (requestId: string) => void;
  /** A relaunch or a death answers every question its process had open. */
  readonly forget: (instanceId: string) => void;
  readonly list: () => Envelope[];
}

export class Pending extends Context.Service<Pending, PendingShape>()('Pending') {}

const make = (): PendingShape => {
  const requests = new Map<string, Envelope>();

  return {
    remember: (requestId, envelope) => {
      requests.set(requestId, envelope);
    },
    resolve: (requestId) => {
      requests.delete(requestId);
    },
    forget: (instanceId) => {
      for (const [requestId, envelope] of requests) {
        if (envelope.instanceId === instanceId) requests.delete(requestId);
      }
    },
    list: () => [...requests.values()],
  };
};

export const PendingLayer = Layer.effect(Pending)(Effect.sync(make));
