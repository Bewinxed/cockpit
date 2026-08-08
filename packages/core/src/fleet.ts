/**
 * Fleet configuration (NEW.md §11): the MCP servers, skill plugins and
 * subagents every machine's Claude Code should have. The hub owns the desired
 * state; a
 * machine-scoped `syncFleetConfig` control applies it and answers with what
 * the machine really has. Unlike the tool catalog (tools.ts), none of this is
 * a code catalog — the entries are the user's own rows.
 */
import type {
  McpHttpServerConfig,
  McpSSEServerConfig,
  McpStdioServerConfig,
} from '@anthropic-ai/claude-agent-sdk';

/**
 * Where a fleet row applies, in Claude Code's own vocabulary:
 *
 * - `user` — every machine, every project. MCP goes to `~/.claude.json`'s
 *   top-level `mcpServers`, skills to `~/.claude/skills/`, plugins install
 *   `--scope user`. The default, and what most rows want.
 * - `local` — one project, privately: `~/.claude.json`'s
 *   `projects["<cwd>"].mcpServers`, the map Claude Code already keeps per
 *   checkout and git never sees; plugins `--scope local`. What a
 *   project-bound row should be unless the reader asks to share it.
 * - `project` — one project, shared with whoever clones it: `.mcp.json` at
 *   the repo root, plugins `--scope project`. It writes inside the working
 *   tree, so it is never the default.
 *
 * Skills have no `local` in Claude Code, so a project-bound skill lands in
 * `<cwd>/.claude/skills/` under either scope.
 */
export type FleetScope = 'user' | 'project' | 'local';

/**
 * What binds a row to a place. An absent `scope` reads as `user`, so every
 * row written before scopes existed still means what it meant.
 */
export interface FleetPlacement {
  scope?: FleetScope;
  /** The hub `projects` row this is bound to. Required unless `user`. */
  projectId?: string;
  /**
   * The checkout to write into. The hub fills this in as it sends a sync —
   * a daemon never resolves a project id, and a machine only ever receives
   * the project rows that live on it.
   */
  cwd?: string;
}

/**
 * A serializable MCP server definition — the SDK's own config shapes minus the
 * in-process `sdk` kind, which cannot cross a wire. Stored verbatim in the
 * hub and written verbatim into `~/.claude.json`; `${VAR}` expansion inside
 * is the CLI's own affair.
 */
export type FleetMcpConfig = McpStdioServerConfig | McpSSEServerConfig | McpHttpServerConfig;

/** One MCP server the fleet should have, keyed by the name sessions see. */
export interface FleetMcpServer extends FleetPlacement {
  name: string;
  config: FleetMcpConfig;
  /** Disabled rows stay in the hub but are removed from the machines. */
  enabled: boolean;
}

/**
 * One linked plugin marketplace. `source` is whatever
 * `claude plugin marketplace add` accepts — `owner/repo`, a git URL, a
 * marketplace.json URL — passed through verbatim.
 */
export interface FleetMarketplace extends FleetPlacement {
  name: string;
  source: string;
}

/** One installed plugin. `id` is the CLI's own `plugin@marketplace` form. */
export interface FleetPlugin extends FleetPlacement {
  id: string;
  /** Disabled rows are uninstalled from the machines, not merely disabled. */
  enabled: boolean;
}

/** One file of a resolved skill; `path` is relative to the skill's directory. */
export interface SkillFile {
  path: string;
  /** Base64 so a skill's scripts and images survive the JSON hop unharmed. */
  contentBase64: string;
}

/**
 * A skill row as the hub stores and the dashboard reads it: where it came
 * from and what the hub resolved it to. The files themselves stay out of
 * this shape — a catalog read should not weigh megabytes.
 *
 * `source` forms the hub's resolver accepts. Installer CLIs are deliberately
 * never run: an installer is a wrapper around "copy files into
 * `~/.claude/skills/<name>`", and cockpit does the copy itself.
 * - `skills:owner/repo[@skill][#ref]` — a skills.sh-style slug (what the
 *   user would have typed after `bunx skills add`). The repo tarball is
 *   walked in the CLI's own discovery order, except `.claude/skills/` wins
 *   over `.agents/skills/` — cockpit wants the Claude-tuned variant.
 * - `github:owner/repo[/path][@ref]` — the repo tarball, `path` pointing at
 *   the skill directory.
 * - `npm:package[@version]` — the registry tarball, for the few packages
 *   that embed `skills/<name>/SKILL.md` (most installer packages carry no
 *   content — their CLIs fetch from GitHub at runtime).
 * - a plain URL to a `SKILL.md` (single-file skill).
 */
