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
  /**
   * Fans an instance-scoped frame out only to dashboards subscribed to
   * `instanceId`. Everything else goes through {@link broadcast} — an unknown
   * kind must never be silently dropped, so the relay fails open.
   */
  readonly broadcastFrame: (envelope: Envelope, instanceId: string) => void;
  /** Replaces a dashboard's subscription set whole — one verb, no add/remove bookkeeping. */
  readonly setSubscriptions: (socket: HubSocket, instanceIds: string[]) => void;
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
  /** One entry per dashboard socket, with the instances it subscribes to. */
  const dashboards = new Map<string, { socket: HubSocket; subscriptions: Set<string> }>();
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
      dashboards.set(socket.id, { socket, subscriptions: new Set() });
    },
    dropDashboard: (socket) => {
      dashboards.delete(socket.id);
      for (const [requestId, entry] of requesters)
        if (entry.socket.id === socket.id) requesters.delete(requestId);
    },
    broadcast: (envelope) => {
      for (const { socket } of dashboards.values()) socket.send(envelope);
    },
    broadcastFrame: (envelope, instanceId) => {
      for (const { socket, subscriptions } of dashboards.values())
        if (subscriptions.has(instanceId)) socket.send(envelope);
    },
    setSubscriptions: (socket, instanceIds) => {
      const entry = dashboards.get(socket.id);
      if (entry) entry.subscriptions = new Set(instanceIds);
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
