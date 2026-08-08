import type {
  AgentRow,
  BuildInfo,
  FleetAgent,
  FleetConfig,
  FleetMarketplace,
  FleetMcpServer,
  FleetPlugin,
  FleetSkillMeta,
  FleetSyncReport,
  SkillFile,
  ToolPolicy,
  ToolStatus,
} from '@cockpit/core';
import { RESTART_LOST, RESTART_RESUMABLE } from '@cockpit/core';
import { Context, Effect, Layer } from 'effect';
import { and, desc, eq, gt, inArray, ne, notInArray, or } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { DB_PATH } from '../config';
import {
  agents,
  fleetAgents,
  fleetMemory,
  fleetMemoryHistory,
  instances,
  marketplaces,
  mcpServers,
  plugins,
  projects,
  skills,
  tools,
} from './schema';

/** Shipped with the package so a fresh boot never needs a drizzle-kit step. */
const MIGRATIONS_DIR = Bun.fileURLToPath(new URL('../../drizzle', import.meta.url));

export type InstanceKind = (typeof instances.$inferSelect)['kind'];

/**
 * A session the returning daemon no longer carries. `resumes` is the whole
 * question: the SDK still has its conversation, so the process can be started
 * again on top of it rather than the work being lost with the restart.
 */
export interface SettledInstance {
  row: typeof instances.$inferSelect;
  resumes: boolean;
}

/** How long a session that stopped moving stays in the listings the rails read. */
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export type AgentAuth = (typeof agents.$inferSelect)['auth'];

/** One superseded version of the fleet's memory, as a listing reads it. */
export interface MemoryVersion {
  id: number;
  hash: string;
  source: string;
  bytes: number;
  createdAt: Date;
}

