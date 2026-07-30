import { Context, Effect, Layer } from 'effect';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { DB_PATH } from '../config';
import { agents, instances } from './schema';

/** Shipped with the package so a fresh boot never needs a drizzle-kit step. */
const MIGRATIONS_DIR = Bun.fileURLToPath(new URL('../../drizzle', import.meta.url));

export interface DbShape {
  readonly upsertAgent: (agent: { machineId: string; hostname: string; os: string }) => void;
  readonly touchAgent: (machineId: string) => void;
  readonly markAgentOffline: (machineId: string) => void;
  readonly openInstance: (instance: {
    id: string;
    machineId: string;
    cwd: string;
    sessionId?: string;
  }) => void;
  readonly stopInstance: (id: string) => void;
  /** The agent socket dropped: its sessions may outlive it, the hub cannot tell. */
  readonly markInstancesUnknown: (machineId: string) => void;
  readonly listAgents: () => (typeof agents.$inferSelect)[];
  readonly listInstances: () => (typeof instances.$inferSelect)[];
}

export class Db extends Context.Service<Db, DbShape>()('Db') {}

const make = (path: string): DbShape => {
  const db = drizzle(path);
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });

  return {
    upsertAgent: ({ machineId, hostname, os }) => {
      const lastSeenAt = new Date();
      db.insert(agents)
        .values({ machineId, hostname, os, status: 'online', lastSeenAt })
        .onConflictDoUpdate({
          target: agents.machineId,
          set: { hostname, os, status: 'online', lastSeenAt },
        })
        .run();
    },
    touchAgent: (machineId) => {
      db.update(agents)
        .set({ status: 'online', lastSeenAt: new Date() })
        .where(eq(agents.machineId, machineId))
        .run();
    },
    markAgentOffline: (machineId) => {
      db.update(agents)
        .set({ status: 'offline', lastSeenAt: new Date() })
        .where(eq(agents.machineId, machineId))
        .run();
    },
    openInstance: ({ id, machineId, cwd, sessionId }) => {
      const now = new Date();
      db.insert(instances)
        .values({ id, machineId, cwd, sessionId, status: 'running', createdAt: now, updatedAt: now })
        .onConflictDoUpdate({
          target: instances.id,
          // A respawn that names no session keeps whatever session the row already had.
          set: sessionId
            ? { cwd, sessionId, status: 'running', updatedAt: now }
            : { cwd, status: 'running', updatedAt: now },
        })
        .run();
    },
    stopInstance: (id) => {
      db.update(instances)
        .set({ status: 'stopped', updatedAt: new Date() })
        .where(eq(instances.id, id))
        .run();
    },
    markInstancesUnknown: (machineId) => {
      db.update(instances)
        .set({ status: 'unknown', updatedAt: new Date() })
        .where(and(eq(instances.machineId, machineId), eq(instances.status, 'running')))
        .run();
    },
    listAgents: () => db.select().from(agents).all(),
    listInstances: () => db.select().from(instances).all(),
  };
};

export const DbLayer = Layer.effect(Db)(Effect.sync(() => make(DB_PATH)));
