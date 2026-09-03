import type { Envelope } from "@whiffle/core";
import { Context, Effect, Layer } from "effect";

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
  readonly addDashboard: (socket: HubSocket) => void;
  readonly agent: (machineId: string) => HubSocket | undefined;
  readonly broadcast: (envelope: Envelope) => void;
  /**
   * Fans an instance-scoped frame out only to dashboards subscribed to
   * `instanceId`. Everything else goes through {@link broadcast} — an unknown
   * kind must never be silently dropped, so the relay fails open.
   */
  readonly broadcastFrame: (envelope: Envelope, instanceId: string) => void;
  /** The most recent usable dashboard origin, or nothing if none has connected. */
  readonly dashboardOrigin: () => string | undefined;
  /** Returns the machine the socket was registered as, if it was an agent. */
  readonly dropAgent: (socketId: string) => string | undefined;
  readonly dropDashboard: (socket: HubSocket) => void;
  readonly machineIds: () => string[];
  /**
   * Remembers the origin a dashboard just connected from, if it is one worth
   * linking to. Junk is dropped rather than rejected loudly — a client is free
   * to send whatever `Origin` it likes.
   */
  readonly noteDashboardOrigin: (origin: string | undefined) => void;
  readonly registerAgent: (machineId: string, socket: HubSocket) => void;
  /** Routes the reply to a forwarded `control` back to the dashboard that asked. */
  readonly rememberRequester: (requestId: string, socket: HubSocket) => void;
  /** Replaces a dashboard's subscription set whole — one verb, no add/remove bookkeeping. */
  readonly setSubscriptions: (socket: HubSocket, instanceIds: string[]) => void;
  /** Consumes the route — a `requestId` is answered once. */
  readonly takeRequester: (requestId: string) => HubSocket | undefined;
}

/**
 * Hosts a link is pointless with. A message goes to a phone, and loopback names
 * resolve on the phone, not on the machine the dashboard is running on.
 */
const LOOPBACK_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "[::1]",
  "[::]",
]);

/**
 * The origin as something safe to put in a link, or nothing.
 *
 * `Origin` is a header the client writes, so it is parsed rather than believed:
 * anything that is not an absolute http(s) URL is dropped, and so is loopback —
 * see {@link LOOPBACK_HOSTS}. What comes back is `URL.origin`, which is scheme,
 * host and port and nothing else: no path, no query, no credentials.
 */
const usableOrigin = (origin: string | undefined): string | undefined => {
  if (!origin) {
    return undefined;
  }
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return undefined;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return undefined;
  }
  if (LOOPBACK_HOSTS.has(url.hostname)) {
    return undefined;
  }
  return url.origin;
};

/** A control whose reply never came stops being routable after this. */
const REQUESTER_TTL_MS = 5 * 60_000;
const SWEEP_INTERVAL_MS = 60_000;

export class Registry extends Context.Service<Registry, RegistryShape>()(
  "Registry"
) {}

const make = (): RegistryShape => {
  const agents = new Map<string, HubSocket>();
  /** One entry per dashboard socket, with the instances it subscribes to. */
  const dashboards = new Map<
    string,
    { socket: HubSocket; subscriptions: Set<string> }
  >();
  const requesters = new Map<string, { socket: HubSocket; at: number }>();
  /**
   * The last origin a dashboard reached this hub from. Kept rather than derived
   * because the hub has no other way to learn it — see `dashboardUrl` in
   * `telegram.ts`. Newest wins: an operator who has moved to a new hostname is
   * telling the hub so by opening the dashboard there.
   */
  let lastDashboardOrigin: string | undefined;

  const sweep = setInterval(() => {
    const cutoff = Date.now() - REQUESTER_TTL_MS;
    for (const [requestId, entry] of requesters) {
      if (entry.at < cutoff) {
        requesters.delete(requestId);
      }
    }
  }, SWEEP_INTERVAL_MS);
  sweep.unref();

  return {
    registerAgent: (machineId, socket) => {
      agents.set(machineId, socket);
    },
    dropAgent: (socketId) => {
      for (const [machineId, socket] of agents) {
        if (socket.id === socketId) {
          agents.delete(machineId);
          return machineId;
        }
      }
    },
    agent: (machineId) => agents.get(machineId),
    machineIds: () => [...agents.keys()],
    addDashboard: (socket) => {
      dashboards.set(socket.id, { socket, subscriptions: new Set() });
    },
    dropDashboard: (socket) => {
      dashboards.delete(socket.id);
      for (const [requestId, entry] of requesters) {
        if (entry.socket.id === socket.id) {
          requesters.delete(requestId);
        }
      }
    },
    broadcast: (envelope) => {
      for (const { socket } of dashboards.values()) {
        socket.send(envelope);
      }
    },
    broadcastFrame: (envelope, instanceId) => {
      for (const { socket, subscriptions } of dashboards.values()) {
        if (subscriptions.has(instanceId)) {
          socket.send(envelope);
        }
      }
    },
    setSubscriptions: (socket, instanceIds) => {
      const entry = dashboards.get(socket.id);
      if (entry) {
        entry.subscriptions = new Set(instanceIds);
      }
    },
    noteDashboardOrigin: (origin) => {
      const usable = usableOrigin(origin);
      if (usable) {
        lastDashboardOrigin = usable;
      }
    },
    dashboardOrigin: () => lastDashboardOrigin,
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