export interface FleetSkillMeta extends FleetPlacement {
  name: string;
  source: string;
  enabled: boolean;
  /** Content hash of the resolved files; absent until a resolve succeeds. */
  hash?: string;
  /** Decoded size of the resolved files, for the dashboard to show. */
  bytes?: number;
  /** Why the last resolve failed, when it did. */
  error?: string;
}

/** What sync carries per enabled skill: the resolved content, by hash. */
export interface FleetSkillPayload extends FleetPlacement {
  name: string;
  hash: string;
  files: SkillFile[];
}

/**
 * One subagent the fleet keeps (NEW.md §11), without the file it is. A subagent
 * *is* its markdown — YAML front matter over a body that becomes the system
 * prompt — and its identity is the front matter's `name`, not the filename. So
 * cockpit stores the file verbatim and re-models none of it.
 */
export interface FleetAgentMeta {
  name: string;
  /** sha256 hex of `content` — what tells a machine's copy apart from the fleet's. */
  hash: string;
  bytes: number;
  /** When the hub last stored it, ms epoch. */
  at: number;
}

/**
 * The whole file. Unlike a skill's, it rides the catalog read: a definition is
 * a page of markdown, and an editor that has to fetch it again is a round trip
 * for nothing.
 *
 * Phase B: daemon `syncFleetConfig` owns convergence; until then the hub pushes
 * over the `fs` verb, which is why this is nowhere in {@link FleetConfig}.
 */
export interface FleetAgent extends FleetAgentMeta {
  content: string;
}

/**
 * A subagent's front matter, as far as anything outside Claude Code reads it:
 * the two fields that make the file usable, and the three a row shows. The file
 * is the interface — every other field passes through untouched, because
 * cockpit is not a second schema for it.
 */
export interface AgentFrontMatter {
  name?: string;
  description?: string;
  /** `sonnet`/`opus`/`haiku`/`fable`, a full id, or `inherit` — the default. */
  model?: string;
  tools?: string[];
  /** `low` … `max`. */
  effort?: string;
}

/**
 * What a subagent may be called. Claude Code's own rule: the name is the token
 * a delegation asks for, and a `:` in it collides with the plugin namespace.
 */
export const AGENT_NAME = /^[a-z][a-z0-9-]*$/;

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---/;

