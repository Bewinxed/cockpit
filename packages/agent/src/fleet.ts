/**
 * The fleet's MCP servers and skill plugins on this machine (NEW.md §11). The
 * hub owns the desired state; nothing in here decides what belongs on a
 * machine, only what the machine came to when it was asked to converge.
 *
 * Everything cockpit writes is named in a sidecar, and only what the sidecar
 * names is ever taken away again: `~/.claude.json` is the user's own file, and
 * an MCP server they added by hand — or a plugin they installed themselves —
 * outlives every sync this daemon runs.
 */
import type {
  ConfigInspection,
  DiscoveredMcp,
  DiscoveredSkill,
  FleetConfig,
  FleetItemState,
  FleetMcpConfig,
  FleetMcpServer,
  FleetMemory,
  FleetScope,
  FleetSkillPayload,
  FleetSyncReport,
  MarketplacePluginInfo,
  SkillFile,
} from '@cockpit/core';
import { readdir, rename, rm, stat } from 'node:fs/promises';
import { platform } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { expandHome } from './fs';
import { resolveBin, toolEnv } from './tools';

/**
 * User-scope MCP servers live at the top level of this file — not in
 * `~/.claude/settings.json`, and not in anything under `~/.claude/`. Every
 * project loads them, and the SDK reads them whatever its `settingSources` say.
 */
const CLAUDE_JSON = expandHome('~/.claude.json');

/** What cockpit manages here. Anything this does not name is never touched. */
const SIDECAR = expandHome('~/.claude/cockpit-fleet.json');

/** Where a plain skill's files land — one directory per skill, all of it cockpit's. */
const SKILLS_DIR = expandHome('~/.claude/skills');

/** The user-scope memory every session on this machine reads (NEW.md §11). */
const MEMORY_PATH = expandHome('~/.claude/CLAUDE.md');

const PLUGINS_DIR = expandHome('~/.claude/plugins');
/** The CLI's own account of what is linked and what is installed. */
const KNOWN_MARKETPLACES = join(PLUGINS_DIR, 'known_marketplaces.json');
const INSTALLED_PLUGINS = join(PLUGINS_DIR, 'installed_plugins.json');
/** Where a linked marketplace's clone lands. */
const MARKETPLACES_DIR = join(PLUGINS_DIR, 'marketplaces');

/** Where the local installer puts the CLI when it is not on any PATH. */
const LOCAL_CLAUDE = expandHome('~/.claude/local/claude');

/** How long one `claude plugin …` gets: a first clone of a marketplace is slow. */
const CLI_TIMEOUT_MS = 120_000;

/** The end of a command's output: enough to name what happened, not a wall of it. */
const TAIL_LINES = 4;

const tail = (output: string): string => output.trim().split('\n').slice(-TAIL_LINES).join('\n');

const said = (error: unknown): string => (error instanceof Error ? error.message : String(error));

interface Sidecar {
  mcp: string[];
  marketplaces: string[];
  plugins: string[];
  /** Skill name → the hash of the files written, which is what makes a sync a no-op. */
  skills: Record<string, string>;
  /** The hash cockpit last wrote to `~/.claude/CLAUDE.md`; absent = unmanaged. */
  memory?: string;
}

const readJson = async <T>(path: string): Promise<T | undefined> => {
  const file = Bun.file(path);
  if (!(await file.exists())) return undefined;
  try {
    return (await file.json()) as T;
  } catch {
    return undefined;
  }
};

/**
 * Written whole and moved into place. `~/.claude.json` is read by every Claude
 * Code on this machine, and a half-written one is a machine with no MCP servers
 * and no history.
 */
const writeJson = async (path: string, value: unknown): Promise<void> => {
  const temp = `${path}.cockpit-${process.pid}`;
  await Bun.write(temp, JSON.stringify(value, null, 2));
  await rename(temp, path);
};

/** What cockpit put here last time; unreadable is the same as never written. */
const readSidecar = async (): Promise<Sidecar> => {
  const stored = await readJson<Partial<Sidecar>>(SIDECAR);
  return {
    mcp: stored?.mcp ?? [],
    marketplaces: stored?.marketplaces ?? [],
    plugins: stored?.plugins ?? [],
    // A sidecar written before skills existed names none, which is the truth.
    skills: stored?.skills ?? {},
    ...(stored?.memory ? { memory: stored.memory } : {}),
  };
};

type ClaudeJson = Record<string, unknown>;

