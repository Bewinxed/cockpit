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
  FleetHook,
  FleetItemState,
  FleetMcpConfig,
  FleetMcpServer,
  FleetMemory,
  FleetMemoryDoc,
  FleetScope,
  FleetSkillPayload,
  FleetSyncReport,
  HookEvent,
  HookHandler,
  MachineMemoryDoc,
  MachineMemorySet,
  MarketplacePluginInfo,
  SkillFile,
} from '@cockpit/core';
import { hookProblem, memoryDocProblem } from '@cockpit/core';
import { chmod, readdir, rename, rm, rmdir, stat } from 'node:fs/promises';
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

/**
 * The documents the main memory links, one file per path the set names. All of
 * it cockpit's, like a skill's directory — nothing under here was ever written
 * by anything else, so a file the set stops carrying is a file that goes.
 */
const MEMORIES_DIR = expandHome('~/.claude/memories');

/**
 * The hook that puts a model's own document in front of the session running
 * that model. Cockpit's own machinery rather than a document of the user's, so
 * it lives beside the sidecar and is written whenever it is not what this
 * version of cockpit generates.
 */
const MEMORY_HOOK_PATH = expandHome('~/.claude/cockpit-model-memory.sh');

/** Where Claude Code reads a user's hooks; the same file the user's own are in. */
const SETTINGS_PATH = expandHome('~/.claude/settings.json');

/**
 * Where a fleet hook's own script lands, one file per hook id. Named by id
 * rather than by name or hash, so renaming a hook in the editor moves its
 * registration but never orphans a script under an old name, and a hand edit
 * survives a hash bump to the same file it was made in.
 */
const HOOKS_DIR = expandHome('~/.claude/cockpit-hooks');

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

/**
 * One marketplace cockpit linked, under both of the names it answers to.
 * `name` is the hub config's; `linkedAs` is the one the CLI chose, out of the
 * marketplace's own manifest. They are routinely different — cockpit adds
 * `ryanthedev/rtd-claude-inn` and the CLI links it as `rtd` — so a sidecar that
 * kept one bare string left every later sync guessing which of the two it had.
 * Written only once something really is linked, which is what lets `linkedAs`
 * be a name the CLI is known to answer to rather than a hopeful one.
 */
interface ManagedMarketplace {
  name: string;
  linkedAs: string;
}

interface Sidecar {
  mcp: string[];
  marketplaces: ManagedMarketplace[];
  plugins: string[];
  /** Skill name → the hash of the files written, which is what makes a sync a no-op. */
  skills: Record<string, string>;
  /** The hash cockpit last wrote to `~/.claude/CLAUDE.md`; absent = unmanaged. */
  memory?: string;
  /**
   * Set path → the hash cockpit last wrote there, under `~/.claude/memories/`.
   * Per file, because drift is per file: one document edited on this machine
   * holds up itself and leaves the rest of the set converging.
   */
  memoryDocs: Record<string, string>;
  /** The SessionStart command cockpit registered; only this one is ever removed. */
  memoryHook?: string;
  /**
   * Hook id → what cockpit last registered for it. `command` is the identity
   * {@link withoutHooks} removes by — a command handler's `command` verbatim,
   * or the exact entry cockpit wrote otherwise — so a hook renamed or moved to
   * a different event or settings file is still collectable by what it used to
   * be, not by whatever this version of cockpit would write today.
   */
  hooks: Record<string, ManagedHook>;
}

