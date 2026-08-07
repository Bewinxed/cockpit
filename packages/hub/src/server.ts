import type {
  AgentRow,
  BuildInfo,
  ControlPayload,
  Envelope,
  FleetConfig,
  FleetMcpConfig,
  FleetSyncReport,
  FramePayload,
  InstanceRow,
  PermissionMode,
  SpawnPayload,
  ToolState,
  ToolStatus,
  Verb,
} from '@cockpit/core';
import {
  AGENT_BUSY,
  FLEET_STATUS,
  FLEET_SYNC,
  READ_MEMORY_FILE,
  TOOL_CATALOG,
  toolSpec,
  UPDATE_COCKPIT,
} from '@cockpit/core';
import { Elysia, t } from 'elysia';
import { websocket } from 'elysia/websocket';
import { buildInfo } from './build';
import { HUB_VERSION } from './config';
import type { AgentAuth, DbShape, InstanceKind } from './db';
import type { PendingShape } from './pending';
import type { HubSocket, RegistryShape } from './registry';
import { resolveSkill } from './skills';

/** The frame a forwarded `control` comes back as, whoever asked for it. */
type ControlResult = Extract<FramePayload, { kind: 'control_result' }>;

/** A busy probe is polled in a loop before a restart, so it answers fast or not at all. */
const BUSY_TIMEOUT_MS = 5_000;

/** An update is a pull, an install and a dashboard build — minutes, not seconds. */
const UPDATE_TIMEOUT_MS = 10 * 60_000;

/** Reading one file off a machine: it answers about as fast as a disk does. */
const READ_TIMEOUT_MS = 10_000;

export interface HubServices {
  readonly registry: RegistryShape;
  readonly db: DbShape;
  readonly pending: PendingShape;
}

const isEnvelope = (value: unknown): value is Envelope =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as Envelope).verb === 'string' &&
  typeof (value as Envelope).machineId === 'string';

const ack = (envelope: Envelope): Envelope<{ ok: true }> => ({
  verb: envelope.verb,
  machineId: envelope.machineId,
  payload: { ok: true },
});

/** Sent back as a frame, the only verb a dashboard renders. */
const failure = (
  envelope: Envelope,
  message: string,
): Envelope<{ kind: 'error'; verb: Verb; message: string }> => ({
  verb: 'frames',
  machineId: envelope.machineId,
  instanceId: envelope.instanceId,
  requestId: envelope.requestId,
  payload: { kind: 'error', verb: envelope.verb, message },
});

/**
 * The hub routes on envelope fields and is otherwise payload-opaque (NEW.md
 * §6); `hostname`/`os`/`tools` on register, `cwd`/`options.resume`/`scratch`/
 * `projectId`/`permissionMode`/`model` on spawn, `discard` on stop, `kind` on a
 * frame, `method`/`args` on a control and a `control_result`'s `result` are the
 * sanctioned peeks.
 */
const peek = (payload: unknown, key: string): string | undefined => {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
};

/** The SDK session a `spawn` resumes, so the instance row records what it re-opened. */
const peekResume = (payload: unknown): string | undefined => {
  if (typeof payload !== 'object' || payload === null) return undefined;
  return peek((payload as Record<string, unknown>).options, 'resume');
};

/** A spawn asking for scratch isolation, or for a session the SDK never stores. */
const peekKind = (payload: unknown): InstanceKind => {
  if (typeof payload !== 'object' || payload === null) return 'mainline';
  const { scratch, options } = payload as { scratch?: unknown; options?: unknown };
  const ephemeral =
    typeof options === 'object' &&
    options !== null &&
    (options as { persistSession?: unknown }).persistSession === false;
  return scratch || ephemeral ? 'scratch' : 'mainline';
};

/** The states a daemon is allowed to claim; anything else is a daemon we do not know. */
const AUTH_STATES: readonly AgentAuth[] = [
  'authenticated',
  'unauthenticated',
  'unreadable-credentials',
];

/** `register`'s word on whether the machine can reach Claude Code's credentials. */
const peekAuth = (payload: unknown): AgentAuth => {
  const claimed = peek(payload, 'auth') as AgentAuth | undefined;
  return claimed && AUTH_STATES.includes(claimed) ? claimed : 'unknown';
};

/** `register`'s list of the sessions the daemon still has running. */
const peekInstances = (payload: unknown): string[] => {
  if (typeof payload !== 'object' || payload === null) return [];
  const value = (payload as { instances?: unknown }).instances;
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
};

/**
 * And of the SDK sessions it could resume. Absent from a daemon that could not
 * read its catalog, which is not the same as a machine with nothing to resume.
 */
const peekResumable = (payload: unknown): string[] | undefined => {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const value = (payload as { resumable?: unknown }).resumable;
  if (!Array.isArray(value)) return undefined;
  return value.filter((id): id is string => typeof id === 'string');
};

/**
 * `register`'s word on the cockpit the daemon is running (NEW.md §12). Absent
 * from a daemon that predates it and from the re-announce, and the row keeps
 * what it had either way.
 */
const peekBuild = (payload: unknown): BuildInfo | undefined => {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const build = (payload as { build?: unknown }).build;
  if (typeof build !== 'object' || build === null) return undefined;
  return typeof (build as BuildInfo).version === 'string' ? (build as BuildInfo) : undefined;
};

/** The states a daemon may claim for a tool; anything else is not a status. */
const TOOL_STATES: readonly ToolState[] = [
  'installed',
  'missing',
  'installing',
  'failed',
  'unsupported',
];

