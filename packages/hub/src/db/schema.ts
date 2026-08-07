import type {
  AuthState,
  BuildInfo,
  FleetMcpConfig,
  FleetSyncReport,
  SkillFile,
  ToolStatus,
} from '@cockpit/core';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

const timestamp = (column: string) => integer(column, { mode: 'timestamp_ms' });

/** Machines running an agent daemon, keyed by their stable hardware fingerprint. */
export const agents = sqliteTable('agents', {
  machineId: text('machine_id').primaryKey(),
  hostname: text('hostname').notNull(),
  os: text('os').notNull(),
  status: text('status').$type<'online' | 'offline'>().notNull().default('offline'),
  /** What the daemon found about Claude Code's credentials, last time it registered. */
  auth: text('auth')
    .$type<AuthState | 'unknown'>()
    .notNull()
    .default('unknown'),
  /**
   * Last-known workflow-tool status by catalog id (NEW.md §10): what the daemon
   * reported at register or after an install, plus the `installing` the hub
   * writes itself while one is in flight.
   */
  tools: text('tools', { mode: 'json' })
    .$type<Record<string, ToolStatus>>()
    .notNull()
    .default({}),
  /**
   * What the machine came to the last time it converged on the fleet's MCP
   * servers and plugins (NEW.md §11). Null until it has been asked once.
   */
  fleet: text('fleet', { mode: 'json' }).$type<FleetSyncReport>(),
  /**
   * The cockpit the daemon is running (NEW.md §12), as it reported at register.
   * Null until a daemon that says so has registered once.
   */
  build: text('build', { mode: 'json' }).$type<BuildInfo>(),
  lastSeenAt: timestamp('last_seen_at'),
  createdAt: timestamp('created_at').notNull().$defaultFn(() => new Date()),
});

/** A repository checkout on a machine; groups instances in the sidebar. */
export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  machineId: text('machine_id')
    .notNull()
    .references(() => agents.machineId),
  name: text('name').notNull(),
  cwd: text('cwd').notNull(),
  createdAt: timestamp('created_at').notNull().$defaultFn(() => new Date()),
});