/** What cockpit registered for one hook, enough to find and remove it later. */
interface ManagedHook {
  /** sha256 of the script cockpit wrote, or of the hub's row when there is no script. */
  hash: string;
  command: string;
  event: HookEvent;
  scope: FleetScope;
  cwd?: string;
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
 * Written whole and moved into place, whatever the content is. A crash between
 * the write and the rename leaves only the temp file behind — never a
 * half-written `path` that something else reads mid-write. A hook's script is
 * spawned with its execute bit, so a half-written one is worse than a
 * half-written JSON blob: it is a shell prefix somebody's session is about to run.
 */
const writeAtomic = async (path: string, content: string | Buffer): Promise<void> => {
  const temp = `${path}.cockpit-${process.pid}`;
  await Bun.write(temp, content);
  await rename(temp, path);
};

/** `~/.claude.json` is read by every Claude Code on this machine, and a
 * half-written one is a machine with no MCP servers and no history. */
const writeJson = (path: string, value: unknown): Promise<void> =>
  writeAtomic(path, JSON.stringify(value, null, 2));

/**
 * A sidecar written before a marketplace carried both its names has one bare
 * string and no way to tell whose name it is. Kept only when the CLI still
 * lists something under it, because that is the only reading under which it
 * names something on this machine — a leftover cockpit name owns nothing, and
 * treating it as a link is what would have a later sync remove a name that was
 * never linked. Config puts the entry back, in full, on the same sync.
 */
export const upgradeMarketplaces = (
  stored: (string | ManagedMarketplace)[] | undefined,
  linked: Record<string, KnownMarketplace>
): ManagedMarketplace[] =>
  (stored ?? []).flatMap((one) => {
    if (typeof one !== 'string') return [one];
    return linked[one] ? [{ name: one, linkedAs: one }] : [];
  });

/** What cockpit put here last time; unreadable is the same as never written. */
const readSidecar = async (): Promise<Sidecar> => {
  // Typed to admit the older shape too, so the upgrade is a fact of the type
  // rather than a cast: what is on disk may predate a marketplace's two names.
  const stored = await readJson<
    Partial<Omit<Sidecar, 'marketplaces'>> & { marketplaces?: (string | ManagedMarketplace)[] }
  >(SIDECAR);
  return {
    mcp: stored?.mcp ?? [],
    marketplaces: upgradeMarketplaces(stored?.marketplaces, await linkedMarketplaces()),
    plugins: stored?.plugins ?? [],
    // A sidecar written before skills existed names none, which is the truth.
    skills: stored?.skills ?? {},
    ...(stored?.memory ? { memory: stored.memory } : {}),
    // Likewise one written before the memory was a set: no linked document on
    // this machine is cockpit's, so none of them is cockpit's to take away.
    memoryDocs: stored?.memoryDocs ?? {},
    ...(stored?.memoryHook ? { memoryHook: stored.memoryHook } : {}),
    // A sidecar written before hooks existed manages none, which is the truth.
    hooks: stored?.hooks ?? {},
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

/** One entry of the CLI's own account of what is linked, and where it came from. */
export interface KnownMarketplace {
  source?: { source?: string; repo?: string; url?: string; path?: string };
}

const linkedMarketplaces = async (): Promise<Record<string, KnownMarketplace>> =>
  (await readJson<Record<string, KnownMarketplace>>(KNOWN_MARKETPLACES)) ?? {};

/**
 * `owner/repo`, an ssh remote, an https clone URL and a `marketplace.json` URL
 * can all name the same link. Compared on the part that identifies it, so the
 * spelling cockpit stores still matches whatever the CLI wrote down.
 */
const sourceKey = (source: string): string =>
  source
    .trim()
    .toLowerCase()
    .replace(/^git\+/, '')
    .replace(/^git@github\.com:/, '')
    .replace(/^(https?|ssh):\/\/([^@]*@)?(www\.)?github\.com\//, '')
    .replace(/\.git$/, '')
    .replace(/\/+$/, '');

const sourceKeysOf = (entry: KnownMarketplace): string[] =>
  [entry.source?.repo, entry.source?.url, entry.source?.path]
    .filter((one): one is string => typeof one === 'string')
    .map(sourceKey);

/**
 * The name the CLI linked a marketplace under, which comes from the
 * marketplace's own `marketplace.json` and is not necessarily the name cockpit
 * calls it: `ryanthedev/rtd-claude-inn` is added and comes back as `rtd`.
 * Everything downstream — the clone's directory, a `plugin@marketplace` id,
 * `marketplace remove` — speaks the CLI's name, so a sync that kept cockpit's
 * would report a successful add as a failure and never install a plugin from
 * it. Matched on the source when the name does not hit, because the source is
 * the one thing both sides agree on.
 */
export const linkedNameIn = (
  linked: Record<string, KnownMarketplace>,
  name: string,
  source: string
): string | undefined => {
  if (linked[name]) return name;
  const wanted = sourceKey(source);
  return Object.keys(linked).find((key) => sourceKeysOf(linked[key]).includes(wanted));
};

const linkedNameFor = async (name: string, source: string): Promise<string | undefined> =>
  linkedNameIn(await linkedMarketplaces(), name, source);

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
 * Which of the marketplaces cockpit linked last time are cockpit's to unlink
 * now. What goes is a link, so what is compared is the link: renaming a
 * marketplace in the hub's config changes cockpit's name for it and nothing on
 * the machine, and comparing the names instead would unlink the marketplace
 * this same sync just linked. A name config still asks for is not a removal
 * either — nothing linked under it means the add failed, which is its own
 * report and not something to take away.
 */
export const toUnlink = (
  managed: ManagedMarketplace[],
  kept: ManagedMarketplace[],
  config: Pick<FleetConfig, 'marketplaces'>
): ManagedMarketplace[] => {
  const keeping = new Set(kept.map(({ linkedAs }) => linkedAs));
  const asked = new Set(config.marketplaces.map(({ name }) => name));
  return managed.filter(({ name, linkedAs }) => !keeping.has(linkedAs) && !asked.has(name));
};

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

  /**
   * The report stays keyed by cockpit's name, because that is the row the
   * dashboard has; everything that acts on the machine uses the CLI's.
   */
  const marketplaces: ManagedMarketplace[] = [];

  for (const { name, source } of config.marketplaces) {
    const already = await linkedNameFor(name, source);
    if (already) {
      marketplaces.push({ name, linkedAs: already });
      report.marketplaces[name] = { state: 'applied' };
      continue;
    }
    const ran = await runClaude(bin, ['plugin', 'marketplace', 'add', source]);
    const linkedAs = await linkedNameFor(name, source);
    if (!linkedAs) {
      // Nothing was linked, so there is nothing for a later sync to take away.
      report.marketplaces[name] = { state: 'failed', detail: ran.output };
      continue;
    }
    marketplaces.push({ name, linkedAs });
    report.marketplaces[name] = { state: 'applied' };
  }

  for (const { name, linkedAs } of toUnlink(managed.marketplaces, marketplaces, config)) {
    const ran = await runClaude(bin, ['plugin', 'marketplace', 'remove', linkedAs]);
    report.marketplaces[name] = (await isLinked(linkedAs))
      ? { state: 'failed', detail: ran.output }
      : { state: 'removed' };
  }

  const linked = await linkedMarketplaces();
  for (const { id } of wantedPlugins) {
    const marketplace = marketplaceOf(id);
    // The CLI's own account, not this run's report: a plugin id names the
    // marketplace the CLI's way, which is not the key the report is under.
    if (!linked[marketplace]) {
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

/** What is really at a memory file; null is a machine that has none. */
const fileHashAt = async (path: string): Promise<string | null> => {
  const file = Bun.file(path);
  return (await file.exists()) ? hashText(await file.text()) : null;
};

/** What is really at `~/.claude/CLAUDE.md`; null is a machine that has none. */
const memoryFileHash = (): Promise<string | null> => fileHashAt(MEMORY_PATH);

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

/**
 * Every document really under `~/.claude/memories/`, by the path the set keys
 * it under. Markdown only, and depth is whatever the set uses — `models/` is
 * the one this version writes, and a reader should still see the rest.
 */
const memoryDocPaths = async (root: string = MEMORIES_DIR, prefix = ''): Promise<string[]> => {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const paths: string[] = [];
  for (const entry of entries) {
    const relative = `${prefix}${entry.name}`;
    if (entry.isDirectory()) {
      paths.push(...(await memoryDocPaths(join(root, entry.name), `${relative}/`)));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      paths.push(relative);
    }
  }
  return paths.sort();
};

/**
 * The directories a removal emptied, taken away bottom-up. `rmdir` refuses a
 * directory with anything in it, which is exactly the check wanted: a folder
 * still holding a document of somebody's own stays where it is.
 */
const pruneEmptyDirs = async (): Promise<void> => {
  const dirs = new Set<string>();
  const walk = async (root: string, prefix: string): Promise<void> => {
    for (const entry of await readdir(root, { withFileTypes: true }).catch(() => [])) {
      if (!entry.isDirectory()) continue;
      dirs.add(`${prefix}${entry.name}`);
      await walk(join(root, entry.name), `${prefix}${entry.name}/`);
    }
  };
  await walk(MEMORIES_DIR, '');

  // Deepest first, so a parent is only tried once its children are gone.
  for (const relative of [...dirs].sort((a, b) => b.split('/').length - a.split('/').length)) {
    await rmdir(join(MEMORIES_DIR, relative)).catch(() => {});
  }
  await rmdir(MEMORIES_DIR).catch(() => {});
};

/**
 * What to do about every document of the set, from hashes alone: one
 * {@link memoryPlan} per path the fleet carries, and one per path only the
 * sidecar still names — which is a document the fleet has stopped carrying.
 *
 * Pure, and separate from the writing for the same reason `memoryPlan` is: this
 * is where "cockpit overwrote what I wrote" is caught, and a decision that only
 * exists inside a filesystem walk is a decision nothing can ask about.
 *
 * A hub that predates the set sends no documents at all, which arrives here as
 * an empty `desired` — every managed document is then given back, exactly as
 * the fleet keeping no memory gives back the main file.
 */
export function memorySetPlan(
  desired: readonly { path: string; hash: string; force?: boolean }[],
  onDisk: Readonly<Record<string, string | null>>,
  managed: Readonly<Record<string, string>>
): Record<string, MemoryPlan> {
  const plans: Record<string, MemoryPlan> = {};
  for (const doc of desired) {
    plans[doc.path] = memoryPlan(doc, onDisk[doc.path] ?? null, managed[doc.path]);
  }
  for (const [path, hash] of Object.entries(managed)) {
    if (plans[path] !== undefined) continue;
    plans[path] = memoryPlan(undefined, onDisk[path] ?? null, hash);
  }
  return plans;
}

/**
 * The linked documents, {@link memorySetPlan} applied. Every rule the single
 * document has, held per file: one edited on this machine is reported and left
 * alone, the rest of the set converges around it, and a document the fleet
 * stops carrying is only deleted while it is still exactly what cockpit wrote.
 */
const syncMemoryDocs = async (
  desired: FleetMemoryDoc[],
  managed: Record<string, string>,
  report: Record<string, FleetItemState>
): Promise<Record<string, string>> => {
  const written: Record<string, string> = {};

  // The hub refuses these at the door; a set that reached here with one anyway
  // is not something to trust with a write, so it is turned away here too.
  const safe: FleetMemoryDoc[] = [];
  for (const doc of desired) {
    const problem = memoryDocProblem(doc.path);
    if (!problem) {
      safe.push(doc);
      continue;
    }
    // Nothing is written, so the machine keeps whatever it already had.
    if (managed[doc.path] !== undefined) written[doc.path] = managed[doc.path];
    report[doc.path] = { state: 'failed', detail: problem };
  }

  const onDisk: Record<string, string | null> = {};
  for (const path of new Set([...safe.map((doc) => doc.path), ...Object.keys(managed)])) {
    onDisk[path] = await fileHashAt(join(MEMORIES_DIR, path));
  }

  const plans = memorySetPlan(safe, onDisk, managed);
  const wanted = new Map(safe.map((doc) => [doc.path, doc]));
  let removed = false;

  for (const [path, plan] of Object.entries(plans)) {
    const doc = wanted.get(path);
    if (!doc) {
      if (plan === 'remove') {
        await rm(join(MEMORIES_DIR, path), { force: true });
        report[path] = { state: 'removed' };
        removed = true;
      } else {
        // An edited one outlives the fleet's row, unmanaged and where it is.
        report[path] = { state: 'removed', detail: 'kept: edited on this machine' };
      }
      continue;
    }

    if (plan === 'drift') {
      report[path] = { state: 'failed', detail: DRIFTED };
      if (managed[path] !== undefined) written[path] = managed[path];
      continue;
    }
    if (plan === 'skip') {
      written[path] = managed[path];
      report[path] = { state: 'applied' };
      continue;
    }

    try {
      await Bun.write(join(MEMORIES_DIR, path), doc.content);
      written[path] = doc.hash;
      report[path] = { state: 'applied' };
    } catch (error) {
      // The machine keeps the hash it had, so the next sync writes again rather
      // than believing this one landed.
      if (managed[path] !== undefined) written[path] = managed[path];
      report[path] = { state: 'failed', detail: tail(said(error)) };
    }
  }
  if (removed) await pruneEmptyDirs();

  return written;
};

/**
 * The SessionStart hook, verbatim. Claude Code hands the hook its JSON on
 * stdin, and SessionStart is the only event that carries the model at all — no
 * environment variable names it and CLAUDE.md itself is loaded flat, so this is
 * the whole of how a document reaches only the sessions it is for.
 *
 * POSIX sh and nothing else: it runs on every machine the fleet has, including
 * the ones where the daemon's own Bun is the only Bun there is.
 *
 * Exported so a test can run the real text under a real `sh` — the escaping in
 * here is the kind that is wrong quietly, on somebody else's machine.
 */
export const MEMORY_HOOK = `#!/bin/sh
# Written by cockpit. Edits are overwritten — the fleet's documents are in
# ~/.claude/memories/, and this only decides which one a session is shown.
set -u

dir="\${HOME}/.claude/memories/models"
[ -d "$dir" ] || exit 0

input=$(cat)
# The model id, whether it arrives as a string or as an object with an \`id\`.
# It is not guaranteed to be there at all, and a session without one is shown
# nothing: the main CLAUDE.md carries the pointer for that case.
flat=$(printf '%s' "$input" | tr -d '\\n')
model=$(printf '%s' "$flat" | sed -n 's/.*"model"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/p')
[ -n "$model" ] || model=$(printf '%s' "$flat" | sed -n 's/.*"model"[[:space:]]*:[[:space:]]*{[^}]*"id"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/p')
[ -n "$model" ] || exit 0

# Longest prefix wins, so \`claude-opus-5-20260315\` takes claude-opus-5.md over
# a claude.md beside it, and an id nothing is named for takes nothing.
best=''
for file in "$dir"/*.md; do
  [ -f "$file" ] || continue
  name=\${file##*/}
  name=\${name%.md}
  case "$model" in
    "$name"*)
      if [ \${#name} -gt \${#best} ]; then best=$name; fi
      ;;
  esac
done

[ -n "$best" ] || exit 0

# Stdout from a SessionStart hook is added to the session's context.
cat "$dir/$best.md"
exit 0
`;

/** One entry of a hook, as `~/.claude/settings.json` writes them — a command
 * handler carries `command`; the other four handler types do not, so an entry
 * without one is matched on its own JSON instead (see {@link withoutHooks}). */
interface HookCommand {
  type?: string;
  command?: string;
}

/** One matcher's worth of hooks; an absent `matcher` is every session start. */
interface HookMatcher {
  matcher?: string;
  hooks?: HookCommand[];
}

/**
 * The same list without cockpit's own entries. A matcher entry that held
 * anything else comes back holding it, and one that is left with nothing goes —
 * but only when it was ours that emptied it. `commands` names what cockpit
 * registered last time, not what it would register today, so a hook that was
 * renamed, moved to a different script path, or changed handler type entirely
 * is still found and taken out — a set keyed off today's constants would leave
 * the old one behind forever.
 */
export function withoutHooks(entries: HookMatcher[], commands: string[]): HookMatcher[] {
  const gone = new Set(commands);
  const isOurs = (hook: HookCommand): boolean =>
    gone.has(hook.command !== undefined ? hook.command : JSON.stringify(hook));
  return entries.flatMap((entry) => {
    const hooks = entry.hooks ?? [];
    const kept = hooks.filter((hook) => !isOurs(hook));
    if (kept.length === hooks.length) return [entry];
    return kept.length > 0 ? [{ ...entry, hooks: kept }] : [];
  });
}

/**
 * Registers the hook while the set carries a `models/` document, and takes it
 * back out when it stops. `~/.claude/settings.json` is the user's own file, so
 * only the one command the sidecar names is ever removed and the file is only
 * written when this actually changes something.
 */
const syncMemoryHook = async (
  desired: FleetMemoryDoc[],
  managed: string | undefined,
  report: FleetSyncReport
): Promise<string | undefined> => {
  const wanted = desired.some(
    (doc) => doc.path.startsWith('models/') && memoryDocProblem(doc.path) === undefined
  );
  if (!wanted && managed === undefined) return undefined;

  const stored = await readJson<Record<string, unknown>>(SETTINGS_PATH);
  // Nothing is written over a file that cannot be read: the rest of it is the
  // user's permissions and plugins, and a rewrite would take them with it.
  if (stored === undefined && (await Bun.file(SETTINGS_PATH).exists())) {
    report.memoryHook = { state: 'failed', detail: 'could not parse ~/.claude/settings.json' };
    return managed;
  }

  const root = stored ?? {};
  const hooks = { ...((root.hooks as Record<string, unknown> | undefined) ?? {}) };
  const starts = (hooks.SessionStart as HookMatcher[] | undefined) ?? [];
  const command = MEMORY_HOOK_PATH;
  const next = wanted
    ? [...withoutHooks(starts, [command]), { hooks: [{ type: 'command', command }] }]
    : withoutHooks(starts, [managed ?? command]);

  if (next.length > 0) hooks.SessionStart = next;
  else delete hooks.SessionStart;
  const settings = { ...root };
  if (Object.keys(hooks).length > 0) settings.hooks = hooks;
  else delete settings.hooks;

  try {
    if (wanted && (await Bun.file(MEMORY_HOOK_PATH).text().catch(() => '')) !== MEMORY_HOOK) {
      await writeAtomic(MEMORY_HOOK_PATH, MEMORY_HOOK);
      // Claude Code spawns the command itself, so it has to be executable.
      await chmod(MEMORY_HOOK_PATH, 0o755);
    }
    if (JSON.stringify(settings) !== JSON.stringify(root)) await writeJson(SETTINGS_PATH, settings);
    if (!wanted) await rm(MEMORY_HOOK_PATH, { force: true });
  } catch (error) {
    report.memoryHook = { state: 'failed', detail: tail(said(error)) };
    return managed;
  }

  report.memoryHook = wanted ? { state: 'applied' } : { state: 'removed' };
  return wanted ? command : undefined;
};

/** Where a hook's own script lands: `~/.claude/cockpit-hooks/<id>.sh`. */
const hookScriptPath = (id: string): string => join(HOOKS_DIR, `${id}.sh`);

/** `~/.claude/settings.json` for a fleet-wide hook, `<cwd>/.claude/settings.json`
 * for one bound to a project — the same file a project MCP server's counterpart
 * would use if MCP had one, and the only settings file a session in that
 * checkout actually reads for its hooks. */
const settingsPathFor = (hook: Pick<FleetHook, 'scope' | 'cwd'>): string =>
  hook.scope && hook.scope !== 'user' && hook.cwd
    ? join(hook.cwd, '.claude', 'settings.json')
    : SETTINGS_PATH;

/**
 * The handler as it goes into `settings.json`. A command handler carrying a
 * script is pointed at the path cockpit wrote it to on *this* machine — the
 * fleet row itself never names a path, because a path is machine-local and the
 * row has to mean the same thing on every box it reaches. Every other handler,
 * and a command handler with no script, is written exactly as the hub sent it.
 */
const handlerFor = (hook: FleetHook, scriptPath: string | undefined): HookHandler =>
  hook.handler.type === 'command' && scriptPath ? { ...hook.handler, command: scriptPath } : hook.handler;

/** What {@link withoutHooks} removes this handler by, and what the sidecar
 * remembers registering it as. */
const identityOf = (handler: HookHandler): string =>
  handler.type === 'command' && handler.command ? handler.command : JSON.stringify(handler);

/**
 * Writes every enabled hook's script and registers it in the settings.json its
 * scope points at, and takes back out whatever a disabled or deleted hook, or
 * one that no longer passes validation, used to have registered. The one row
 * here that is executable: a hook that reaches this function runs on a shell,
 * unprompted, on every machine that gets it, which is why it is checked again
 * below rather than trusted on the wire — the hub already refused an invalid
 * one at the door, but that is the hub's process, not this one's guarantee.
 */
const syncHooks = async (
  desired: FleetHook[],
  managed: Record<string, ManagedHook>,
  report: Record<string, FleetItemState>
): Promise<Record<string, ManagedHook>> => {
  const written: Record<string, ManagedHook> = {};
  const keep = (id: string): void => {
    if (managed[id]) written[id] = managed[id];
  };

  // A disabled hook is simply not written — that is the whole of per-hook
  // disable, since Claude Code has no way to turn off one hook and keep the
  // rest of its matcher entry. It falls straight through to the removal pass
  // at the bottom, same as a hook the fleet has stopped carrying at all.
  const wanted: FleetHook[] = [];
  for (const hook of desired) {
    if (!hook.enabled) continue;
    const problems = Object.values(hookProblem(hook));
    if (problems.length > 0) {
      keep(hook.id);
      report[hook.id] = { state: 'failed', detail: problems[0] };
      continue;
    }
    if (hook.scope && hook.scope !== 'user' && !hook.cwd) {
      keep(hook.id);
      report[hook.id] = { state: 'failed', detail: 'bound to a project this machine has no checkout for' };
      continue;
    }
    wanted.push(hook);
  }

  // One script write per hook that carries one, drift left alone unless
  // `force` — a hand-edited script stays registered exactly where it is, just
  // never overwritten out from under whoever edited it.
  const scriptPaths = new Map<string, string>();
  const hashes = new Map<string, string>();
  const settled: FleetHook[] = [];
  for (const hook of wanted) {
    if (hook.handler.type !== 'command' || !hook.script) {
      settled.push(hook);
      continue;
    }
    const path = hookScriptPath(hook.id);
    const plan = memoryPlan({ hash: hook.hash, force: hook.force }, await fileHashAt(path), managed[hook.id]?.hash);
    if (plan === 'drift') {
      report[hook.id] = { state: 'failed', detail: DRIFTED };
      hashes.set(hook.id, managed[hook.id]?.hash ?? hook.hash);
      scriptPaths.set(hook.id, path);
      settled.push(hook);
      continue;
    }
    if (plan === 'write') {
      try {
        await writeAtomic(path, hook.script);
        // Claude Code spawns it directly, so it has to carry its own execute bit.
        await chmod(path, 0o755);
      } catch (error) {
        keep(hook.id);
        report[hook.id] = { state: 'failed', detail: tail(said(error)) };
        continue;
      }
    }
    scriptPaths.set(hook.id, path);
    settled.push(hook);
  }

  // Registration, one settings.json per place a hook is bound to — including a
  // file nothing here still wants, so a hook whose row was disabled or deleted
  // still gets its old entry taken out of the file it used to be in.
  const bySettings = new Map<string, FleetHook[]>();
  for (const hook of settled) {
    const path = settingsPathFor(hook);
    bySettings.set(path, [...(bySettings.get(path) ?? []), hook]);
  }
  for (const record of Object.values(managed)) {
    const path = settingsPathFor(record);
    if (!bySettings.has(path)) bySettings.set(path, []);
  }

  for (const [path, hooks] of bySettings) {
    const stored = await readJson<Record<string, unknown>>(path);
    // Nothing is written over a file that cannot be read: the rest of it is the
    // user's own permissions and plugins, and a rewrite from an empty root
    // would take them with it.
    if (stored === undefined && (await Bun.file(path).exists())) {
      const detail = `could not parse ${path}`;
      for (const hook of hooks) {
        keep(hook.id);
        report[hook.id] = { state: 'failed', detail };
      }
      continue;
    }

    const root = stored ?? {};
    const settingsHooks = { ...((root.hooks as Record<string, unknown> | undefined) ?? {}) };

    // Everything cockpit registered out of this file last time, whatever event
    // it ran on — a hook that moved to a different event still needs its old
    // row gone, not just left orphaned under the event it used to fire on.
    const registeredHere = Object.values(managed)
      .filter((record) => settingsPathFor(record) === path)
      .map((record) => record.command);

    const byEvent = new Map<HookEvent, FleetHook[]>();
    for (const hook of hooks) byEvent.set(hook.event, [...(byEvent.get(hook.event) ?? []), hook]);

    const events = new Set<HookEvent>([...byEvent.keys(), ...(Object.keys(settingsHooks) as HookEvent[])]);
    for (const event of events) {
      const current = (settingsHooks[event] as HookMatcher[] | undefined) ?? [];
      const additions = (byEvent.get(event) ?? []).map((hook): HookMatcher => {
        const handler = handlerFor(hook, scriptPaths.get(hook.id));
        written[hook.id] = {
          hash: hashes.get(hook.id) ?? hook.hash,
          command: identityOf(handler),
          event: hook.event,
          scope: hook.scope ?? 'user',
          ...(hook.cwd ? { cwd: hook.cwd } : {}),
        };
        return hook.matcher ? { matcher: hook.matcher, hooks: [handler] } : { hooks: [handler] };
      });
      const next = [...withoutHooks(current, registeredHere), ...additions];
      if (next.length > 0) settingsHooks[event] = next;
      else delete settingsHooks[event];
    }

    const settings = { ...root };
    if (Object.keys(settingsHooks).length > 0) settings.hooks = settingsHooks;
    else delete settings.hooks;

    if (JSON.stringify(settings) !== JSON.stringify(root)) {
      try {
        await writeJson(path, settings);
      } catch (error) {
        const detail = tail(said(error));
        for (const hook of hooks) {
          keep(hook.id);
          report[hook.id] = { state: 'failed', detail };
        }
        continue;
      }
    }

    for (const hook of hooks) {
      if (report[hook.id]) continue; // already reported failed/drift above
      report[hook.id] = { state: 'applied' };
    }
  }

  // A hook that is disabled, deleted, or failed validation this round and had
  // nothing kept alive for it above is one whose registration and script (if
  // cockpit wrote one) are cockpit's to take away.
  const stillHere = new Set(settled.map((hook) => hook.id));
  for (const [id, record] of Object.entries(managed)) {
    if (stillHere.has(id) || written[id]) continue;
    if (record.command.startsWith(HOOKS_DIR)) await rm(record.command, { force: true });
    report[id] = { state: 'removed' };
  }

  return written;
};

const converge = async (config: FleetConfig): Promise<FleetSyncReport> => {
  const managed = await readSidecar();
  const skillStates: Record<string, FleetItemState> = {};
  const docStates: Record<string, FleetItemState> = {};
  const hookStates: Record<string, FleetItemState> = {};
  const report: FleetSyncReport = {
    mcp: {},
    marketplaces: {},
    plugins: {},
    skills: skillStates,
    memoryDocs: docStates,
    hooks: hookStates,
    at: Date.now(),
  };

  const mcp = await syncMcp(config.mcp, managed.mcp, report.mcp);
  const installed = await syncPlugins(config, managed, report);
  const skills = await syncSkillFiles(config.skills ?? [], managed.skills, skillStates);
  const memory = await syncMemory(config.memory, managed.memory, report);
  // A hub that predates the set sends no `docs`, which reads as a fleet that
  // links none — and the machine gives back the ones cockpit wrote it.
  const docs = config.memory?.docs ?? [];
  const memoryDocs = await syncMemoryDocs(docs, managed.memoryDocs, docStates);
  const memoryHook = await syncMemoryHook(docs, managed.memoryHook, report);
  // A hub that predates hooks sends no `hooks`, which reads the same way: a
  // fleet that keeps none, and the machine gives back whatever cockpit
  // registered before this daemon knew what that field meant.
  const hooks = await syncHooks(config.hooks ?? [], managed.hooks, hookStates);
  await writeJson(SIDECAR, {
    mcp,
    ...installed,
    skills,
    ...(memory ? { memory } : {}),
    memoryDocs,
    ...(memoryHook ? { memoryHook } : {}),
    hooks,
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
  const memoryDocs: Record<string, FleetItemState> = {};
  const hooks: Record<string, FleetItemState> = {};
  const report: FleetSyncReport = {
    mcp: {},
    marketplaces: {},
    plugins: {},
    skills,
    memoryDocs,
    hooks,
    at: Date.now(),
  };

  const file = await readClaudeJson();
  const servers = file.ok ? mcpServersOf(file.root) : {};
  for (const name of managed.mcp) {
    report.mcp[name] = servers[name]
      ? { state: 'applied' }
      : { state: 'failed', detail: file.ok ? 'not in ~/.claude.json' : file.detail };
  }
  for (const { name, linkedAs } of managed.marketplaces) {
    report.marketplaces[name] = (await isLinked(linkedAs))
      ? { state: 'applied' }
      : { state: 'failed', detail: `${linkedAs} is not in known_marketplaces.json` };
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
  for (const [path, hash] of Object.entries(managed.memoryDocs)) {
    const fileHash = await fileHashAt(join(MEMORIES_DIR, path));
    memoryDocs[path] =
      fileHash === hash
        ? { state: 'applied' }
        : { state: 'failed', detail: fileHash === null ? 'not on disk' : DRIFTED };
  }
  if (managed.memoryHook !== undefined) {
    report.memoryHook = (await Bun.file(managed.memoryHook).exists())
      ? { state: 'applied' }
      : { state: 'failed', detail: 'not on disk' };
  }
  for (const [id, record] of Object.entries(managed.hooks)) {
    if (record.command.startsWith(HOOKS_DIR)) {
      const fileHash = await fileHashAt(record.command);
      hooks[id] =
        fileHash === record.hash
          ? { state: 'applied' }
          : { state: 'failed', detail: fileHash === null ? 'not on disk' : DRIFTED };
      continue;
    }
    // No script of cockpit's to check: the only question is whether the
    // entry it registered is still in the settings.json it registered it in.
    const settingsPath = settingsPathFor(record);
    const stored = await readJson<Record<string, unknown>>(settingsPath);
    const entries = ((stored?.hooks as Record<string, HookMatcher[]> | undefined)?.[record.event]) ?? [];
    const present = entries.some((entry) =>
      (entry.hooks ?? []).some((one) =>
        one.command !== undefined ? one.command === record.command : JSON.stringify(one) === record.command
      )
    );
    hooks[id] = present ? { state: 'applied' } : { state: 'failed', detail: `not in ${settingsPath}` };
  }
  return report;
};

/**
 * This machine's own memory set, whoever wrote it: the user CLAUDE.md and every
 * document beside it. What adoption reads — a memory a machine has been
 * collecting for a year is where the fleet's first document comes from, and a
 * machine somebody split into a set by hand is where the rest of it does.
 */
export const readMemoryFile = async (): Promise<MachineMemorySet | null> => {
  const file = Bun.file(MEMORY_PATH);
  const docs: MachineMemoryDoc[] = [];
  for (const path of await memoryDocPaths()) {
    const content = await Bun.file(join(MEMORIES_DIR, path)).text();
    docs.push({ path, content, hash: hashText(content) });
  }
  // A machine with documents but no main file still has a set worth adopting,
  // and an empty main file is what the fleet's own row would have been anyway.
  if (!(await file.exists())) return docs.length > 0 ? { content: '', hash: hashText(''), docs } : null;

  const content = await file.text();
  return { content, hash: hashText(content), docs };
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
  const docs: NonNullable<ConfigInspection['memory']>['docs'] = [];
  for (const path of await memoryDocPaths()) {
    const doc = Bun.file(join(MEMORIES_DIR, path));
    const hash = hashText(await doc.text());
    docs.push({ path, hash, bytes: doc.size, managed: managed.memoryDocs[path] === hash });
  }

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
      ? { hash: memoryHash, bytes: memoryFile.size, managed: managed.memory === memoryHash, docs }
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