const isToolStatus = (value: unknown): value is ToolStatus =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as ToolStatus).id === 'string' &&
  TOOL_STATES.includes((value as ToolStatus).state);

/**
 * `register`'s word on what the machine has of the tool catalog (NEW.md §10).
 * Empty from a daemon that predates the feature, which is not the same as a
 * machine with none of them — the difference is what stops the hub installing
 * the whole catalog onto a daemon that has never been asked.
 */
const peekTools = (payload: unknown): ToolStatus[] => {
  if (typeof payload !== 'object' || payload === null) return [];
  const value = (payload as { tools?: unknown }).tools;
  return Array.isArray(value) ? value.filter(isToolStatus) : [];
};

/** A `control` asking a machine to install a tool, and the tool it names. */
const peekInstall = (payload: unknown): string | undefined => {
  if (peek(payload, 'method') !== 'installTool') return undefined;
  const args = (payload as { args?: unknown }).args;
  const id = Array.isArray(args) ? args[0] : undefined;
  return typeof id === 'string' ? id : undefined;
};

/** And what the machine answered it with. */
const peekToolStatus = (payload: unknown): ToolStatus | undefined => {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const result = (payload as { result?: unknown }).result;
  return isToolStatus(result) ? result : undefined;
};

const isRecord = (value: unknown): boolean => typeof value === 'object' && value !== null;

/** A sync's three tables of states, which is what tells a report from any other answer. */
const isFleetReport = (value: unknown): value is FleetSyncReport =>
  isRecord(value) &&
  isRecord((value as FleetSyncReport).mcp) &&
  isRecord((value as FleetSyncReport).marketplaces) &&
  isRecord((value as FleetSyncReport).plugins);

/** What a machine answered a `syncFleetConfig` with (NEW.md §11). */
const peekFleetReport = (payload: unknown): FleetSyncReport | undefined => {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const result = (payload as { result?: unknown }).result;
  return isFleetReport(result) ? result : undefined;
};

/** What the CLI will take as an MCP server name — it keys `~/.claude.json` by it. */
const MCP_NAME = /^[A-Za-z0-9_-]+$/;

/** And the names Claude Code keeps for its own servers, which are not the user's to take. */
const RESERVED_MCP_NAMES = [
  'workspace',
  'claude-in-chrome',
  'computer-use',
  'Claude Preview',
  'Claude Browser',
];

/**
 * Why the hub will not store this server, or nothing. The config itself is
 * stored verbatim — what a server means is the CLI's affair — but an entry
 * missing the one field that makes it startable is a row no machine can apply.
 */
const mcpProblem = (name: string, config: Record<string, unknown>): string | undefined => {
  if (!MCP_NAME.test(name)) return `${name} is not a usable MCP server name`;
  if (RESERVED_MCP_NAMES.includes(name)) return `${name} is Claude Code's own`;
  if ('url' in config || config.type === 'http' || config.type === 'sse') {
    return typeof config.type === 'string' && typeof config.url === 'string'
      ? undefined
      : 'a remote MCP server needs both a type and a url';
  }
  return typeof config.command === 'string' ? undefined : 'a stdio MCP server needs a command';
};

/** What a skill may be called: it names a directory under `~/.claude/skills`. */
const SKILL_NAME = /^[A-Za-z0-9._-]+$/;

/** Whether a machine's last report says it still has anything of the fleet's on it. */
const holdsFleet = (report: FleetSyncReport | undefined): boolean =>
  report !== undefined &&
  ([report.mcp, report.marketplaces, report.plugins, report.skills].some((states) =>
    Object.values(states ?? {}).some((item) => item.state !== 'removed')
  ) ||
    (report.memory !== undefined && report.memory.state !== 'removed'));

/** What a machine answered `readMemoryFile` with: its own CLAUDE.md, or nothing. */
type MachineMemory = { content: string; hash: string } | null;

const peekMemoryFile = (result: unknown): MachineMemory => {
  if (typeof result !== 'object' || result === null) return null;
  const { content, hash } = result as { content?: unknown; hash?: unknown };
  return typeof content === 'string' && typeof hash === 'string' ? { content, hash } : null;
};

/** A read of a machine's memory, or the status the route should answer with. */
type MemoryRead = { ok: true; copy: MachineMemory } | { ok: false; code: 404 | 500 | 504; said: string };

/**
 * What an `init` frame announces: the SDK session, which is what lets a
 * dashboard that joins a live session late read its transcript back, and the
 * directory the agent really opened it in — the spawn's `cwd` after the agent
 * expanded it.
 */
const peekInit = (payload: unknown): { sessionId: string; cwd?: string } | undefined => {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const message = (payload as { message?: unknown }).message;
  if (typeof message !== 'object' || message === null) return undefined;
  const sdk = message as Record<string, unknown>;
  if (sdk.type !== 'system' || sdk.subtype !== 'init') return undefined;
  if (typeof sdk.session_id !== 'string') return undefined;
  return { sessionId: sdk.session_id, cwd: typeof sdk.cwd === 'string' ? sdk.cwd : undefined };
};

/** `stop { discard: true }`: the side quest is being thrown away, not paused. */
const peekDiscard = (payload: unknown): boolean =>
  typeof payload === 'object' &&
  payload !== null &&
  (payload as { discard?: unknown }).discard === true;