/** The file, or why it could not be read. Missing is a machine with nothing in it. */
const readClaudeJson = async (): Promise<
  { ok: true; root: ClaudeJson } | { ok: false; detail: string }
> => {
  const file = Bun.file(CLAUDE_JSON);
  if (!(await file.exists())) return { ok: true, root: {} };
  try {
    return { ok: true, root: (await file.json()) as ClaudeJson };
  } catch (error) {
    return { ok: false, detail: `could not parse ~/.claude.json: ${tail(said(error))}` };
  }
};

const mcpServersOf = (root: ClaudeJson): Record<string, unknown> => ({
  ...((root.mcpServers as Record<string, unknown> | undefined) ?? {}),
});

/**
 * The entry as it goes into the file, and anything worth saying about it.
 *
 * A stdio server is written with its runner's absolute path: the CLI spawns it
 * without a shell, and the PATH of the terminal the user opens tomorrow is not
 * this daemon's — writing what this machine actually resolved is what makes the
 * two agree. A runner that is not here yet is written verbatim rather than
 * dropped, because the entry is still what the user asked for and it starts
 * working the moment the runner arrives.
 */
const forThisMachine = (config: FleetMcpConfig): { config: FleetMcpConfig; detail?: string } => {
  if ('url' in config) return { config };
  if (/[\\/]/.test(config.command)) return { config };

  const resolved = resolveBin(config.command);
  if (!resolved) return { config, detail: `runner '${config.command}' not found on PATH yet` };
  // A `.cmd` shim is a script, and a spawn with no shell cannot run one.
  if (platform() === 'win32' && /\.(cmd|bat)$/i.test(resolved)) {
    return {
      config: { ...config, command: 'cmd', args: ['/c', resolved, ...(config.args ?? [])] },
    };
  }
  return { config: { ...config, command: resolved } };
};

/**
 * Merges the fleet's servers into `~/.claude.json` and answers with the names
 * cockpit now manages. Every other key in the file, and every server the
 * sidecar does not name, comes back out exactly as it went in.
 */
const syncMcp = async (
  desired: FleetMcpServer[],
  managed: string[],
  report: FleetSyncReport['mcp']
): Promise<string[]> => {
  const wanted = desired.filter((server) => server.enabled);
  const failed = (detail: string): string[] => {
    for (const server of wanted) report[server.name] = { state: 'failed', detail };
    return managed;
  };

  const file = await readClaudeJson();
  // Nothing is written over a file that cannot be read: the rest of it is the
  // user's own, and a rewrite from an empty root would take it with them.
  if (!file.ok) return failed(file.detail);

  const servers = mcpServersOf(file.root);
  const details = new Map<string, string>();
  for (const server of wanted) {
    const { config, detail } = forThisMachine(server.config);
    servers[server.name] = config;
    if (detail) details.set(server.name, detail);
  }

  const names = wanted.map((server) => server.name);
  const gone = managed.filter((name) => !names.includes(name));
  for (const name of gone) delete servers[name];

  try {
    await writeJson(CLAUDE_JSON, { ...file.root, mcpServers: servers });
  } catch (error) {
    return failed(`could not write ~/.claude.json: ${tail(said(error))}`);
  }

  for (const name of names) {
    const detail = details.get(name);
    report[name] = { state: 'applied', ...(detail ? { detail } : {}) };
  }
  for (const name of gone) report[name] = { state: 'removed' };
  return names;
};

/** The CLI the skill half drives — on PATH, or where the local installer puts it. */
const claudeBin = async (): Promise<string | undefined> => {
  const onPath = resolveBin('claude');
  if (onPath) return onPath;
  return (await Bun.file(LOCAL_CLAUDE).exists()) ? LOCAL_CLAUDE : undefined;
};

interface Ran {
  /** The tail of what it said, which is what a failure's `detail` carries. */
  output: string;
}

/**
 * One `claude plugin …`, with the daemon's environment and the PATH it can
 * install into. Killed rather than left running if it hangs: a marketplace
 * behind a dead network would otherwise hold the whole sync open forever.
 */
const runClaude = async (bin: string, args: string[]): Promise<Ran> => {
  const child = Bun.spawn([bin, ...args], {
    env: toolEnv(),
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: CLI_TIMEOUT_MS,
  });
  const [stdout, stderr] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  const code = await child.exited;
  if (child.signalCode) return { output: `timed out after ${CLI_TIMEOUT_MS / 1000}s` };
  return { output: tail(stderr) || tail(stdout) || `exited ${code}` };
};