/** `"a"`, `'a'` or a bare word — YAML's three ways of writing one scalar. */
const unquote = (value: string): string => {
  const trimmed = value.trim();
  const quoted = /^(["'])([\s\S]*)\1$/.exec(trimmed);
  return quoted ? quoted[2] : trimmed;
};

/** A comma-separated list, an inline `[a, b]`, or a sequence already joined. */
const splitList = (value: string): string[] =>
  value
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map(unquote)
    .filter(Boolean);

/**
 * The front matter block's top-level scalars. Deliberately not a YAML parser:
 * the five fields anything here reads are a word, a sentence or a list of
 * words, and a dependency that understands anchors and merge keys would still
 * be storing the file verbatim. A block scalar (`|`, `>`) folds to one line and
 * a block sequence joins with commas, so both reach the reader as themselves.
 */
export const parseAgentFrontMatter = (content: string): AgentFrontMatter => {
  const block = FRONT_MATTER.exec(content);
  if (!block) return {};

  const lines = block[1].split(/\r?\n/);
  const fields: Record<string, string> = {};
  for (let at = 0; at < lines.length; at += 1) {
    // Top-level keys only: an indented line belongs to whatever opened above it.
    const pair = /^([A-Za-z][A-Za-z0-9_-]*):(.*)$/.exec(lines[at]);
    if (!pair) continue;
    const [, key, rest] = pair;
    const value = rest.trim();

    if (value.startsWith('|') || value.startsWith('>')) {
      const folded: string[] = [];
      while (at + 1 < lines.length && /^\s+\S/.test(lines[at + 1])) folded.push(lines[++at].trim());
      fields[key] = folded.join(' ');
    } else if (value === '') {
      const items: string[] = [];
      while (at + 1 < lines.length && /^\s*-\s+/.test(lines[at + 1])) {
        items.push(unquote(lines[++at].replace(/^\s*-\s+/, '')));
      }
      if (items.length > 0) fields[key] = items.join(', ');
    } else {
      fields[key] = unquote(value);
    }
  }

  return {
    ...(fields.name ? { name: fields.name } : {}),
    ...(fields.description ? { description: fields.description } : {}),
    ...(fields.model ? { model: fields.model } : {}),
    ...(fields.tools ? { tools: splitList(fields.tools) } : {}),
    ...(fields.effort ? { effort: fields.effort } : {}),
  };
};

/**
 * Why this file cannot be stored as a subagent, in a sentence, or nothing when
 * it can. One rule for the hub's refusal and the editor's live reading, so a
 * save is never turned away for something the page said was fine.
 *
 * `expected` is the name the file is being stored under: a definition renamed
 * in place would leave the old row and the old file behind, so it is refused
 * rather than silently made into two subagents.
 */
export const agentProblem = (front: AgentFrontMatter, expected?: string): string | undefined => {
  if (!front.name) return 'the front matter needs a name — that, not the filename, is what a delegation asks for';
  if (!AGENT_NAME.test(front.name)) {
    return `“${front.name}” is not a usable subagent name: lowercase letters, digits and hyphens only`;
  }
  if (expected !== undefined && front.name !== expected) {
    return `this file names “${front.name}”, not “${expected}” — remove that one and add this one instead`;
  }
  if (!front.description?.trim()) {
    return 'the front matter needs a description — it is the whole of how Claude Code decides to delegate';
  }
  return undefined;
};

/** The user-scope memory (`~/.claude/CLAUDE.md`), one document for the whole fleet. */
export interface FleetMemory {
  /** sha256 hex of `content` (UTF-8) — what a machine compares before writing. */
  hash: string;
  content: string;
  /** Set on a targeted push only: overwrite a machine copy that drifted. */
  force?: boolean;
}

/** The whole desired state — what the hub sends a machine to converge on. */
export interface FleetConfig {
  mcp: FleetMcpServer[];
  marketplaces: FleetMarketplace[];
  plugins: FleetPlugin[];
  /**
   * Directly-fetched skills, files inline (NEW.md §11). A daemon writes a
   * skill's directory under `~/.claude/skills/` only when the hash differs
   * from what its sidecar recorded. Absent from a hub that predates them.
   */
  skills?: FleetSkillPayload[];
  /**
   * The fleet's user-scope CLAUDE.md, or null when the fleet keeps none —
   * which is what has a machine give back the copy cockpit wrote it.
   */
  memory?: FleetMemory | null;
}

/**
 * What one desired entry came to on one machine. `removed` is a success: the
 * row was disabled or deleted and the machine no longer has it — reported
 * once so the dashboard can say so, gone from the next report.
 */
export interface FleetItemState {
  state: 'applied' | 'failed' | 'removed';
  /** `failed`: what the write or the CLI said — the tail of it. */
  detail?: string;
}

/**
 * A machine's answer to `syncFleetConfig`, and what `agents.fleet` stores:
 * every desired entry, by the same keys the config used.
 */
export interface FleetSyncReport {
  mcp: Record<string, FleetItemState>;
  marketplaces: Record<string, FleetItemState>;
  plugins: Record<string, FleetItemState>;
  /** Absent from a daemon that predates directly-fetched skills. */
  skills?: Record<string, FleetItemState>;
  /**
   * The user-scope CLAUDE.md. Absent from a daemon that predates it; `failed`
   * is how a machine says its own copy was edited and was not overwritten.
   */
  memory?: FleetItemState;
  /** When the sync ran, ms epoch. */
  at: number;
}

/** One installable plugin, as a linked marketplace's `marketplace.json` lists it. */
export interface MarketplacePluginInfo {
  name: string;
  description?: string;
  version?: string;
  category?: string;
}

/**
 * One MCP server a machine really has, wherever it came from. What
 * {@link INSPECT_CONFIG} reports — the fleet's own rows included, so a reader
 * sees one list rather than two halves of one.
 */
export interface DiscoveredMcp {
  name: string;
  scope: FleetScope;
  config: FleetMcpConfig;
  /** Whether cockpit wrote it — an unmanaged row is one worth adopting. */
  managed: boolean;
  /**
   * Set when a nearer scope defines the same name and wins. Claude Code's own
   * precedence is local > project > user, and a fleet server quietly shadowed
   * by a checkout is the kind of thing a reader should be told, not debug.
   */
  shadowedBy?: FleetScope;
}

/** One skill a machine really has. `plugin` skills come from an installed plugin. */
export interface DiscoveredSkill {
  name: string;
  scope: FleetScope | 'plugin';
  /** Absolute path of the skill's directory, for the reader and for adoption. */
  path: string;
  managed: boolean;
  /** The SKILL.md front matter's `description`, when it has one. */
  description?: string;
}

/**
 * What a session started in `cwd` would actually see, and what a machine has
 * outside any project when `cwd` is absent. The answer to two questions the
 * dashboard asks: "what is on this machine that cockpit does not manage?" and
 * "what will this folder give me?" — asked the moment a folder is chosen.
 */
export interface ConfigInspection {
  /** Absent for a machine-wide read. */
  cwd?: string;
  mcp: DiscoveredMcp[];
  skills: DiscoveredSkill[];
  /** Enabled plugin ids, as `plugin@marketplace`. */
  plugins: string[];
  /** Linked marketplaces, by name. */
  marketplaces: string[];
  /**
   * The machine's own user CLAUDE.md, or null when it has none. `managed` says
   * cockpit wrote what is there — an unmanaged one is worth adopting.
   */
  memory?: { hash: string; bytes: number; managed: boolean } | null;
  at: number;
}

/**
 * The machine-scoped control names, exported so the agent's allowlist, the
 * hub's peeks and the dashboard's calls cannot drift apart.
 *
 * - `syncFleetConfig(config: FleetConfig) => FleetSyncReport` — converge and
 *   report. Idempotent; the hub sends it on register and after any change.
 * - `fleetStatus() => FleetSyncReport` — report without changing anything.
 * - `marketplaceCatalog(name: string) => MarketplacePluginInfo[]` — what a
 *   linked marketplace offers, read from its clone on that machine.
 * - `inspectConfig(cwd?: string) => ConfigInspection` — what the machine
 *   really has, and what a session in `cwd` would see. Read-only.
 * - `readSkillFiles(name: string, cwd?: string) => SkillFile[]` — the files
 *   of a skill that is already on the machine, so the hub can adopt it into
 *   the fleet and hand it to every other machine.
 * - `readMemoryFile() => { content: string; hash: string } | null` — the
 *   machine's current user CLAUDE.md, for adoption.
 */
export const FLEET_SYNC = 'syncFleetConfig';
export const FLEET_STATUS = 'fleetStatus';
export const MARKETPLACE_CATALOG = 'marketplaceCatalog';
export const INSPECT_CONFIG = 'inspectConfig';
export const READ_SKILL_FILES = 'readSkillFiles';
export const READ_MEMORY_FILE = 'readMemoryFile';

/** What the composer's `/` menu renders. Derived from the SDK's `SlashCommand`. */
export interface AvailableCommand {
  /** Without the leading slash. */
  name: string;
  description?: string;
  argumentHint?: string;
  type: 'builtin' | 'custom' | 'skill' | 'mcp';
  /** Where it came from, when known — a plugin name, a marketplace. */
  source?: string;
}

/**
 * The SDK's `SlashCommand` carries no kind, so the palette's four-way look is
 * derived: MCP prompts wear their `mcp__` prefix, the init frame's `skills`
 * list names the skills, a namespaced leftover (`plugin:command`) is a plugin
 * command, and what remains is built in.
 */
export const classifyCommand = (
  name: string,
  skills: readonly string[]
): AvailableCommand['type'] => {
  if (name.startsWith('mcp__')) return 'mcp';
  if (skills.includes(name)) return 'skill';
  if (name.includes(':')) return 'custom';
  return 'builtin';
};