/**
 * A `send` that is one session addressing another, rather than a reader typing.
 * The hub stays payload-opaque otherwise; this is a sanctioned peek, and it is
 * the only way the fleet can be told a session is carrying handed work.
 */
const peekPeer = (payload: unknown): string | undefined => {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const message = (payload as { message?: { origin?: { kind?: string; name?: string } } }).message;
  if (message?.origin?.kind !== 'peer') return undefined;
  return message.origin.name ?? 'another session';
};

/**
 * A `send` that starts a turn. A queued hand-off (`shouldQuery: false`) is read
 * when the *next querying message* folds it into a turn — so that send, not any
 * turn ending, is the moment it stops being outstanding. Clearing on turn end
 * was wrong twice over: a turn already in flight when the hand-off landed
 * cleared it unread, and the SDK acknowledges even a queued append with result
 * frames, which cleared it within seconds of arriving.
 */
const isQuerySend = (payload: unknown): boolean => {
  if (typeof payload !== 'object' || payload === null) return false;
  const message = (payload as { message?: { shouldQuery?: unknown } }).message;
  return message?.shouldQuery !== false;
};

export const createServer = ({ registry, db, pending }: HubServices) => {
  /**
   * Sessions that have been handed work and have not answered it yet, kept here
   * rather than in a browser: a hand-off learnt by whichever tab happened to be
   * watching is invisible on every other device, and gone after a reload.
   */
  const handoffs = new Map<string, { from: string; at: number }>();
  /**
   * Installs somebody is waiting on, by `requestId`: what keeps a machine from
   * being sent the same install twice while the first is still running, and
   * what tells a `control_result` that it is carrying a tool's status.
   */
  const pendingInstalls = new Map<string, { machineId: string; toolId: string }>();
  /**
   * Fleet syncs somebody is waiting on, by `requestId` → the machine running
   * one: what tells a `control_result` that it is carrying a machine's own
   * account of the fleet config rather than an answer for whoever asked.
   */
  const pendingFleet = new Map<string, string>();
  /**
   * Controls a REST call is waiting on, by `requestId`. A dashboard's control is
   * answered over the socket it asked on; a route has nothing to hold the reply
   * against but this.
   */
  const waiting = new Map<string, (frame: ControlResult) => void>();

  /**
   * Asks a machine something and waits for the frame that answers it. A machine
   * that is not connected and one that will not answer are told apart on
   * purpose: the first is the fleet's own state, the second is a machine that
   * has something wrong with it.
   */
  const callAgent = (
    machineId: string,
    method: string,
    args: unknown[],
    timeoutMs: number
  ): Promise<ControlResult | 'offline' | 'timeout'> => {
    const agent = registry.agent(machineId);
    if (!agent) return Promise.resolve('offline');

    const requestId = crypto.randomUUID();
    const payload: ControlPayload = { requestId, method, args };
    agent.send({ verb: 'control', machineId, payload } satisfies Envelope<ControlPayload>);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        waiting.delete(requestId);
        resolve('timeout');
      }, timeoutMs);
      waiting.set(requestId, (frame) => {
        clearTimeout(timer);
        resolve(frame);
      });
    });
  };

  /** Relays a dashboard envelope to its machine; reports back if nobody is home. */
  const forward = (envelope: Envelope, dashboard: HubSocket): boolean => {
    const agent = registry.agent(envelope.machineId);
    if (!agent) {
      dashboard.send(failure(envelope, `machine ${envelope.machineId} is not connected`));
      return false;
    }
    agent.send(envelope);
    return true;
  };

  /**
   * Every row, to every dashboard, after any one of them moves — a session
   * opening, failing, settling or being discarded is fleet news, and a rail
   * that only learns it by re-fetching is a rail that lies until you reload.
   * The whole table because it is small and a snapshot cannot drift.
   */
  /**
   * Starts a settled session again on the daemon that just registered.
   *
   * Deliberately not a revive-on-demand: a session the user left running was
   * left running on purpose, and a restart they did not ask for should not be
   * something they have to repair one row at a time.
   */
  const restore = (agent: HubSocket, row: InstanceRow): void => {
    const payload: SpawnPayload = {
      instanceId: row.id,
      cwd: row.cwd,
      options: { resume: row.sessionId ?? undefined },
      ...(row.permissionMode ? { permissionMode: row.permissionMode as PermissionMode } : {}),
      ...(row.model ? { model: row.model } : {}),
      ...(row.projectId ? { projectId: row.projectId } : {}),
    };
    agent.send({ verb: 'spawn', machineId: row.machineId, instanceId: row.id, payload });
    db.openInstance({
      id: row.id,
      machineId: row.machineId,
      cwd: row.cwd,
      sessionId: row.sessionId ?? undefined,
      projectId: row.projectId ?? undefined,
      kind: row.kind === 'scratch' ? 'scratch' : 'mainline',
      permissionMode: row.permissionMode ?? undefined,
      model: row.model ?? undefined,
    });
  };

  const publishInstances = (machineId: string): void => {
    const instances: InstanceRow[] = db.listInstances();
    const agents: AgentRow[] = db.listAgents();
    registry.broadcast({
      verb: 'frames',
      machineId,
      payload: {
        kind: 'instances',
        instances,
        agents,
        handoffs: Object.fromEntries(handoffs),
      },
    });
  };

  const awaitingInstall = (machineId: string, toolId: string): boolean => {
    for (const install of pendingInstalls.values())
      if (install.machineId === machineId && install.toolId === toolId) return true;
    return false;
  };

  /**
   * Sends the machine an install for every tool the policy requires and its
   * last report says is missing (NEW.md §10). The one click: a machine that
   * joins the fleet, or a tool that becomes required, needs nobody to go
   * looking for what is out of date.
   *
   * A machine that has reported nothing is left alone — an empty map is a
   * daemon that predates the catalog, not a machine missing everything. So is
   * one whose cell says `failed` or `unsupported`: the daemon remembers its own
   * failures for the rest of its boot, so an install that will not work waits
   * for a click instead of going out on every reconnect.
   */
  const autoInstall = (machineId: string, agent: HubSocket): void => {
    const cells = db.agentTools(machineId);
    if (Object.keys(cells).length === 0) return;

    let sent = false;
    for (const policy of db.listToolPolicies()) {
      const cell = cells[policy.id];
      if (!policy.required || (cell && cell.state !== 'missing')) continue;
      if (awaitingInstall(machineId, policy.id)) continue;

      const requestId = crypto.randomUUID();
      const payload: ControlPayload = {
        requestId,
        method: 'installTool',
        args: [policy.id, policy.pinnedVersion ?? undefined],
      };
      pendingInstalls.set(requestId, { machineId, toolId: policy.id });
      agent.send({ verb: 'control', machineId, payload } satisfies Envelope<ControlPayload>);
      db.setAgentToolCell(machineId, { id: policy.id, state: 'installing', at: Date.now() });
      sent = true;
    }
    if (sent) publishInstances(machineId);
  };

  /**
   * Sends the machine what the fleet's Claude Code is supposed to be able to
   * reach (NEW.md §11): every MCP server, marketplace and plugin, for the
   * machine to converge on and report back. Sent on register and after any
   * change, so a machine that joins tomorrow needs nobody to remember it.
   *
   * A fleet nobody has configured is not sent at all — there is nothing to
   * converge on, and a sync that writes nothing is still a file read and a
   * report stored on every register in the fleet. Unless the machine still has
   * something of ours: the last row being deleted is exactly when a machine most
   * needs telling, and its own last report is what says it has anything to lose.
   */
  const pushFleetConfig = (machineId: string, agent: HubSocket, config: FleetConfig): void => {
    const requestId = crypto.randomUUID();
    const payload: ControlPayload = { requestId, method: FLEET_SYNC, args: [config] };
    pendingFleet.set(requestId, machineId);
    agent.send({ verb: 'control', machineId, payload } satisfies Envelope<ControlPayload>);
  };

  const sendFleetSync = (machineId: string, agent: HubSocket): void => {
    const config = db.fleetConfig();
    const empty =
      !config.mcp.length &&
      !config.marketplaces.length &&
      !config.plugins.length &&
      !config.skills?.length &&
      !config.memory;
    if (empty && !holdsFleet(db.listAgents().find((row) => row.machineId === machineId)?.fleet)) {
      return;
    }

    pushFleetConfig(machineId, agent, config);
  };

  /**
   * One machine's own user CLAUDE.md, whoever wrote it. A peek is this alone,
   * adopting is this and a store, and an overwrite is this so the copy it is
   * about to destroy is kept before it goes.
   */
  const readMachineMemory = async (machineId: string): Promise<MemoryRead> => {
    const answer = await callAgent(machineId, READ_MEMORY_FILE, [], READ_TIMEOUT_MS);
    if (answer === 'offline') {
      return { ok: false, code: 404, said: `machine ${machineId} is not connected` };
    }
    if (answer === 'timeout') {
      return { ok: false, code: 504, said: `machine ${machineId} did not answer` };
    }
    if (!answer.ok) {
      return { ok: false, code: 500, said: answer.error ?? 'the machine could not read its memory' };
    }
    return { ok: true, copy: peekMemoryFile(answer.result) };
  };

  /** The version about to be replaced, kept — a save is not a way to lose one. */
  const keepReplacedMemory = (content: string): void => {
    const current = db.getFleetMemory();
    if (current && current.content !== content) {
      db.recordFleetMemory({ content: current.content, hash: current.hash, source: 'fleet' });
    }
  };

  /** The fleet changed: every machine that is online converges now, not on its next reconnect. */
  const fanOutFleet = (): void => {
    for (const machineId of registry.machineIds()) {
      const agent = registry.agent(machineId);
      if (!agent) continue;
      sendFleetSync(machineId, agent);
      publishInstances(machineId);
    }
  };

  return new Elysia()
    .use(websocket())
    // The hub's own build rides along (NEW.md §12), so a machine's can be read
    // against something rather than taken on faith.
    .get('/health', async () => ({ ok: true, version: HUB_VERSION, build: await buildInfo() }))
    .get('/api/agents', () => db.listAgents())
    // What a restart polls to find a moment that cuts nothing in half.
    .get('/api/agents/:machineId/busy', async ({ params, status }) => {
      const answer = await callAgent(params.machineId, AGENT_BUSY, [], BUSY_TIMEOUT_MS);
      if (answer === 'offline') return status(404, `machine ${params.machineId} is not connected`);
      if (answer === 'timeout') return status(504, `machine ${params.machineId} did not answer`);
      if (!answer.ok) return status(500, answer.error ?? 'the busy probe failed');
      return answer.result;
    })
    // And the update itself: the machine pulls, installs, rebuilds and restarts
    // what it serves, then says what it actually did.
    .post(
      '/api/agents/:machineId/update',
      {
        body: t.Object({
          restartAgent: t.Optional(t.Boolean()),
          force: t.Optional(t.Boolean()),
        }),
      },
      async ({ params, body, status }) => {
        const answer = await callAgent(
          params.machineId,
          UPDATE_COCKPIT,
          [body],
          UPDATE_TIMEOUT_MS
        );
        if (answer === 'offline') return status(404, `machine ${params.machineId} is not connected`);
        // A machine that restarts the hub as part of its update answers into a
        // socket that no longer exists, so this is not proof that nothing
        // happened — only that the hub stopped being able to hear about it.
        if (answer === 'timeout') {
          return status(504, `machine ${params.machineId} did not finish the update in time`);
        }
        if (!answer.ok) return status(500, answer.error ?? 'the update failed');
        return answer.result;
      }
    )
    .get('/api/instances', () => db.listInstances())
    .patch(
      '/api/instances/:id',
      {
        body: t.Object({
          kind: t.Optional(t.Union([t.Literal('mainline'), t.Literal('scratch')])),
          // Not narrowed to the modes the SDK names today: the hub stores what
          // the session reported it is answering with, whatever that grows into.
          permissionMode: t.Optional(t.String()),
          model: t.Optional(t.String()),
        }),
      },
      ({ params, body, status }) => {
        const { kind, permissionMode, model } = body;
        if (kind === undefined && permissionMode === undefined && model === undefined) {
          return status(400, 'name a field to change');
        }
        const row = db.patchInstance(params.id, { kind, permissionMode, model });
        if (row) publishInstances(row.machineId);
        return row;
      }
    )
    // Broadcast on change *and* readable on connect: a dashboard that opens
    // after a hand-off went out would otherwise show nothing until the next
    // time anything else moved.
    .get('/api/handoffs', () => Object.fromEntries(handoffs))
    .get('/api/pending', () => pending.list())
    // The catalog is code, so it ships with the answer rather than being stored:
    // a dashboard reads what tools exist and what the fleet has decided about
    // them here, and each machine's own status off the `instances` frame.
    .get('/api/tools', () => ({ catalog: TOOL_CATALOG, policies: db.listToolPolicies() }))
    .put(
      '/api/tools/:id',
      {
        body: t.Object({
          required: t.Optional(t.Boolean()),
          pinnedVersion: t.Optional(t.Union([t.String(), t.Null()])),
        }),
      },
      ({ params, body, status }) => {
        const spec = toolSpec(params.id);
        // A tool that only exists to satisfy a `requires` is not something the
        // fleet has an opinion about — it arrives with whatever needs it.
        if (!spec || spec.dependencyOnly) return status(404, `no tool ${params.id}`);

        const policy = db.putToolPolicy(params.id, body);
        // The click: every machine that is online and missing it starts now,
        // rather than whenever it next happens to reconnect.
        if (policy.required) {
          for (const machineId of registry.machineIds()) {
            const agent = registry.agent(machineId);
            if (agent) autoInstall(machineId, agent);
          }
        }
        return policy;
      }
    )
    // The fleet's desired state (NEW.md §11), every table at once: it is one
    // page in the dashboard and one `syncFleetConfig` on a machine.
    //
    // The skills come back as rows rather than as part of the config: what the
    // machines get carries every skill's files, and a page that only lists them
    // must not weigh what the fleet weighs.
    .get('/api/fleet', () => {
      const { mcp, marketplaces, plugins } = db.fleetConfig();
      return {
        config: { mcp, marketplaces, plugins },
        skills: db.listSkills(),
        memory: db.getFleetMemory() ?? null,
      };
    })
    .put(
      '/api/fleet/mcp/:name',
      {
        body: t.Object({
          // Stored and written verbatim, so the schema only asks that it be an
          // object; `mcpProblem` checks the one field that makes it startable.
          config: t.Record(t.String(), t.Unknown()),
          enabled: t.Optional(t.Boolean()),
        }),
      },
      ({ params, body, status }) => {
        const problem = mcpProblem(params.name, body.config);
        if (problem) return status(400, problem);

        const server = db.putMcpServer({
          name: params.name,
          config: body.config as FleetMcpConfig,
          enabled: body.enabled,
        });
        fanOutFleet();
        return server;
      }
    )
    .delete('/api/fleet/mcp/:name', ({ params }) => {
      db.deleteMcpServer(params.name);
      fanOutFleet();
      return { ok: true };
    })
    .put(
      '/api/fleet/marketplaces/:name',
      { body: t.Object({ source: t.String() }) },
      ({ params, body }) => {
        const marketplace = db.putMarketplace({ name: params.name, source: body.source });
        fanOutFleet();
        return marketplace;
      }
    )
    .delete('/api/fleet/marketplaces/:name', ({ params }) => {
      db.deleteMarketplace(params.name);
      fanOutFleet();
      return { ok: true };
    })
    .put(
      '/api/fleet/plugins/:id',
      { body: t.Object({ enabled: t.Optional(t.Boolean()) }) },
      ({ params, body }) => {
        const plugin = db.putPlugin({ id: params.id, enabled: body.enabled });
        fanOutFleet();
        return plugin;
      }
    )
    .delete('/api/fleet/plugins/:id', ({ params }) => {
      db.deletePlugin(params.id);
      fanOutFleet();
      return { ok: true };
    })
    // A plain skill is resolved here and now, once for the whole fleet: the hub
    // downloads it, and the machines are handed the files (NEW.md §11). A source
    // that would not resolve is still stored — the row is where the dashboard
    // reads why, and the ambiguous case answers with what it could have meant.
    .put(
      '/api/fleet/skills/:name',
      { body: t.Object({ source: t.String(), enabled: t.Optional(t.Boolean()) }) },
      async ({ params, body, status }) => {
        if (!SKILL_NAME.test(params.name)) return status(400, `${params.name} is not a usable skill name`);

        const resolved = await resolveSkill(body.source);
        const skill = db.putSkill({
          name: params.name,
          source: body.source,
          enabled: body.enabled,
          ...('error' in resolved
            ? { error: resolved.error }
            : { hash: resolved.hash, bytes: resolved.bytes, files: resolved.files }),
        });
        // Nothing on any machine changed unless there are files to change it with.
        if (!('error' in resolved)) fanOutFleet();
        return 'choices' in resolved && resolved.choices
          ? { ...skill, choices: resolved.choices }
          : skill;
      }
    )
    // The same source, fetched again — for a skill whose repo has moved on.
    .post('/api/fleet/skills/:name/refresh', async ({ params, status }) => {
      const stored = db.listSkills().find((skill) => skill.name === params.name);
      if (!stored) return status(404, `no skill ${params.name}`);

      const resolved = await resolveSkill(stored.source);
      const skill = db.putSkill({
        name: stored.name,
        source: stored.source,
        enabled: stored.enabled,
        ...('error' in resolved
          ? { error: resolved.error }
          : { hash: resolved.hash, bytes: resolved.bytes, files: resolved.files }),
      });
      if (skill.hash !== stored.hash) fanOutFleet();
      return skill;
    })
    .delete('/api/fleet/skills/:name', ({ params }) => {
      db.deleteSkill(params.name);
      fanOutFleet();
      return { ok: true };
    })
    // The fleet's user-scope CLAUDE.md (NEW.md §11): one document, hash-synced
    // to every machine like a skill's files are.
    //
    // `expectedHash` is what the writer had in front of them. A save against a
    // row somebody else has moved answers with what is really there rather than
    // taking the last writer's word for it — two dashboards on one document is
    // the ordinary case here, not the exotic one.
    .put(
      '/api/fleet/memory',
      { body: t.Object({ content: t.String(), expectedHash: t.Optional(t.String()) }) },
      ({ body, status }) => {
        const current = db.getFleetMemory();
        if (body.expectedHash !== undefined && current && current.hash !== body.expectedHash) {
          return status(409, current);
        }
        keepReplacedMemory(body.content);
        const memory = db.setFleetMemory(body.content);
        fanOutFleet();
        return memory;
      }
    )
    // The machines take back only what their own sidecar says cockpit wrote:
    // one edited by hand on a machine stays there, unmanaged.
    .delete('/api/fleet/memory', () => {
      db.clearFleetMemory();
      fanOutFleet();
      return { ok: true };
    })
    // What one machine really has, without touching anything: the read behind
    // "compare", so a reader chooses between two documents by looking at them.
    .post(
      '/api/fleet/memory/peek',
      { body: t.Object({ machineId: t.String() }) },
      async ({ body, status }) => {
        const read = await readMachineMemory(body.machineId);
        return read.ok ? read.copy : status(read.code, read.said);
      }
    )
    // The first document has to come from somewhere, and a machine that has been
    // collecting one for a year is where it is. Read off that machine and stored
    // as the fleet's, which every other machine then gets.
    .post(
      '/api/fleet/memory/adopt',
      { body: t.Object({ machineId: t.String() }) },
      async ({ body, status }) => {
        const read = await readMachineMemory(body.machineId);
        if (!read.ok) return status(read.code, read.said);
        if (!read.copy) return status(404, `machine ${body.machineId} has no user CLAUDE.md`);

        keepReplacedMemory(read.copy.content);
        const memory = db.setFleetMemory(read.copy.content);
        fanOutFleet();
        return memory;
      }
    )
    // And the other direction, for the machine whose copy was edited: a sync
    // that is allowed to overwrite it, sent at that machine alone.
    //
    // The machine is read first, and a machine that will not answer stops the
    // push: what an overwrite destroys exists nowhere else, so it is kept here
    // before it goes rather than mourned afterwards.
    .post(
      '/api/fleet/memory/push',
      { body: t.Object({ machineId: t.String() }) },
      async ({ body, status }) => {
        const agent = registry.agent(body.machineId);
        if (!agent) return status(404, `machine ${body.machineId} is not connected`);

        const config = db.fleetConfig();
        if (!config.memory) return status(400, 'the fleet keeps no memory to push');

        const read = await readMachineMemory(body.machineId);
        if (!read.ok) return status(read.code, read.said);
        if (read.copy && read.copy.hash !== config.memory.hash) {
          db.recordFleetMemory({
            content: read.copy.content,
            hash: read.copy.hash,
            source: `machine:${body.machineId}`,
          });
        }

        pushFleetConfig(body.machineId, agent, {
          ...config,
          memory: { ...config.memory, force: true },
        });
        publishInstances(body.machineId);
        return { ok: true };
      }
    )
    // What the memory used to say, newest first. Without the content: the list
    // is read on every open of the panel, and a version is read on a click.
    .get('/api/fleet/memory/history', () => db.listFleetMemoryHistory())
    .get('/api/fleet/memory/history/:id', ({ params, status }) => {
      const version = db.fleetMemoryVersion(Number(params.id));
      return version ?? status(404, `no memory version ${params.id}`);
    })
    // Undo, through the same door as a save — so what restoring replaces is
    // itself kept, and a restore of the wrong version is undone the same way.
    .post('/api/fleet/memory/restore', { body: t.Object({ id: t.Number() }) }, ({ body, status }) => {
      const version = db.fleetMemoryVersion(body.id);
      if (!version) return status(404, `no memory version ${body.id}`);

      keepReplacedMemory(version.content);
      const memory = db.setFleetMemory(version.content);
      fanOutFleet();
      return memory;
    })
    // The click for a machine that drifted, or for the whole fleet: the same
    // sync a register sends, asked for on purpose.
    .post(
      '/api/fleet/sync',
      { body: t.Object({ machineId: t.Optional(t.String()) }) },
      ({ body, status }) => {
        if (!body.machineId) {
          fanOutFleet();
          return { ok: true };
        }
        const agent = registry.agent(body.machineId);
        if (!agent) return status(404, `machine ${body.machineId} is not connected`);
        sendFleetSync(body.machineId, agent);
        publishInstances(body.machineId);
        return { ok: true };
      }
    )
    .get('/api/projects', () => db.listProjects())
    .post(
      '/api/projects',
      { body: t.Object({ name: t.String(), cwd: t.String(), machineId: t.String() }) },
      ({ body }) => db.createProject({ id: crypto.randomUUID(), ...body })
    )
    .delete('/api/projects/:id', ({ params }) => {
      db.deleteProject(params.id);
      return { ok: true };
    })
    .ws('/ws', {
      message(ws, message) {
        if (!isEnvelope(message)) {
          console.warn('[hub] dropped malformed frame', message);
          return;
        }

        switch (message.verb) {
          case 'register':
            registry.registerAgent(message.machineId, ws);
            db.upsertAgent({
              machineId: message.machineId,
              hostname: peek(message.payload, 'hostname') ?? message.machineId,
              os: peek(message.payload, 'os') ?? 'unknown',
              auth: peekAuth(message.payload),
              build: peekBuild(message.payload),
            });
            db.mergeAgentTools(message.machineId, peekTools(message.payload));
            // A question parked by a process that is gone cannot be answered:
            // the reply would arrive at a daemon with no such session. Drop them
            // with the sessions they belonged to, or they replay to every
            // dashboard that connects and fail on click.
            for (const settled of db.settleInstances(
              message.machineId,
              peekInstances(message.payload),
              peekResumable(message.payload)
            )) {
              pending.forget(settled.row.id);
              // The daemon went away and came back. A session whose conversation
              // the SDK still has is not finished — it lost its process, which is
              // this hub's problem to fix rather than the user's to notice. Put
              // it back exactly as it was: same directory, same model, same
              // permission mode, resumed onto the same SDK session.
              if (settled.resumes && settled.row.sessionId) restore(ws, settled.row);
            }
            publishInstances(message.machineId);
            autoInstall(message.machineId, ws);
            sendFleetSync(message.machineId, ws);
            ws.send(ack(message));
            break;
          case 'heartbeat':
            db.touchAgent(message.machineId);
            ws.send(ack(message));
            break;
          // A hand-off: one machine's session addressing another's. Routed on
          // `machineId` like a dashboard's `send`, because that is what it is —
          // the sender happens to be an agent rather than a reader, which the
          // payload says for itself in the message's `origin` and the hub does
          // not need to know. Cross-machine falls out for free: the envelope
          // names its target's machine, and the registry has the socket.
          case 'send': {
            const from = peekPeer(message.payload);
            if (!forward(message, ws) || !message.instanceId) break;
            if (from && !isQuerySend(message.payload)) {
              // A queued hand-off: the target now carries unread work.
              handoffs.set(message.instanceId, { from, at: Date.now() });
              publishInstances(message.machineId);
            } else if (isQuerySend(message.payload) && handoffs.has(message.instanceId)) {
              // A querying send folds everything queued into the turn it
              // starts — the hand-off has been read.
              handoffs.delete(message.instanceId);
              publishInstances(message.machineId);
            }
            break;
          }
          // A session starting another session. Recorded exactly like a
          // dashboard's spawn — the row is what puts it in the rail, with a
          // transcript of its own the reader can open.
          case 'spawn':
            if (forward(message, ws) && message.instanceId) {
              db.openInstance({
                id: message.instanceId,
                machineId: message.machineId,
                cwd: peek(message.payload, 'cwd') ?? '',
                sessionId: peekResume(message.payload),
                projectId: peek(message.payload, 'projectId'),
                kind: peekKind(message.payload),
                permissionMode: peek(message.payload, 'permissionMode'),
                model: peek(message.payload, 'model'),
              });
              publishInstances(message.machineId);
            }
            break;
          case 'frames': {
            const kind = peek(message.payload, 'kind');
            if (message.requestId && kind === 'permission_request')
              pending.remember(message.requestId, message);
            if (kind === 'sdk' && message.instanceId) {
              const init = peekInit(message.payload);
              if (init) {
                db.noteInstanceSession(message.instanceId, init.sessionId, init.cwd);
                publishInstances(message.machineId);
              }
            }
            // An agent only frames an error about a session that failed to start
            // or died on its own, so the row records it for whoever looks later.
            if (kind === 'error' && message.instanceId) {
              db.failInstance(
                message.instanceId,
                peek(message.payload, 'message') ?? 'the session failed'
              );
              pending.forget(message.instanceId);
              publishInstances(message.machineId);
            }
            // An install answering, whoever asked for it: the cell is the hub's
            // to keep, and the reply still goes wherever it was going.
            const install = message.requestId ? pendingInstalls.get(message.requestId) : undefined;
            if (install && kind === 'control_result' && message.requestId) {
              pendingInstalls.delete(message.requestId);
              const status = peekToolStatus(message.payload);
              if (status) {
                db.setAgentToolCell(message.machineId, status);
                publishInstances(message.machineId);
              }
            }
            // A sync answering, whoever asked for it: the machine's own account
            // of what it now has is the hub's to keep, and the reply still goes
            // wherever it was going.
            if (message.requestId && kind === 'control_result' && pendingFleet.has(message.requestId)) {
              pendingFleet.delete(message.requestId);
              const report = peekFleetReport(message.payload);
              if (report) {
                db.setAgentFleet(message.machineId, report);
                publishInstances(message.machineId);
              }
            }
            // A control a route is waiting on: the reply is that request's
            // answer and nobody else's news.
            if (kind === 'control_result' && message.requestId) {
              const answering = waiting.get(message.requestId);
              if (answering) {
                waiting.delete(message.requestId);
                answering(message.payload as ControlResult);
                break;
              }
            }
            // A control's reply belongs to the dashboard that asked; the rest is fan-out.
            const requester =
              message.requestId && kind === 'control_result'
                ? registry.takeRequester(message.requestId)
                : undefined;
            if (requester) requester.send(message);
            else registry.broadcast(message);
            break;
          }
          default:
            console.warn(`[hub] unhandled verb ${message.verb} from ${message.machineId}`);
        }
      },
      close(ws) {
        const machineId = registry.dropAgent(ws.id);
        if (!machineId) return;
        // The install may well still be running out there, but its reply can no
        // longer arrive on this socket — and the register that follows carries
        // the machine's own account of what landed.
        for (const [requestId, install] of pendingInstalls)
          if (install.machineId === machineId) pendingInstalls.delete(requestId);
        for (const [requestId, syncing] of pendingFleet)
          if (syncing === machineId) pendingFleet.delete(requestId);
        db.markAgentOffline(machineId);
        db.reconcileInstances(machineId, []);
        publishInstances(machineId);
      },
    })
    .ws('/ws/dashboard', {
      open(ws) {
        registry.addDashboard(ws);
      },
      message(ws, message) {
        if (!isEnvelope(message)) {
          console.warn('[hub] dropped malformed dashboard frame', message);
          return;
        }

        switch (message.verb) {
          case 'spawn':
            if (forward(message, ws) && message.instanceId) {
              // A relaunch replaces the process — questions the old one had
              // open are settled by its teardown and must not replay.
              pending.forget(message.instanceId);
              db.openInstance({
                id: message.instanceId,
                machineId: message.machineId,
                cwd: peek(message.payload, 'cwd') ?? '',
                sessionId: peekResume(message.payload),
                projectId: peek(message.payload, 'projectId'),
                kind: peekKind(message.payload),
                permissionMode: peek(message.payload, 'permissionMode'),
                model: peek(message.payload, 'model'),
              });
              publishInstances(message.machineId);
            }
            break;
          case 'send': {
            const from = peekPeer(message.payload);
            if (!forward(message, ws) || !message.instanceId) break;
            if (from && !isQuerySend(message.payload)) {
              // A queued hand-off: the target now carries unread work.
              handoffs.set(message.instanceId, { from, at: Date.now() });
              publishInstances(message.machineId);
            } else if (isQuerySend(message.payload) && handoffs.has(message.instanceId)) {
              // A querying send folds everything queued into the turn it
              // starts — the hand-off has been read.
              handoffs.delete(message.instanceId);
              publishInstances(message.machineId);
            }
            break;
          }
          case 'stop':
            if (forward(message, ws) && message.instanceId) {
              if (peekDiscard(message.payload)) db.discardInstance(message.instanceId);
              else db.stopInstance(message.instanceId);
              publishInstances(message.machineId);
            }
            break;
          case 'control': {
            if (!forward(message, ws) || !message.requestId) break;
            registry.rememberRequester(message.requestId, ws);
            pending.resolve(message.requestId);
            // A per-cell install or retry, clicked rather than swept: the chip
            // turns on every dashboard, not only the one that clicked it.
            const toolId = peekInstall(message.payload);
            if (toolId) {
              pendingInstalls.set(message.requestId, { machineId: message.machineId, toolId });
              db.setAgentToolCell(message.machineId, {
                id: toolId,
                state: 'installing',
                at: Date.now(),
              });
              publishInstances(message.machineId);
            }
            // A sync or a status a dashboard asked for answers with the same
            // report a register's does, and the row is the hub's either way.
            const method = peek(message.payload, 'method');
            if (method === FLEET_SYNC || method === FLEET_STATUS) {
              pendingFleet.set(message.requestId, message.machineId);
            }
            break;
          }
          case 'fs':
            // Answered on `control_result` too, so the same requester map routes it.
            if (forward(message, ws) && message.requestId)
              registry.rememberRequester(message.requestId, ws);
            break;
          default:
            console.warn(`[hub] unhandled dashboard verb ${message.verb}`);
        }
      },
      close(ws) {
        registry.dropDashboard(ws);
      },
    });
};