const isLinked = async (name: string): Promise<boolean> =>
  (await readJson<Record<string, unknown>>(KNOWN_MARKETPLACES))?.[name] !== undefined;

interface InstalledPlugins {
  /** Plugin id → one entry per scope it is installed at, with its unpacked copy. */
  plugins?: Record<string, { scope?: string; installPath?: string }[]>;
}

/** Whether the CLI lists the plugin at the scope this daemon installs at. */
const isInstalled = async (id: string): Promise<boolean> => {
  const stored = await readJson<InstalledPlugins>(INSTALLED_PLUGINS);
  return (stored?.plugins?.[id] ?? []).some((entry) => entry.scope === 'user');
};

/** `plugin@marketplace` is the CLI's own form, and the half after the `@` is the link. */
const marketplaceOf = (id: string): string => id.split('@').pop() ?? '';

/**
 * Links the marketplaces and installs the plugins, in that order — a plugin
 * whose marketplace is not linked has nowhere to come from. Both commands are
 * idempotent, but neither is free, so what the CLI already lists is left alone.
 */
const syncPlugins = async (
  config: FleetConfig,
  managed: Sidecar,
  report: FleetSyncReport
): Promise<Pick<Sidecar, 'marketplaces' | 'plugins'>> => {
  const wantedPlugins = config.plugins.filter((plugin) => plugin.enabled);
  const bin = await claudeBin();
  if (!bin) {
    for (const { name } of config.marketplaces) {
      report.marketplaces[name] = { state: 'failed', detail: 'claude CLI not found' };
    }
    for (const { id } of wantedPlugins) {
      report.plugins[id] = { state: 'failed', detail: 'claude CLI not found' };
    }
    return { marketplaces: managed.marketplaces, plugins: managed.plugins };
  }

  for (const { name, source } of config.marketplaces) {
    if (await isLinked(name)) {
      report.marketplaces[name] = { state: 'applied' };
      continue;
    }
    const ran = await runClaude(bin, ['plugin', 'marketplace', 'add', source]);
    report.marketplaces[name] = (await isLinked(name))
      ? { state: 'applied' }
      : { state: 'failed', detail: ran.output };
  }

  const marketplaces = config.marketplaces.map(({ name }) => name);
  for (const name of managed.marketplaces) {
    if (marketplaces.includes(name)) continue;
    await runClaude(bin, ['plugin', 'marketplace', 'remove', name]);
    report.marketplaces[name] = { state: 'removed' };
  }

  for (const { id } of wantedPlugins) {
    const marketplace = marketplaceOf(id);
    if (report.marketplaces[marketplace]?.state === 'failed') {
      report.plugins[id] = { state: 'failed', detail: `marketplace ${marketplace} is not linked` };
      continue;
    }
    if (await isInstalled(id)) {
      report.plugins[id] = { state: 'applied' };
      continue;
    }
    const ran = await runClaude(bin, ['plugin', 'install', id, '--scope', 'user']);
    report.plugins[id] = (await isInstalled(id))
      ? { state: 'applied' }
      : { state: 'failed', detail: ran.output };
  }

  const plugins = wantedPlugins.map(({ id }) => id);
  for (const id of managed.plugins) {
    if (plugins.includes(id)) continue;
    await runClaude(bin, ['plugin', 'uninstall', id, '--scope', 'user', '-y']);
    report.plugins[id] = { state: 'removed' };
  }

  return { marketplaces, plugins };
};

/**
 * A path a skill's file may take under its own directory. The files come out of
 * a repo the hub downloaded, which is not something to trust with a write
 * anywhere else on this machine.
 */
const isSafeSkillPath = (path: string): boolean =>
  path !== '' && !isAbsolute(path) && !path.split('/').includes('..');

const dirExists = async (path: string): Promise<boolean> => {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
};

/**
 * The skill's directory, as the hub resolved it. Written whole, because the
 * directory is cockpit's own: a file the last version carried is not one this
 * version carries, and leaving it there is how a skill drifts.
 */
const writeSkill = async (skill: FleetSkillPayload): Promise<void> => {
  const dir = join(SKILLS_DIR, skill.name);
  await rm(dir, { recursive: true, force: true });
  for (const file of skill.files) {
    await Bun.write(join(dir, file.path), Buffer.from(file.contentBase64, 'base64'));
  }
};

