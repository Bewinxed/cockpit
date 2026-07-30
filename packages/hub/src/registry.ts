import { Context, Effect, Layer } from 'effect';

/**
 * The slice of Elysia's WebSocket handle the registry needs — structural so the
 * registry stays free of Elysia's route generics.
 */
export interface AgentSocket {
  readonly id: string;
  send(data: unknown): unknown;
}

export interface RegistryShape {
  readonly register: (machineId: string, socket: AgentSocket) => void;
  readonly drop: (socketId: string) => void;
  readonly get: (machineId: string) => AgentSocket | undefined;
  readonly machineIds: () => string[];
}

export class Registry extends Context.Service<Registry, RegistryShape>()('Registry') {}

const make = (): RegistryShape => {
  const sockets = new Map<string, AgentSocket>();

  return {
    register: (machineId, socket) => {
      sockets.set(machineId, socket);
    },
    drop: (socketId) => {
      for (const [machineId, socket] of sockets)
        if (socket.id === socketId) sockets.delete(machineId);
    },
    get: (machineId) => sockets.get(machineId),
    machineIds: () => [...sockets.keys()],
  };
};

export const RegistryLayer = Layer.effect(Registry)(Effect.sync(make));
