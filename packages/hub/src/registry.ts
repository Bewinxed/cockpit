import type { Envelope } from '@cockpit/core';
import { Context, Effect, Layer } from 'effect';

/**
 * The slice of Elysia's WebSocket handle the registry needs — structural so the
 * registry stays free of Elysia's route generics. Elysia builds a fresh handle
 * per lifecycle callback, so sockets are only ever compared by `id`.
 */
export interface HubSocket {
  readonly id: string;
  send(data: unknown): unknown;
}

export interface RegistryShape {
  readonly registerAgent: (machineId: string, socket: HubSocket) => void;
  /** Returns the machine the socket was registered as, if it was an agent. */
  readonly dropAgent: (socketId: string) => string | undefined;
  readonly agent: (machineId: string) => HubSocket | undefined;
  readonly machineIds: () => string[];
  readonly addDashboard: (socket: HubSocket) => void;
  readonly dropDashboard: (socket: HubSocket) => void;
  readonly broadcast: (envelope: Envelope) => void;
  /** Routes the reply to a forwarded `control` back to the dashboard that asked. */
  readonly rememberRequester: (requestId: string, socket: HubSocket) => void;
  /** Consumes the route — a `requestId` is answered once. */
  readonly takeRequester: (requestId: string) => HubSocket | undefined;
}

/** A control whose reply never came stops being routable after this. */
const REQUESTER_TTL_MS = 5 * 60_000;
const SWEEP_INTERVAL_MS = 60_000;

export class Registry extends Context.Service<Registry, RegistryShape>()('Registry') {}

const make = (): RegistryShape => {
  const agents = new Map<string, HubSocket>();
  const dashboards = new Map<string, HubSocket>();
  const requesters = new Map<string, { socket: HubSocket; at: number }>();

  const sweep = setInterval(() => {
    const cutoff = Date.now() - REQUESTER_TTL_MS;
    for (const [requestId, entry] of requesters)
      if (entry.at < cutoff) requesters.delete(requestId);
  }, SWEEP_INTERVAL_MS);
  sweep.unref();

  return {
    registerAgent: (machineId, socket) => {
      agents.set(machineId, socket);
    },
    dropAgent: (socketId) => {
      for (const [machineId, socket] of agents)
        if (socket.id === socketId) {
          agents.delete(machineId);
          return machineId;
        }
      return undefined;
    },
    agent: (machineId) => agents.get(machineId),
    machineIds: () => [...agents.keys()],
    addDashboard: (socket) => {
      dashboards.set(socket.id, socket);
    },
    dropDashboard: (socket) => {
      dashboards.delete(socket.id);
      for (const [requestId, entry] of requesters)
        if (entry.socket.id === socket.id) requesters.delete(requestId);
    },
    broadcast: (envelope) => {
      for (const socket of dashboards.values()) socket.send(envelope);
    },
    rememberRequester: (requestId, socket) => {
      requesters.set(requestId, { socket, at: Date.now() });
    },
    takeRequester: (requestId) => {
      const entry = requesters.get(requestId);
      requesters.delete(requestId);
      return entry?.socket;
    },
  };
};

export const RegistryLayer = Layer.effect(Registry)(Effect.sync(make));
