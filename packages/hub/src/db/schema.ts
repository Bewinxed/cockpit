import type {
  AuthState,
  BuildInfo,
  ClaudeLimits,
  FleetMcpConfig,
  FleetSyncReport,
  HarnessReport,
  RuleMatchKind,
  RuleScope,
  RuleTiming,
  RuleWatch,
  SkillFile,
  ToolStatus,
} from '@cockpit/core';
import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

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
  /** What each harness adapter on the machine can do, as reported at register. */
  harnesses: text('harnesses', { mode: 'json' }).$type<HarnessReport[]>(),
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
  /** Which harness owns `sessionId` — what a resume and a catalog read route on. */
  harness: text('harness'),
  /** The instance this one is a delegate of (nested under it in every rail). */
  parentInstanceId: text('parent_instance_id'),
  /** The delegating tool call, so the parent transcript can render the round trip. */
  parentToolUseId: text('parent_tool_use_id'),
  cwd: text('cwd').notNull(),
  /**
   * What the session is for, one line, as its spawn said: a delegate's brief
   * headline. Null on a session that was started without one — the rails fall
   * back to the transcript's own title, then to where it runs.
   */
  title: text('title'),
  /** `scratch`: a side quest (NEW.md §1), shown apart from mainline work. */
  kind: text('kind').$type<'mainline' | 'scratch'>().notNull().default('mainline'),
  /**
   * How the session answers tool permissions, and which model answers: two of
   * the three settings the user keeps changing, so a dashboard that was not open
   * when they chose still shows what the session is really running. Null until a
   * spawn or a session's own `init` says.
   */
  permissionMode: text('permission_mode'),
  model: text('model'),
  /**
   * The third: how hard that model thinks. No `init` reports it back, so this
   * column is the only place it is written down — and what a restart reads to
   * hand the session back at the level it was working at.
   */
  effort: text('effort'),
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

/** The three things a delegate and its parent ever say to each other. */
export type DelegateEventKind = 'ask' | 'answer' | 'report';

/** An ask's life: parked on the parent, then allowed or refused by it. */
export type DelegateAskStatus = 'pending' | 'answered' | 'denied';

/** What each kind carries: the ask's own input, the answer, the turn's report. */
export type DelegateEventPayload =
  | { input: unknown }
  | { behavior: string; answers?: Record<string, unknown> }
  | { body: string; failed: boolean };

/**
 * What a delegate and its parent said to each other through the hub: every ask
 * routed up, every answer back, every turn's report. The messages themselves
 * are the harnesses' copies; this is the hub's own record, so a reader that was
 * not watching does not have to reconstruct the exchange out of transcript text.
 */