/**
 * Writes the skills whose files this machine does not have yet, and takes away
 * the ones the fleet no longer carries. No CLI is run and no settings are
 * touched: a plain skill is files, and the hash is the whole economy — an
 * unchanged skill costs one comparison however many megabytes it arrived with.
 */
const syncSkillFiles = async (
  desired: FleetSkillPayload[],
  managed: Sidecar['skills'],
  report: Record<string, FleetItemState>
): Promise<Sidecar['skills']> => {
  const written: Sidecar['skills'] = {};
  for (const skill of desired) {
    if (managed[skill.name] === skill.hash) {
      written[skill.name] = skill.hash;
      report[skill.name] = { state: 'applied' };
      continue;
    }

    const unsafe = skill.files.find(({ path }) => !isSafeSkillPath(path));
    if (unsafe) {
      // Nothing is written, so the machine keeps whatever it already had.
      if (managed[skill.name] !== undefined) written[skill.name] = managed[skill.name];
      report[skill.name] = { state: 'failed', detail: `unsafe path ${unsafe.path}` };
      continue;
    }

    try {
      await writeSkill(skill);
      written[skill.name] = skill.hash;
      report[skill.name] = { state: 'applied' };
    } catch (error) {
      // A write that got part of the way through still left cockpit's files
      // behind, so the name stays managed — under a hash nothing matches, which
      // is what has the next sync write it again.
      written[skill.name] = '';
      report[skill.name] = { state: 'failed', detail: tail(said(error)) };
    }
  }

  const wanted = new Set(desired.map(({ name }) => name));
  for (const name of Object.keys(managed)) {
    if (wanted.has(name)) continue;
    await rm(join(SKILLS_DIR, name), { recursive: true, force: true });
    report[name] = { state: 'removed' };
  }
  return written;
};

/** The same hash the hub took of the same document: sha256 of its UTF-8 bytes. */
const hashText = (content: string): string =>
  new Bun.CryptoHasher('sha256').update(content).digest('hex');

/** What is really at `~/.claude/CLAUDE.md`; null is a machine that has none. */
const memoryFileHash = async (): Promise<string | null> => {
  const file = Bun.file(MEMORY_PATH);
  return (await file.exists()) ? hashText(await file.text()) : null;
};

export type MemoryPlan = 'write' | 'skip' | 'drift' | 'remove' | 'unmanage' | 'none';

/**
 * What to do about the user CLAUDE.md, from hashes alone. Drift is a machine
 * edit cockpit did not make: managed hash exists, the file no longer matches
 * it — never overwritten without `force`, reported instead.
 */
export function memoryPlan(
  desired: { hash: string; force?: boolean } | null | undefined,
  fileHash: string | null,
  managedHash: string | undefined
): MemoryPlan {
  if (!desired) {
    if (managedHash === undefined) return 'none';
    return fileHash === managedHash ? 'remove' : 'unmanage';
  }
  // A file cockpit has never written is somebody's own: it is taken over only
  // when it already says the same thing, or when the reader said to.
  if (managedHash === undefined) {
    return fileHash === null || fileHash === desired.hash || desired.force ? 'write' : 'drift';
  }
  if (fileHash !== managedHash) return desired.force ? 'write' : 'drift';
  return desired.hash === managedHash ? 'skip' : 'write';
}

/** What a drifted machine reports, and what the dashboard offers to settle. */
const DRIFTED = 'edited on this machine — adopt it or overwrite';

/**
 * Applies the plan and answers with the hash cockpit now manages, or nothing
 * when it manages none. The file is only ever deleted when it is still exactly
 * what cockpit wrote — an edited one outlives the fleet's row, unmanaged.
 */
const syncMemory = async (
  desired: FleetMemory | null | undefined,
  managed: string | undefined,
  report: FleetSyncReport
): Promise<string | undefined> => {
  const plan = memoryPlan(desired, await memoryFileHash(), managed);

  if (!desired) {
    if (plan === 'remove') {
      await rm(MEMORY_PATH, { force: true });
      report.memory = { state: 'removed' };
    } else if (plan === 'unmanage') {
      report.memory = { state: 'removed', detail: 'kept: edited on this machine' };
    }
    return undefined;
  }

  if (plan === 'drift') {
    report.memory = { state: 'failed', detail: DRIFTED };
    return managed;
  }
  if (plan === 'skip') {
    report.memory = { state: 'applied' };
    return managed;
  }

  try {
    await Bun.write(MEMORY_PATH, desired.content);
    report.memory = { state: 'applied' };
    return desired.hash;
  } catch (error) {
    // The machine keeps the hash it had, so the next sync writes again rather
    // than believing this one landed.
    report.memory = { state: 'failed', detail: tail(said(error)) };
    return managed;
  }
};

