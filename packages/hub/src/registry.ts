import type { Envelope } from '@cockpit/core';
import { Context, Effect, Layer } from 'effect';

/**
 * The slice of Elysia's WebSocket handle the registry needs — structural so the
 * registry stays free of Elysia's route generics.
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
}

export class Registry extends Context.Service<Registry, RegistryShape>()('Registry') {}

const make = (): RegistryShape => {
  const agents = new Map<string, HubSocket>();
  const dashboards = new Set<HubSocket>();

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
      dashboards.add(socket);
    },
    dropDashboard: (socket) => {
      dashboards.delete(socket);
    },
    broadcast: (envelope) => {
      for (const socket of dashboards) socket.send(envelope);
    },
  };
};

export const RegistryLayer = Layer.effect(Registry)(Effect.sync(make));