export const delegateEvents = sqliteTable('delegate_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  /** The delegate the traffic is about — never the parent, on any of the kinds. */
  instanceId: text('instance_id').notNull(),
  parentInstanceId: text('parent_instance_id').notNull(),
  kind: text('kind').$type<DelegateEventKind>().notNull(),
  /** The permission request an ask and its answer share. Null on a report. */
  requestId: text('request_id'),
  toolName: text('tool_name'),
  requestKind: text('request_kind').$type<'question' | 'tool'>(),
  payload: text('payload', { mode: 'json' }).$type<DelegateEventPayload>().notNull(),
  /** An ask's own state; null on an answer and a report, which settle nothing. */
  status: text('status').$type<DelegateAskStatus>(),
  createdAt: timestamp('created_at').notNull().$defaultFn(() => new Date()),
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

/**
 * The subagent definitions the fleet writes into `~/.claude/agents/` (NEW.md
 * §11). A subagent is its markdown file, so the file is what is stored — front
 * matter and prompt body verbatim — and the front matter's own `name`, which is
 * what a delegation asks for, is the key.
 */
export const fleetAgents = sqliteTable('fleet_agents', {
  /** Also the file it lands in on every machine: `<name>.md`. */
  name: text('name').primaryKey(),
  content: text('content').notNull(),
  /** sha256 hex of the content — what tells a machine's copy apart from this. */
  hash: text('hash').notNull(),
  bytes: integer('bytes').notNull(),
  updatedAt: timestamp('updated_at').notNull().$defaultFn(() => new Date()),
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
 * The documents the main memory links (NEW.md §11): one row per path under
 * `~/.claude/memories/`, which is the same string on every machine. Separate
 * rows rather than a blob on the memory, because the set converges file by
 * file — a hash per document is what lets one of them drift alone.
 */
export const fleetMemoryDocs = sqliteTable('fleet_memory_docs', {
  /** `models/claude-opus-5.md` — relative, forward-slashed, and the key. */
  path: text('path').primaryKey(),
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
  /**
   * Which document of the set this was a version of; null is the main
   * CLAUDE.md, which is every row written before the set existed.
   */
  path: text('path'),
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

/**
 * One (session, model, hour) bucket of usage the agent reports (USAGE-SPEC.md
 * §6.1). The id is the full `${machineId}:${harness}:${sessionId}:${model}:
 * ${hourStart}` key, so a re-report of the same bucket is an idempotent upsert
 * over absolute totals rather than an addition.
 */
export const usageBuckets = sqliteTable(
  'usage_buckets',
  {
    /** `${machineId}:${harness}:${sessionId}:${model}:${hourStart}` */
    id: text('id').primaryKey(),
    machineId: text('machine_id').notNull(),
    harness: text('harness').$type<'claude' | 'opencode'>().notNull(),
    hourStart: integer('hour_start').notNull(),
    firstTs: integer('first_ts').notNull(),
    lastTs: integer('last_ts').notNull(),
    sessionId: text('session_id').notNull(),
    project: text('project').notNull(),
    projectPath: text('project_path'),
    model: text('model').notNull(),
    provider: text('provider'),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    cacheCreationTokens: integer('cache_creation_tokens').notNull().default(0),
    cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
    reasoningTokens: integer('reasoning_tokens').notNull().default(0),
    costUsd: real('cost_usd').notNull().default(0),
    messages: integer('messages').notNull().default(0),
    updatedAt: timestamp('updated_at').notNull().$defaultFn(() => new Date()),
  },
  (table) => [
    index('usage_buckets_hour_start_idx').on(table.hourStart),
    index('usage_buckets_machine_harness_hour_idx').on(table.machineId, table.harness, table.hourStart),
    index('usage_buckets_session_idx').on(table.sessionId),
  ]
);

/**
 * The last limit reading each machine's daemon fetched from the Anthropic API
 * (USAGE-SPEC.md §6.1). One row per machine — the account it is signed in to.
 */
export const usageLimits = sqliteTable('usage_limits', {
  machineId: text('machine_id').primaryKey(),
  payload: text('payload', { mode: 'json' }).$type<ClaudeLimits>().notNull(),
  fetchedAt: timestamp('fetched_at').notNull().$defaultFn(() => new Date()),
});

/**
 * Standing instructions the hub enforces on every session it watches: a phrase
 * to look for in what a session says, and a reply to send back when it shows
 * up. The hub is the only component that sees every frame from every machine,
 * so it is the only one that can do this without a per-harness hook.
 *
 * The matching fields mirror `Rule` in `@cockpit/core` one-for-one; the matcher
 * itself is shared with the dashboard so the editor's test box and the fleet
 * agree on what fires.
 */
export const rules = sqliteTable('rules', {
  id: text('id').primaryKey(),
  /** What the rule is called in the list, and in the reply the session reads. */
  name: text('name').notNull(),
  /** A disabled rule stays here, keeps its history, and stops firing. */
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  pattern: text('pattern').notNull(),
  matchKind: text('match_kind').$type<RuleMatchKind>().notNull().default('phrase'),
  caseSensitive: integer('case_sensitive', { mode: 'boolean' }).notNull().default(false),
  wholeWord: integer('whole_word', { mode: 'boolean' }).notNull().default(false),
  /** Whether the rule reads the session's answer, its reasoning, or both. */
  watch: text('watch').$type<RuleWatch>().notNull().default('text'),
  reply: text('reply').notNull(),
  /** `turn` wakes an idle session, `message` queues, `immediate` cuts in. */
  timing: text('timing').$type<RuleTiming>().notNull().default('turn'),
  /** `immediate` only: deliver mid-turn instead of waiting for a boundary. */
  interrupt: integer('interrupt', { mode: 'boolean' }).notNull().default(false),
  /**
   * The teeth. On, a fired rule stays pending and fires again on every further
   * match until the session calls `acknowledge_rule`. Off, it fires once per
   * session and goes quiet — which is a nudge a model can simply walk past.
   */
  requireAck: integer('require_ack', { mode: 'boolean' }).notNull().default(true),
  /** Optional narrowing — machine, project, harness, model. Empty means everywhere. */
  scope: text('scope', { mode: 'json' }).$type<RuleScope>().notNull().default({}),
  createdAt: timestamp('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt: timestamp('updated_at').notNull().$defaultFn(() => new Date()),
});

/**
 * Where one rule stands with one session: the state machine behind the nagging.
 * `armed` fires on the next match; `pending` has fired and is waiting to be
 * acknowledged, and fires again every time it matches until it is.
 *
 * Rows are keyed by `${ruleId}:${instanceId}` rather than a composite primary
 * key so the upsert path is the same single-column `onConflictDoUpdate` every
 * other table here uses.
 */
export const ruleState = sqliteTable(
  'rule_state',
  {
    /** `${ruleId}:${instanceId}` */
    id: text('id').primaryKey(),
    ruleId: text('rule_id').notNull(),
    instanceId: text('instance_id').notNull(),
    status: text('status').$type<'armed' | 'pending'>().notNull().default('armed'),
    /** Fires since the last acknowledgement — what makes the reminder escalate. */
    fireCount: integer('fire_count').notNull().default(0),
    /** Fires over the session's whole life, which acknowledging does not reset. */
    totalFires: integer('total_fires').notNull().default(0),
    lastFiredAt: timestamp('last_fired_at'),
    ackedAt: timestamp('acked_at'),
    /** What the session said it did about it, in its own words. */
    ackNote: text('ack_note'),
  },
  (table) => [
    index('rule_state_rule_idx').on(table.ruleId),
    index('rule_state_instance_idx').on(table.instanceId),
  ]
);