const converge = async (config: FleetConfig): Promise<FleetSyncReport> => {
  const managed = await readSidecar();
  const skillStates: Record<string, FleetItemState> = {};
  const report: FleetSyncReport = {
    mcp: {},
    marketplaces: {},
    plugins: {},
    skills: skillStates,
    at: Date.now(),
  };

  const mcp = await syncMcp(config.mcp, managed.mcp, report.mcp);
  const installed = await syncPlugins(config, managed, report);
  const skills = await syncSkillFiles(config.skills ?? [], managed.skills, skillStates);
  const memory = await syncMemory(config.memory, managed.memory, report);
  await writeJson(SIDECAR, {
    mcp,
    ...installed,
    skills,
    ...(memory ? { memory } : {}),
  } satisfies Sidecar);

  return { ...report, at: Date.now() };
};

/**
 * One sync at a time on a machine: two of them would race over `~/.claude.json`
 * and run the same `claude plugin install` twice. A second call waits for the
 * one in flight rather than being refused — the hub sends one on register and
 * one on every change, and those arrive together often enough.
 */
let queue: Promise<unknown> = Promise.resolve();

/**
 * Applies the fleet's desired state to this machine and answers with what every
 * entry in it came to. Idempotent: a second sync with the same config writes the
 * same file and runs no CLI at all.
 */
export const syncFleetConfig = (config: FleetConfig): Promise<FleetSyncReport> => {
  const next = queue.then(
    () => converge(config),
    () => converge(config)
  );
  queue = next.catch(() => {});
  return next;
};

/**
 * What the machine has of what cockpit last put on it, without changing any of
 * it. The sidecar is the question — a server or a plugin nobody here manages is
 * not this report's business.
 */
export const fleetStatus = async (): Promise<FleetSyncReport> => {
  const managed = await readSidecar();
  const skills: Record<string, FleetItemState> = {};
  const report: FleetSyncReport = {
    mcp: {},
    marketplaces: {},
    plugins: {},
    skills,
    at: Date.now(),
  };

  const file = await readClaudeJson();
  const servers = file.ok ? mcpServersOf(file.root) : {};
  for (const name of managed.mcp) {
    report.mcp[name] = servers[name]
      ? { state: 'applied' }
      : { state: 'failed', detail: file.ok ? 'not in ~/.claude.json' : file.detail };
  }
  for (const name of managed.marketplaces) {
    report.marketplaces[name] = (await isLinked(name))
      ? { state: 'applied' }
      : { state: 'failed', detail: 'not in known_marketplaces.json' };
  }
  for (const id of managed.plugins) {
    report.plugins[id] = (await isInstalled(id))
      ? { state: 'applied' }
      : { state: 'failed', detail: 'not in installed_plugins.json' };
  }
  for (const name of Object.keys(managed.skills)) {
    skills[name] = (await dirExists(join(SKILLS_DIR, name)))
      ? { state: 'applied' }
      : { state: 'failed', detail: 'not on disk' };
  }
  if (managed.memory !== undefined) {
    const fileHash = await memoryFileHash();
    report.memory =
      fileHash === managed.memory
        ? { state: 'applied' }
        : { state: 'failed', detail: fileHash === null ? 'not on disk' : DRIFTED };
  }
  return report;
};

/**
 * This machine's own user CLAUDE.md, whoever wrote it. What adoption reads: a
 * memory a machine has been collecting for a year is where the fleet's first
 * document comes from.
 */
export const readMemoryFile = async (): Promise<{ content: string; hash: string } | null> => {
  const file = Bun.file(MEMORY_PATH);
  if (!(await file.exists())) return null;
  const content = await file.text();
  return { content, hash: hashText(content) };
};

/**
 * Discovery (NEW.md §11). Everything above answers "what did cockpit do here";
 * everything below answers the question that was missing — what this machine
 * really has, whoever put it there. Read-only, all of it: an unmanaged server or
 * a skill somebody wrote by hand is exactly what a reader wants to see, and
 * exactly what nothing here may touch.
 */

