import { Context, Effect, Layer } from 'effect';
import { and, eq, gt, inArray, ne, notInArray, or } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { DB_PATH } from '../config';
import { agents, instances, projects } from './schema';

/** Shipped with the package so a fresh boot never needs a drizzle-kit step. */
const MIGRATIONS_DIR = Bun.fileURLToPath(new URL('../../drizzle', import.meta.url));

export type InstanceKind = (typeof instances.$inferSelect)['kind'];

/** How long a session that stopped moving stays in the listings the rails read. */
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export type AgentAuth = (typeof agents.$inferSelect)['auth'];

export interface DbShape {
  readonly upsertAgent: (agent: {
    machineId: string;
    hostname: string;
    os: string;
    auth: AgentAuth;
  }) => void;
  readonly touchAgent: (machineId: string) => void;
  readonly markAgentOffline: (machineId: string) => void;
  readonly openInstance: (instance: {
    id: string;
    machineId: string;
    cwd: string;
    sessionId?: string;
    projectId?: string;
    kind: InstanceKind;
  }) => void;
  readonly stopInstance: (id: string) => void;
  /** The agent reported the session dead: what killed it, kept for late readers. */
  readonly failInstance: (id: string, error: string) => void;
  /** A side quest thrown away: stopped, and gone from every live listing. */
  readonly discardInstance: (id: string) => void;
  /** "Keep": a side quest that earned its place stops being treated as scratch. */
  readonly setInstanceKind: (id: string, kind: InstanceKind) => typeof instances.$inferSelect | undefined;
  /**
   * The SDK session an `init` frame named, so the row can be read back from —
   * with the directory it really opened in, which is the agent's word on where
   * the spawn's `cwd` resolved to.
   */
  readonly noteInstanceSession: (id: string, sessionId: string, cwd?: string) => void;
  /**
   * Marks every running instance on the machine that `liveIds` does not name as
   * unknown: those belong to a daemon that is gone, and the hub cannot tell
   * whether they outlived it. An empty list means the machine runs nothing.
   */
  readonly reconcileInstances: (machineId: string, liveIds: string[]) => void;
  readonly settleInstances: (machineId: string, liveIds: string[]) => void;
  readonly listAgents: () => (typeof agents.$inferSelect)[];
  readonly listInstances: () => (typeof instances.$inferSelect)[];
  readonly listProjects: () => (typeof projects.$inferSelect)[];
  readonly createProject: (project: {
    id: string;
    machineId: string;
    name: string;
    cwd: string;
  }) => typeof projects.$inferSelect | undefined;
  readonly deleteProject: (id: string) => void;
}

export class Db extends Context.Service<Db, DbShape>()('Db') {}

const make = (path: string): DbShape => {
  const db = drizzle(path);
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });

  return {
    upsertAgent: ({ machineId, hostname, os, auth }) => {
      const lastSeenAt = new Date();
      db.insert(agents)
        .values({ machineId, hostname, os, auth, status: 'online', lastSeenAt })
        .onConflictDoUpdate({
          target: agents.machineId,
          set: { hostname, os, auth, status: 'online', lastSeenAt },
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
    openInstance: ({ id, machineId, cwd, sessionId, projectId, kind }) => {
      const now = new Date();
      db.insert(instances)
        .values({
          id,
          machineId,
          cwd,
          sessionId,
          projectId,
          kind,
          status: 'running',
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: instances.id,
          // A respawn that names no session or project keeps whichever the row had.
          set: {
            cwd,
            kind,
            status: 'running',
            lastError: null,
            updatedAt: now,
            ...(sessionId ? { sessionId } : {}),
            ...(projectId ? { projectId } : {}),
          },
        })
        .run();
    },
    stopInstance: (id) => {
      db.update(instances)
        .set({ status: 'stopped', updatedAt: new Date() })
        .where(eq(instances.id, id))
        .run();
    },
    failInstance: (id, error) => {
      // A side quest that was thrown away stays thrown away: its teardown can
      // fail long after the session did, and it is not coming back as a row.
      db.update(instances)
        .set({ status: 'error', lastError: error, updatedAt: new Date() })
        .where(and(eq(instances.id, id), ne(instances.status, 'discarded')))
        .run();
    },
    discardInstance: (id) => {
      db.update(instances)
        .set({ status: 'discarded', updatedAt: new Date() })
        .where(eq(instances.id, id))
        .run();
    },
    setInstanceKind: (id, kind) =>
      db
        .update(instances)
        .set({ kind, updatedAt: new Date() })
        .where(eq(instances.id, id))
        .returning()
        .get(),
    noteInstanceSession: (id, sessionId, cwd) => {
      db.update(instances)
        .set({ sessionId, updatedAt: new Date(), ...(cwd ? { cwd } : {}) })
        .where(eq(instances.id, id))
        .run();
    },
    // The daemon went away: its sessions may or may not still be alive out there.
    reconcileInstances: (machineId, liveIds) => {
      db.update(instances)
        .set({ status: 'unknown', updatedAt: new Date() })
        .where(
          and(
            eq(instances.machineId, machineId),
            inArray(instances.status, ['running', 'starting']),
            liveIds.length > 0 ? notInArray(instances.id, liveIds) : undefined
          )
        )
        .run();
    },
    // The daemon is back and authoritative: a session it no longer carries is
    // dead — settled as an error so it stays on the board instead of ghosting.
    settleInstances: (machineId, liveIds) => {
      db.update(instances)
        .set({
          status: 'error',
          lastError: 'The agent restarted; this session did not survive it.',
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(instances.machineId, machineId),
            inArray(instances.status, ['running', 'starting', 'unknown']),
            liveIds.length > 0 ? notInArray(instances.id, liveIds) : undefined
          )
        )
        .run();
    },
    listAgents: () => db.select().from(agents).all(),
    // A discarded side quest is gone for good, and a row that has not moved in a
    // day is history no rail has a use for — a running one stays whatever its age.
    listInstances: () =>
      db
        .select()
        .from(instances)
        .where(
          and(
            ne(instances.status, 'discarded'),
            or(
              eq(instances.status, 'running'),
              gt(instances.updatedAt, new Date(Date.now() - STALE_AFTER_MS))
            )
          )
        )
        .all(),
    listProjects: () => db.select().from(projects).all(),
    createProject: ({ id, machineId, name, cwd }) =>
      db.insert(projects).values({ id, machineId, name, cwd }).returning().get(),
    deleteProject: (id) => {
      // The sessions started from it outlive it; they just stop being its.
      db.update(instances).set({ projectId: null }).where(eq(instances.projectId, id)).run();
      db.delete(projects).where(eq(projects.id, id)).run();
    },
  };
};

export const DbLayer = Layer.effect(Db)(Effect.sync(() => make(DB_PATH)));