export interface DbShape {
  readonly upsertAgent: (agent: {
    machineId: string;
    hostname: string;
    os: string;
    auth: AgentAuth;
    /** Absent from a register with nothing new to say about it; the row keeps what it had. */
    build?: BuildInfo;
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
    permissionMode?: string;
    model?: string;
  }) => void;
  readonly stopInstance: (id: string) => void;
  /** The agent reported the session dead: what killed it, kept for late readers. */
  readonly failInstance: (id: string, error: string) => void;
  /** A side quest thrown away: stopped, and gone from every live listing. */
  readonly discardInstance: (id: string) => void;
  /**
   * The fields a dashboard may move on a live row: "Keep" — a side quest that
   * earned its place stops being treated as scratch — and the two settings the
   * user keeps changing on a session that is already running.
   */
  readonly patchInstance: (
    id: string,
    patch: { kind?: InstanceKind; permissionMode?: string; model?: string }
  ) => typeof instances.$inferSelect | undefined;
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
  /**
   * The returning daemon's word on its machine: `liveIds` are the sessions it
   * still carries, `resumable` the SDK sessions it could pick back up. A daemon
   * that could not read its catalog names none, and every row it left behind
   * keeps the benefit of the doubt.
   */
  /**
   * Returns what it settled, so the caller can drop their parked questions —
   * and, for the ones whose conversation survived, put them back.
   */
  readonly settleInstances: (
    machineId: string,
    liveIds: string[],
    resumable?: string[]
  ) => SettledInstance[];
  /** The fleet's tool policy (NEW.md §10) — only the tools somebody has ruled on. */
  readonly listToolPolicies: () => ToolPolicy[];
  /** Upsert; a patch names only what it changes and the rest stays as it was. */
  readonly putToolPolicy: (
    id: string,
    patch: { required?: boolean; pinnedVersion?: string | null }
  ) => ToolPolicy;
  /** A machine's last-known tool status by id; empty for one that never reported. */
  readonly agentTools: (machineId: string) => Record<string, ToolStatus>;
  /** A whole report: every id it names is replaced, every other cell survives. */
  readonly mergeAgentTools: (machineId: string, statuses: ToolStatus[]) => void;
  readonly setAgentToolCell: (machineId: string, status: ToolStatus) => void;
  /** The whole desired fleet state (NEW.md §11) — what a machine is sent to converge on. */
  readonly fleetConfig: () => FleetConfig;
  readonly putMcpServer: (server: {
    name: string;
    config: FleetMcpServer['config'];
    enabled?: boolean;
  }) => FleetMcpServer;
  readonly deleteMcpServer: (name: string) => void;
  readonly putMarketplace: (marketplace: FleetMarketplace) => FleetMarketplace;
  readonly deleteMarketplace: (name: string) => void;
  readonly putPlugin: (plugin: { id: string; enabled?: boolean }) => FleetPlugin;
  readonly deletePlugin: (id: string) => void;
  /** Every skill row without its files — a catalog read should not weigh megabytes. */
  readonly listSkills: () => FleetSkillMeta[];
  /** Upsert of a resolve's outcome: the files it read, or the sentence it failed with. */
  readonly putSkill: (skill: {
    name: string;
    source: string;
    enabled?: boolean;
    hash?: string;
    bytes?: number;
    error?: string;
    files?: SkillFile[];
  }) => FleetSkillMeta;
  readonly deleteSkill: (name: string) => void;
  /**
   * Every subagent the fleet keeps, file and all: a definition is a page of
   * markdown, so the listing is what the editor is seeded from.
   */
  readonly listFleetAgents: () => FleetAgent[];
  /** Upsert of one definition's file; the hash and the size are read off it. */
  readonly putFleetAgent: (agent: { name: string; content: string }) => FleetAgent;
  readonly deleteFleetAgent: (name: string) => void;
  /** The fleet's user-scope CLAUDE.md, or undefined while the fleet keeps none. */
  readonly getFleetMemory: () => { content: string; hash: string; updatedAt: Date } | undefined;
  /** Stores the document and the hash the machines compare against. */
  readonly setFleetMemory: (content: string) => { content: string; hash: string; updatedAt: Date };
  readonly clearFleetMemory: () => void;
  /**
   * Keeps a version that is about to be replaced or destroyed. `source` is
   * `fleet` for the hub's own row and `machine:<machineId>` for a copy an
   * overwrite is taking off a machine.
   */
  readonly recordFleetMemory: (version: {
    content: string;
    hash: string;
    source: string;
  }) => void;
  /** Newest first, without the content: a list should not weigh what it lists. */
  readonly listFleetMemoryHistory: () => MemoryVersion[];
  readonly fleetMemoryVersion: (id: number) => (MemoryVersion & { content: string }) | undefined;
  /** A machine's own account of what it came to, from the sync it just answered. */
  readonly setAgentFleet: (machineId: string, report: FleetSyncReport) => void;
  /**
   * Every machine, in the shape everything downstream reads them: the `fleet`
   * column is null until a machine has synced once, and `AgentRow` says absent.
   */
  readonly listAgents: () => AgentRow[];
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

/** A skill row as everything outside the hub reads it: the row, minus its files. */
const skillMeta = (row: Omit<typeof skills.$inferSelect, 'files' | 'createdAt'>): FleetSkillMeta => ({
  name: row.name,
  source: row.source,
  enabled: row.enabled,
  ...(row.hash ? { hash: row.hash } : {}),
  ...(row.bytes === null ? {} : { bytes: row.bytes }),
  ...(row.error ? { error: row.error } : {}),
});

/** A subagent row as everything outside the hub reads it. */
const agentFile = (row: typeof fleetAgents.$inferSelect): FleetAgent => ({
  name: row.name,
  content: row.content,
  hash: row.hash,
  bytes: row.bytes,
  at: row.updatedAt.getTime(),
});

/** The one row the fleet's memory ever takes: there is one document, not a list. */
const MEMORY_ID = 'memory';

/** How far back the memory can be taken. Deep enough to undo a bad day, not a log. */
const HISTORY_LIMIT = 20;

/** What a machine compares its own copy against — sha256 of the text's own bytes. */
const hashText = (content: string): string =>
  new Bun.CryptoHasher('sha256').update(content).digest('hex');

const make = (path: string): DbShape => {
  const db = drizzle(path);
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });

  const agentTools = (machineId: string): Record<string, ToolStatus> =>
    db.select({ tools: agents.tools }).from(agents).where(eq(agents.machineId, machineId)).get()
      ?.tools ?? {};

  const writeAgentTools = (machineId: string, cells: Record<string, ToolStatus>): void => {
    db.update(agents).set({ tools: cells }).where(eq(agents.machineId, machineId)).run();
  };

  const getFleetMemory = () => {
    const row = db.select().from(fleetMemory).where(eq(fleetMemory.id, MEMORY_ID)).get();
    return row ? { content: row.content, hash: row.hash, updatedAt: row.updatedAt } : undefined;
  };

  return {
    upsertAgent: ({ machineId, hostname, os, auth, build }) => {
      const lastSeenAt = new Date();
      db.insert(agents)
        .values({ machineId, hostname, os, auth, status: 'online', lastSeenAt, build })
        .onConflictDoUpdate({
          target: agents.machineId,
          set: { hostname, os, auth, status: 'online', lastSeenAt, ...(build ? { build } : {}) },
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
    openInstance: ({ id, machineId, cwd, sessionId, projectId, kind, permissionMode, model }) => {
      const now = new Date();

      // One conversation, one live row.
      //
      // An SDK session already being answered by a live process must not get a
      // second one: two rows in the rail for the same chat, two processes
      // writing one transcript, and a reader who cannot tell which is which.
      // It happens whenever a session is resumed while it is already running —
      // the catalog cannot tell a stored session from a live one — and again
      // when a returning daemon restores a row somebody had already replaced.
      if (sessionId) {
        const live = db
          .select()
          .from(instances)
          .where(
            and(
              eq(instances.sessionId, sessionId),
              ne(instances.id, id),
              inArray(instances.status, ['running', 'starting'])
            )
          )
          .get();
        if (live) return;
      }
      db.insert(instances)
        .values({
          id,
          machineId,
          cwd,
          sessionId,
          projectId,
          kind,
          permissionMode,
          model,
          status: 'running',
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: instances.id,
          // A respawn keeps whatever it does not name — session, project, and
          // the two settings the user chose.
          //
          // These used to be cleared on silence, on the reasoning that a
          // relaunch is how settings change. That reads the wrong meaning into
          // silence: a revive after a dropped daemon names no mode because it
          // has nothing to say about it, not because the user wants the default
          // back. The result was a session that quietly returned to asking
          // permission for everything, and the user setting bypass again by
          // hand. Changing a setting is an explicit value, which every caller
          // that means it already sends.
          set: {
            cwd,
            kind,
            ...(permissionMode ? { permissionMode } : {}),
            ...(model ? { model } : {}),
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
    patchInstance: (id, patch) =>
      db
        .update(instances)
        .set({ ...patch, updatedAt: new Date() })
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
    // The daemon is back and authoritative: a session it no longer carries has
    // no process any more — settled so it stays on the board instead of
    // ghosting, and separated at the source into the ones that can come back
    // and the ones whose transcript went with the process.
    settleInstances: (machineId, liveIds, resumable) => {
      // First, the ones it *does* carry. A dropped socket marks every session on
      // the machine `unknown` (see `reconcileInstances`), because from the hub's
      // side a daemon that vanished tells you nothing about the processes it
      // left behind. But the daemon coming back and naming them is exactly the
      // answer that was missing, and without this nothing ever undoes the
      // demotion: one hub restart moved every live session on a machine into
      // "not running" permanently, where the rail files it under history.
      if (liveIds.length > 0) {
        db.update(instances)
          .set({ status: 'running', lastError: null, updatedAt: new Date() })
          .where(
            and(
              eq(instances.machineId, machineId),
              eq(instances.status, 'unknown'),
              inArray(instances.id, liveIds)
            )
          )
          .run();
      }

      const orphans = db
        .select()
        .from(instances)
        .where(
          and(
            eq(instances.machineId, machineId),
            inArray(instances.status, ['running', 'starting', 'unknown']),
            liveIds.length > 0 ? notInArray(instances.id, liveIds) : undefined
          )
        )
        .all();

      const catalog = resumable && new Set(resumable);
      const updatedAt = new Date();
      for (const row of orphans) {
        const resumes = !catalog || (row.sessionId !== null && catalog.has(row.sessionId));
        db.update(instances)
          .set({
            status: 'error',
            lastError: resumes ? RESTART_RESUMABLE : RESTART_LOST,
            updatedAt,
          })
          .where(eq(instances.id, row.id))
          .run();
      }
      return orphans.map((row) => ({
        row,
        resumes: !catalog || (row.sessionId !== null && catalog.has(row.sessionId)),
      }));
    },
    listToolPolicies: () =>
      db
        .select()
        .from(tools)
        .all()
        .map(({ id, required, pinnedVersion }) => ({ id, required, pinnedVersion })),
    putToolPolicy: (id, { required, pinnedVersion }) => {
      const stored = db.select().from(tools).where(eq(tools.id, id)).get();
      const policy: ToolPolicy = {
        id,
        required: required ?? stored?.required ?? false,
        pinnedVersion: pinnedVersion === undefined ? (stored?.pinnedVersion ?? null) : pinnedVersion,
      };
      db.insert(tools)
        .values(policy)
        .onConflictDoUpdate({
          target: tools.id,
          set: { required: policy.required, pinnedVersion: policy.pinnedVersion },
        })
        .run();
      return policy;
    },
    agentTools,
    // A report with nothing in it says nothing: a daemon that predates the tool
    // catalog must not read as a machine that has just lost every tool on it.
    mergeAgentTools: (machineId, statuses) => {
      if (statuses.length === 0) return;
      writeAgentTools(machineId, {
        ...agentTools(machineId),
        ...Object.fromEntries(statuses.map((status) => [status.id, status])),
      });
    },
    setAgentToolCell: (machineId, status) => {
      writeAgentTools(machineId, { ...agentTools(machineId), [status.id]: status });
    },
    fleetConfig: () => ({
      mcp: db
        .select()
        .from(mcpServers)
        .all()
        .map(({ name, config, enabled }) => ({ name, config, enabled })),
      marketplaces: db
        .select()
        .from(marketplaces)
        .all()
        .map(({ name, source }) => ({ name, source })),
      plugins: db
        .select()
        .from(plugins)
        .all()
        .map(({ id, enabled }) => ({ id, enabled })),
      // Only the rows that resolved: a skill with no files is nothing a machine
      // could converge on, and one whose row says nothing is not sent at all.
      skills: db
        .select({ name: skills.name, hash: skills.hash, files: skills.files })
        .from(skills)
        .where(eq(skills.enabled, true))
        .all()
        .flatMap(({ name, hash, files }) => (hash && files ? [{ name, hash, files }] : [])),
      // Null rather than absent: a fleet that keeps no memory is what has a
      // machine give back the copy cockpit wrote it.
      memory: (() => {
        const stored = getFleetMemory();
        return stored ? { hash: stored.hash, content: stored.content } : null;
      })(),
    }),
    putMcpServer: ({ name, config, enabled }) => {
      const server: FleetMcpServer = { name, config, enabled: enabled ?? true };
      db.insert(mcpServers)
        .values(server)
        .onConflictDoUpdate({ target: mcpServers.name, set: { config, enabled: server.enabled } })
        .run();
      return server;
    },
    deleteMcpServer: (name) => {
      db.delete(mcpServers).where(eq(mcpServers.name, name)).run();
    },
    putMarketplace: ({ name, source }) => {
      db.insert(marketplaces)
        .values({ name, source })
        .onConflictDoUpdate({ target: marketplaces.name, set: { source } })
        .run();
      return { name, source };
    },
    deleteMarketplace: (name) => {
      db.delete(marketplaces).where(eq(marketplaces.name, name)).run();
    },
    putPlugin: ({ id, enabled }) => {
      const plugin: FleetPlugin = { id, enabled: enabled ?? true };
      db.insert(plugins)
        .values(plugin)
        .onConflictDoUpdate({ target: plugins.id, set: { enabled: plugin.enabled } })
        .run();
      return plugin;
    },
    deletePlugin: (id) => {
      db.delete(plugins).where(eq(plugins.id, id)).run();
    },
    listSkills: () =>
      db
        .select({
          name: skills.name,
          source: skills.source,
          enabled: skills.enabled,
          hash: skills.hash,
          bytes: skills.bytes,
          error: skills.error,
        })
        .from(skills)
        .all()
        .map(skillMeta),
    putSkill: ({ name, source, enabled, hash, bytes, error, files }) => {
      const stored = db.select().from(skills).where(eq(skills.name, name)).get();
      // A resolve that failed on the source the row already carries keeps the
      // last copy that worked: the machines are serving it, and a repo that was
      // unreachable for a minute is no reason to take a working skill off them.
      const keep = error !== undefined && stored?.source === source;
      const row = {
        name,
        source,
        enabled: enabled ?? true,
        hash: (keep ? stored.hash : hash) ?? null,
        bytes: (keep ? stored.bytes : bytes) ?? null,
        error: error ?? null,
        files: (keep ? stored.files : files) ?? null,
      };
      db.insert(skills)
        .values(row)
        .onConflictDoUpdate({
          target: skills.name,
          set: {
            source: row.source,
            enabled: row.enabled,
            hash: row.hash,
            bytes: row.bytes,
            error: row.error,
            files: row.files,
          },
        })
        .run();
      return skillMeta(row);
    },
    deleteSkill: (name) => {
      db.delete(skills).where(eq(skills.name, name)).run();
    },
    listFleetAgents: () =>
      db.select().from(fleetAgents).orderBy(fleetAgents.name).all().map(agentFile),
    putFleetAgent: ({ name, content }) => {
      const row = {
        name,
        content,
        hash: hashText(content),
        bytes: Buffer.byteLength(content),
        updatedAt: new Date(),
      };
      db.insert(fleetAgents)
        .values(row)
        .onConflictDoUpdate({
          target: fleetAgents.name,
          set: { content: row.content, hash: row.hash, bytes: row.bytes, updatedAt: row.updatedAt },
        })
        .run();
      return agentFile(row);
    },
    deleteFleetAgent: (name) => {
      db.delete(fleetAgents).where(eq(fleetAgents.name, name)).run();
    },
    getFleetMemory,
    setFleetMemory: (content) => {
      const row = { id: MEMORY_ID, content, hash: hashText(content), updatedAt: new Date() };
      db.insert(fleetMemory)
        .values(row)
        .onConflictDoUpdate({
          target: fleetMemory.id,
          set: { content: row.content, hash: row.hash, updatedAt: row.updatedAt },
        })
        .run();
      return { content: row.content, hash: row.hash, updatedAt: row.updatedAt };
    },
    clearFleetMemory: () => {
      db.delete(fleetMemory).where(eq(fleetMemory.id, MEMORY_ID)).run();
    },
    recordFleetMemory: ({ content, hash, source }) => {
      db.insert(fleetMemoryHistory).values({ content, hash, source }).run();
      const keep = db
        .select({ id: fleetMemoryHistory.id })
        .from(fleetMemoryHistory)
        .orderBy(desc(fleetMemoryHistory.id))
        .limit(HISTORY_LIMIT)
        .all()
        .map((row) => row.id);
      db.delete(fleetMemoryHistory).where(notInArray(fleetMemoryHistory.id, keep)).run();
    },
    listFleetMemoryHistory: () =>
      db
        .select()
        .from(fleetMemoryHistory)
        .orderBy(desc(fleetMemoryHistory.id))
        .all()
        .map(({ id, hash, source, content, createdAt }) => ({
          id,
          hash,
          source,
          bytes: Buffer.byteLength(content),
          createdAt,
        })),
    fleetMemoryVersion: (id) => {
      const row = db
        .select()
        .from(fleetMemoryHistory)
        .where(eq(fleetMemoryHistory.id, id))
        .get();
      return row
        ? {
            id: row.id,
            hash: row.hash,
            source: row.source,
            bytes: Buffer.byteLength(row.content),
            createdAt: row.createdAt,
            content: row.content,
          }
        : undefined;
    },
    setAgentFleet: (machineId, report) => {
      db.update(agents).set({ fleet: report }).where(eq(agents.machineId, machineId)).run();
    },
    listAgents: () =>
      db
        .select()
        .from(agents)
        .all()
        .map(({ fleet, build, ...agent }) => ({
          ...agent,
          ...(fleet ? { fleet } : {}),
          ...(build ? { build } : {}),
        })),
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