/** MCP server names by scope, nearest first: what a session in `cwd` resolves. */
interface McpScope {
  scope: FleetScope;
  servers: Record<string, unknown>;
}

/**
 * The three scopes into one list. Claude Code's own precedence is
 * local > project > user, so a name defined twice is reported twice — the
 * nearer one plainly, the further one saying which scope took it.
 */
export function mergeMcp(scopes: McpScope[], managed: readonly string[]): DiscoveredMcp[] {
  const found: DiscoveredMcp[] = [];
  for (const [index, { scope, servers }] of scopes.entries()) {
    for (const [name, config] of Object.entries(servers)) {
      const nearer = scopes.slice(0, index).find((other) => other.servers[name] !== undefined);
      found.push({
        name,
        scope,
        config: config as FleetMcpConfig,
        // Cockpit only ever writes the user scope, so only that one can be ours.
        managed: scope === 'user' && managed.includes(name),
        ...(nearer ? { shadowedBy: nearer.scope } : {}),
      });
    }
  }
  return found;
}

/**
 * A skill's own description, out of the SKILL.md front matter Claude Code
 * reads. Long ones are written as YAML block scalars (`description: >-` and the
 * text indented under it), which a read of the key's own line answers with the
 * marker instead of a sentence.
 */
export function skillDescription(source: string): string | undefined {
  if (!source.startsWith('---')) return undefined;
  const end = source.indexOf('\n---', 3);
  const front = (end === -1 ? source : source.slice(0, end)).split('\n');
  const at = front.findIndex((row) => row.startsWith('description:'));
  if (at === -1) return undefined;

  const value = front[at].slice('description:'.length).trim();
  if (!/^[|>][-+]?$/.test(value)) return value.replace(/^["']|["']$/g, '') || undefined;

  const block: string[] = [];
  for (const row of front.slice(at + 1)) {
    if (row.trim() !== '' && !/^\s/.test(row)) break;
    block.push(row.trim());
  }
  return block.join(' ').trim() || undefined;
}

/** Where an installed plugin's skills live, by the name a session calls them. */
export function pluginSkillRoots(installed: InstalledPlugins): { plugin: string; root: string }[] {
  const roots: { plugin: string; root: string }[] = [];
  for (const [id, entries] of Object.entries(installed.plugins ?? {})) {
    for (const entry of entries) {
      // The CLI keeps the unpacked copy's path per install; a plugin's skills
      // are a `skills/` directory inside it, which is what `/` lists as
      // `<plugin>:<skill>`.
      if (!entry.installPath) continue;
      roots.push({ plugin: id.split('@')[0], root: join(entry.installPath, 'skills') });
    }
  }
  return roots;
}

/**
 * Every directory under `root` that is a skill, named as a session names it —
 * the directory holding the SKILL.md, whatever it is filed under.
 *
 * Two layouts this met on real machines, both of which the naive read missed:
 * `~/.claude/skills/<name>` is usually a *symlink* into `~/.agents/skills`,
 * which a dirent calls a link rather than a directory; and a plugin may file
 * its skills under categories (`skills/engineering/<name>/SKILL.md`), which is
 * a layout detail — `/` still lists the skill by its own directory's name.
 */
export async function skillsIn(
  root: string,
  scope: DiscoveredSkill['scope'],
  prefix = '',
  depth = 2
): Promise<DiscoveredSkill[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const found: DiscoveredSkill[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const path = join(root, entry.name);
    const file = Bun.file(join(path, 'SKILL.md'));
    if (await file.exists()) {
      const description = skillDescription(await file.text());
      found.push({
        name: `${prefix}${entry.name}`,
        scope,
        path,
        managed: false,
        ...(description ? { description } : {}),
      });
      continue;
    }
    if (depth > 1) found.push(...(await skillsIn(path, scope, prefix, depth - 1)));
  }
  return found;
}

/** Every skill on this machine, in the order Claude Code would resolve them. */
const discoverSkills = async (cwd: string | undefined, managed: Sidecar): Promise<DiscoveredSkill[]> => {
  const installed = (await readJson<InstalledPlugins>(INSTALLED_PLUGINS)) ?? {};
  const plugins = await Promise.all(
    pluginSkillRoots(installed).map(({ plugin, root }) => skillsIn(root, 'plugin', `${plugin}:`))
  );
  const project = cwd ? await skillsIn(join(cwd, '.claude', 'skills'), 'project') : [];
  const user = await skillsIn(SKILLS_DIR, 'user');
  return [
    ...project,
    ...user.map((skill) => ({ ...skill, managed: managed.skills[skill.name] !== undefined })),
    ...plugins.flat(),
  ];
};

/**
 * What this machine really has, and what a session started in `cwd` would see.
 * Nothing is written and nothing is compared against the fleet: the hub reads
 * its own rows, and this is the other half — the machine's own word.
 */
export const inspectConfig = async (cwd?: string): Promise<ConfigInspection> => {
  const managed = await readSidecar();
  const file = await readClaudeJson();
  const root = file.ok ? file.root : {};

  const projects = (root.projects as Record<string, { mcpServers?: Record<string, unknown> }>) ?? {};
  const local = cwd ? (projects[cwd]?.mcpServers ?? {}) : {};
  const project = cwd
    ? ((await readJson<{ mcpServers?: Record<string, unknown> }>(join(cwd, '.mcp.json')))
        ?.mcpServers ?? {})
    : {};

  const installed = (await readJson<InstalledPlugins>(INSTALLED_PLUGINS)) ?? {};
  const linked = (await readJson<Record<string, unknown>>(KNOWN_MARKETPLACES)) ?? {};

  const memoryHash = await memoryFileHash();
  const memoryFile = Bun.file(MEMORY_PATH);

  return {
    ...(cwd ? { cwd } : {}),
    mcp: mergeMcp(
      [
        { scope: 'local', servers: local },
        { scope: 'project', servers: project },
        { scope: 'user', servers: mcpServersOf(root) },
      ],
      managed.mcp
    ),
    skills: await discoverSkills(cwd, managed),
    plugins: Object.entries(installed.plugins ?? {})
      .filter(([, entries]) => entries.some((entry) => entry.scope === 'user'))
      .map(([id]) => id),
    marketplaces: Object.keys(linked),
    memory: memoryHash
      ? { hash: memoryHash, bytes: memoryFile.size, managed: managed.memory === memoryHash }
      : null,
    at: Date.now(),
  };
};

/** Past this a skill is not a skill any more, and adoption says so rather than trying. */
const SKILL_BYTES_CAP = 2 * 1024 * 1024;

/** Every file under a directory, relative to it. Symlinks are not followed. */
const filesUnder = async (root: string, prefix = ''): Promise<string[]> => {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const paths: string[] = [];
  for (const entry of entries) {
    const relative = `${prefix}${entry.name}`;
    if (entry.isDirectory()) paths.push(...(await filesUnder(join(root, entry.name), `${relative}/`)));
    else if (entry.isFile()) paths.push(relative);
  }
  return paths;
};

/**
 * The files of a skill that is already on this machine, so the hub can adopt it
 * into the fleet and hand it to every other machine. Named as
 * {@link inspectConfig} named it, plugin skills included.
 */
export const readSkillFiles = async (name: string, cwd?: string): Promise<SkillFile[]> => {
  const skill = (await discoverSkills(cwd, await readSidecar())).find((one) => one.name === name);
  if (!skill) throw new Error(`no skill ${name} on this machine`);

  const files: SkillFile[] = [];
  let bytes = 0;
  for (const path of await filesUnder(skill.path)) {
    const content = new Uint8Array(await Bun.file(join(skill.path, path)).arrayBuffer());
    bytes += content.byteLength;
    if (bytes > SKILL_BYTES_CAP) {
      throw new Error(
        `${name} is over ${SKILL_BYTES_CAP / 1024 / 1024} MB — too big to carry to every machine`
      );
    }
    files.push({ path, contentBase64: Buffer.from(content).toString('base64') });
  }
  return files;
};

/** What a linked marketplace's own manifest lists. */
interface MarketplaceManifest {
  plugins?: MarketplacePluginInfo[];
}

/**
 * What a marketplace linked on this machine offers, read from its clone — the
 * dashboard browses installable plugins with it, so a name must come back with
 * whatever the marketplace says about itself.
 */
export const marketplaceCatalog = async (name: string): Promise<MarketplacePluginInfo[]> => {
  const manifest = await readJson<MarketplaceManifest>(
    join(MARKETPLACES_DIR, name, '.claude-plugin', 'marketplace.json')
  );
  if (!manifest) throw new Error(`no marketplace ${name} is linked on this machine`);
  return (manifest.plugins ?? []).map(({ name: plugin, description, version, category }) => ({
    name: plugin,
    description,
    version,
    category,
  }));
};