/** A running or resumable `query()`. Messages live in SDK session storage, not here. */
export const instances = sqliteTable('instances', {
  id: text('id').primaryKey(),
  machineId: text('machine_id')
    .notNull()
    .references(() => agents.machineId),
  projectId: text('project_id').references(() => projects.id),
  /** SDK session id, absent until the first init frame arrives. */
  sessionId: text('session_id'),
  cwd: text('cwd').notNull(),
  /** `scratch`: a side quest (NEW.md §1), shown apart from mainline work. */
  kind: text('kind').$type<'mainline' | 'scratch'>().notNull().default('mainline'),
  /**
   * How the session answers tool permissions, and which model answers: the two
   * settings the user keeps changing, so a dashboard that was not open when they
   * chose still shows what the session is really running. Null until a spawn or
   * a session's own `init` says.
   */
  permissionMode: text('permission_mode'),
  model: text('model'),
  /** `unknown`: the agent socket dropped, so the hub can no longer see the session. */
  status: text('status')
    .$type<'starting' | 'running' | 'stopped' | 'discarded' | 'unknown' | 'error'>()
    .notNull()
    .default('starting'),
  /** Why the session died, for a dashboard that was not watching when it did. */
  lastError: text('last_error'),
  createdAt: timestamp('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt: timestamp('updated_at').notNull().$defaultFn(() => new Date()),
});

/**
 * What the fleet is supposed to have (NEW.md §10). One row per catalog tool the
 * user has said anything about — a tool with no row is nobody's requirement,
 * which is why the catalog stays in code and only the policy is stored.
 */
export const tools = sqliteTable('tools', {
  /** A `TOOL_CATALOG` id; the route checks it, so the column stays a plain key. */
  id: text('id').primaryKey(),
  /** Installed automatically wherever a register finds it missing. */
  required: integer('required', { mode: 'boolean' }).notNull().default(false),
  /** Null takes whatever the installer calls latest. */
  pinnedVersion: text('pinned_version'),
  createdAt: timestamp('created_at').notNull().$defaultFn(() => new Date()),
});

/**
 * The MCP servers every machine's Claude Code should have (NEW.md §11). The
 * config is stored verbatim and written into `~/.claude.json` verbatim: what
 * the servers mean is the CLI's affair, not the hub's.
 */
export const mcpServers = sqliteTable('mcp_servers', {
  /** The name sessions see, and the key the entry takes in `~/.claude.json`. */
  name: text('name').primaryKey(),
  config: text('config', { mode: 'json' }).$type<FleetMcpConfig>().notNull(),
  /** A disabled row stays here and is removed from the machines. */
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: timestamp('created_at').notNull().$defaultFn(() => new Date()),
});

/** The plugin marketplaces the fleet links, so their skills can be installed. */
export const marketplaces = sqliteTable('marketplaces', {
  name: text('name').primaryKey(),
  /** Whatever `claude plugin marketplace add` accepts, passed through verbatim. */
  source: text('source').notNull(),
  createdAt: timestamp('created_at').notNull().$defaultFn(() => new Date()),
});

/** The plugins the fleet installs, by the CLI's own `plugin@marketplace` id. */
export const plugins = sqliteTable('plugins', {
  id: text('id').primaryKey(),
  /** A disabled row is uninstalled from the machines, not merely switched off. */
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: timestamp('created_at').notNull().$defaultFn(() => new Date()),
});

/**
 * The plain skills the fleet writes into `~/.claude/skills/` (NEW.md §11). The
 * hub resolves a source once and keeps the files here, so a machine that joins
 * tomorrow is sent them without anything being downloaded again.
 */
export const skills = sqliteTable('skills', {
  /** The directory the files land in on every machine. */
  name: text('name').primaryKey(),
  /** A `skills:` / `github:` / `npm:` / URL source, stored as the user gave it. */
  source: text('source').notNull(),
  /** A disabled row stays here and is deleted from the machines. */
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  /** Null until a resolve succeeds; a machine writes only when this changes. */
  hash: text('hash'),
  bytes: integer('bytes'),
  /** Why the last resolve failed. A failed row is kept so the dashboard can say so. */
  error: text('error'),
  files: text('files', { mode: 'json' }).$type<SkillFile[]>(),
  createdAt: timestamp('created_at').notNull().$defaultFn(() => new Date()),
});

/** The fleet's user-scope CLAUDE.md — one row, one document (NEW.md §11). */
export const fleetMemory = sqliteTable('fleet_memory', {
  /** Always `memory`: the fleet has one, and a table with a key says so cheaply. */
  id: text('id').primaryKey(),
  content: text('content').notNull(),
  /** sha256 hex of the content, which is what a machine compares before writing. */
  hash: text('hash').notNull(),
  updatedAt: timestamp('updated_at').notNull().$defaultFn(() => new Date()),
});

/**
 * What the fleet's memory used to say. Every change records the version it
 * replaced — including the copy an overwrite is about to destroy on a machine —
 * so a document nobody else has is never one click away from being gone.
 */
export const fleetMemoryHistory = sqliteTable('fleet_memory_history', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  content: text('content').notNull(),
  hash: text('hash').notNull(),
  /** `fleet` for the hub's own row; `machine:<machineId>` for a copy taken off one. */
  source: text('source').notNull(),
  createdAt: timestamp('created_at').notNull().$defaultFn(() => new Date()),
});

/** OAuth credentials the hub refreshes and distributes to agents on spawn. */
export const credentials = sqliteTable('credentials', {
  id: text('id').primaryKey(),
  /** `~/.claude/.credentials.json`-shaped blob, stored verbatim. */
  blob: text('blob', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  expiresAt: timestamp('expires_at'),
  updatedAt: timestamp('updated_at').notNull().$defaultFn(() => new Date()),
});
