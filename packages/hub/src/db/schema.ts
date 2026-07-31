import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

const timestamp = (column: string) => integer(column, { mode: 'timestamp_ms' });

/** Machines running an agent daemon, keyed by their stable hardware fingerprint. */
export const agents = sqliteTable('agents', {
  machineId: text('machine_id').primaryKey(),
  hostname: text('hostname').notNull(),
  os: text('os').notNull(),
  status: text('status').$type<'online' | 'offline'>().notNull().default('offline'),
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
  /** `unknown`: the agent socket dropped, so the hub can no longer see the session. */
  status: text('status')
    .$type<'starting' | 'running' | 'stopped' | 'discarded' | 'unknown'>()
    .notNull()
    .default('starting'),
  createdAt: timestamp('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt: timestamp('updated_at').notNull().$defaultFn(() => new Date()),
});

/** OAuth credentials the hub refreshes and distributes to agents on spawn. */
export const credentials = sqliteTable('credentials', {
  id: text('id').primaryKey(),
  /** `~/.claude/.credentials.json`-shaped blob, stored verbatim. */
  blob: text('blob', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  expiresAt: timestamp('expires_at'),
  updatedAt: timestamp('updated_at').notNull().$defaultFn(() => new Date()),
});
