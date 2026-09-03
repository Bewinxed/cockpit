/**
 * The opencode adapter.
 *
 * opencode is server-first: one headless server per machine owns every session,
 * and the npm SDK is a type-safe client over its HTTP + SSE surface. This
 * adapter lazily starts that server and keeps one event-stream subscription
 * PER WORKING DIRECTORY — started the first time a session spawns into that
 * directory, kept alive until the harness disposes — because opencode's event
 * stream is scoped per directory. Sessions are addressed by the server's
 * session id; a spawn either creates one, re-opens a stored id (`resume`), or
 * forks (`resume.fork` / `resume.atMessage`).
 *
 * Translation is one-directional: opencode events become {@link NeutralMessage}
 * frames the dashboard already folds. Events route to their session by session
 * id — including part-carrying events, whose id lives on the part itself
 * (`part.sessionID`). Text streams in via `properties.delta` while `part.text`
 * carries the full accumulated text, which is what the closing frame replays;
 * reasoning streams the same way as a live thinking block and settles as a
 * `thinking` block on the closing frame; tool states emit deduped
 * `tool_use`/`tool_result` frames keyed by call id. A turn's `result` frame
 * closes on `session.idle` or on `session.error` (`aborted` /
 * `error_during_execution`), so a busy session is never left hung.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import {
  type AssistantMessage,
  type Command,
  createOpencodeClient,
  type Event,
  type McpStatus,
  type Message,
  type OpencodeClient,
  type Part,
  type Permission,
  type Project,
  type Provider,
  type Session,
  type TextPart,
  type Todo,
} from "@opencode-ai/sdk";
import type {
  FleetConfig,
  FleetItemState,
  FleetMcpConfig,
  FleetSyncReport,
  HarnessCapabilities,
  HarnessReport,
  McpServerStatus,
  ModelInfo,
  NeutralAssistantBlock,
  NeutralSessionInfo,
  NeutralUserMessage,
  PermissionResult,
  SessionMessage,
  SlashCommand,
  SpawnPayload,
  UserAnswers,
  UserQuestion,
  UserQuestionResult,
} from "@whiffle/core";
import {
  ASK_USER_QUESTION,
  CONTROL_CONTEXT_USAGE,
  CONTROL_GET_TODOS,
  CONTROL_INTERRUPT,
  CONTROL_MCP_RECONNECT,
  CONTROL_MCP_STATUS,
  CONTROL_MCP_TOGGLE,
  CONTROL_SET_MODEL,
  CONTROL_SET_PERMISSION_MODE,
  CONTROL_SUPPORTED_COMMANDS,
  CONTROL_SUPPORTED_MODELS,
  isInjected,
} from "@whiffle/core";
// The protocol subpath, never the `@whiffle/core` barrel: `sessiond.ts` reaches
// for `node:os` and the barrel is imported by the browser bundle (see f2e1c4c).
import { type ProcSpec, sessiondEndpoint } from "@whiffle/core/sessiond";
import type { Harness, HarnessContext, HarnessSession } from "../harness";
import { ensureSessiond, SessiondClient } from "../sessiond-client";
import { resolveBin } from "../tools";
import {
  readJson,
  readSidecar,
  syncMemory,
  syncSkillFiles,
  writeJson,
} from "./fleet-common";
import { fetchDelegateTypes } from "./handoff-shared";

/** opencode's own config files — the machine profile the fleet sync converges. */
const OPENCODE_DIR = join(homedir(), ".config", "opencode");
const OPENCODE_SKILLS = join(OPENCODE_DIR, "skills");
const OPENCODE_MEMORY = join(OPENCODE_DIR, "AGENTS.md");
const OPENCODE_CONFIG = join(OPENCODE_DIR, "opencode.json");
const OPENCODE_SIDECAR = join(OPENCODE_DIR, "whiffle-fleet.json");
const OPENCODE_PLUGINS = join(OPENCODE_DIR, "plugins");
const OPENCODE_PACKAGE = join(OPENCODE_DIR, "package.json");
const OPENCODE_HANDOFF_PLUGIN = join(OPENCODE_PLUGINS, "whiffle-handoff.js");

/**
 * The server's identity under sessiond. One headless server per machine owns
 * every session, so one procId per machine — stable across agent restarts,
 * which is exactly what lets a returning agent find the server it left running
 * instead of starting a second one.
 */
export const OPENCODE_SERVER_PROC_ID = "opencode-server";

/**
 * How long the announce line may take to reach the ring. Our choice: the SDK's
 * own `createOpencodeServer` default is 5 s
 * (`@opencode-ai/sdk/dist/server.js`, `timeout: 5000`); we allow more because
 * the child now boots through a daemon on a cold machine rather than as a
 * direct child, and a false timeout here starts a *second* server.
 */
export const SERVER_ANNOUNCE_TIMEOUT_MS = 30_000;

/**
 * The port announcement, parsed agent-side. sessiond parses nothing — it hands
 * back the child's stdout lines opaque, and the meaning is decided here.
 *
 * The format is the server's own, and the rule below is byte-for-byte the
 * SDK's (`@opencode-ai/sdk/dist/server.js`: `line.startsWith("opencode server
 * listening")` then `/on\s+(https?:\/\/[^\s]+)/`). Verified against the
 * installed binary (opencode 1.18.19), which prints:
 *
 *   Warning: OPENCODE_SERVER_PASSWORD is not set; server is unsecured.
 *   opencode server listening on http://127.0.0.1:43663
 *
 * — hence a per-line scan rather than a read of the first line.
 */
const SERVER_ANNOUNCEMENT_URL_PATTERN = /on\s+(https?:\/\/[^\s]+)/;

export const parseServerAnnouncement = (line: string): string | undefined => {
  if (!line.startsWith("opencode server listening")) {
    return undefined;
  }
  return line.match(SERVER_ANNOUNCEMENT_URL_PATTERN)?.[1];
};

/**
 * Put `opencode serve` under sessiond — or find the one already there — and
 * return the URL it announced.
 *
 * This is the whole of opencode's sessiond story (design §4.2). opencode is
 * server-first: sessions live in the server's own DB, events are re-subscribable
 * per directory, and the adapter is a plain HTTP + SSE client. The only reason
 * an agent restart used to kill live opencode work was that `createOpencode`
 * spawned the server as the *agent's* child. So opencode gets process keeping
 * and nothing else — no neutral-frame ring, because the server is its own event
 * authority and duplicating its storage would be pure cost.
 *
 * If a live server is already held, its spec is NOT re-applied: keeping the
 * running process is the point, and a config change lands on the next machine
 * boot (or a deliberate `sessiond` stop), never by killing sessions.
 */
export const attachOpencodeServer = async (options: {
  sessiond: SessiondClient;
  spec: ProcSpec;
  procId?: string;
  timeoutMs?: number;
}): Promise<string> => {
  const procId = options.procId ?? OPENCODE_SERVER_PROC_ID;
  const timeoutMs = options.timeoutMs ?? SERVER_ANNOUNCE_TIMEOUT_MS;
  const client = options.sessiond;

  // Fresh, not the connect-time welcome: this client is long-lived and the
  // server may have exited since.
  const held = (await client.list()).procs.find(
    (proc) => proc.procId === procId
  );
  if (!held?.alive) {
    await client.spawnProc(procId, options.spec);
  }

  return await new Promise<string>((resolve, reject) => {
    let settled = false;
    const settle = (finish: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      client.unsubscribe(procId);
      finish();
    };
    const timer = setTimeout(
      () =>
        settle(() =>
          reject(
            new Error(
              `[opencode] no "opencode server listening" line from ${procId} within ${timeoutMs}ms`
            )
          )
        ),
      timeoutMs
    );
    // From seq 0: the announce line is printed once, at boot, and a returning
    // agent reads it out of the replay ring long after it was written. That
    // replay IS the port discovery — there is nowhere else the port is written.
    client.subscribe(
      procId,
      {
        line: (event) => {
          const url = parseServerAnnouncement(event.data);
          if (url) {
            settle(() => resolve(url));
          }
        },
        exit: (exitCode) =>
          settle(() =>
            reject(
              new Error(
                `[opencode] serve exited (code ${exitCode}) before announcing a port`
              )
            )
          ),
        // The ring outran the announce line. Honest refusal rather than a guess:
        // the URL is unrecoverable from here, and inventing one would attach the
        // fleet to nothing.
        reset: (nextSeq) =>
          settle(() =>
            reject(
              new Error(
                `[opencode] ${procId}'s replay window lost the port announcement (resumes at ${nextSeq})`
              )
            )
          ),
      },
      0
    );
  });
};

/**
 * The hand-off plugin, in opencode's own plugin format. Reaches the fleet over HTTP.
 *
 * It carries no `permission.ask` hook: verified dead at opencode 1.18.14 — the
 * permission system that runs (`packages/core/src/permission.ts`) publishes
 * events and never triggers plugin hooks, so the hook loaded and was never
 * called. The daemon grants those permissions itself; see {@link autoAllows}.
 *
 * `typeLine` is the same "Available types: 'name' (description); …" sentence
 * claude's and pi's own `delegateTypeLine` build (see handoff.ts), interpolated
 * here at write time rather than read live: this source is written to disk once,
 * at fleet-sync time, and opencode reloads a plugin file from disk rather than
 * calling into this process per session — there is no later hook to refresh
 * it from. A type added or renamed after the last write is not in this string
 * until the next sync; `type`'s own hub-side resolution (`/api/relay/spawn`)
 * still refuses an unknown name with the current list regardless.
 */
const buildHandoffPluginSource = (
  typeLine: string
): string => `import { tool } from "@opencode-ai/plugin";

const ws = process.env.WHIFFLE_HUB_URL ?? "ws://localhost:3456/ws";
const HUB = ws.replace(/^ws/, "http").replace(/\\/ws$/, "");
// No MACHINE here by design: the hub resolves the target machine from the
// session the call names (parent/spawnedBy/target instance row), so the
// plugin never has to know its own machine id and no env has to carry it.

const leaf = (p) => p.split("/").filter(Boolean).pop() ?? p;
const short = (id) => id.slice(0, 8);
const age = (at) => {
  if (!at) return "age unknown";
  const ms = Date.now() - new Date(at).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "age unknown";
  const m = Math.round(ms / 60000);
  if (m < 1) return "active now";
  if (m < 60) return \`active \${m}m ago\`;
  const h = Math.round(m / 60);
  return h < 24 ? \`active \${h}h ago\` : \`active \${Math.round(h / 24)}d ago\`;
};

async function allInstances() {
  const res = await fetch(\`\${HUB}/api/instances\`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(\`the hub answered \${res.status}\`);
  const rows = await res.json();
  const agents = await fetch(\`\${HUB}/api/agents\`, { signal: AbortSignal.timeout(5000) })
    .then((r) => (r.ok ? r.json() : []))
    .catch(() => []);
  const hosts = new Map((agents ?? []).map((a) => [a.machineId, a.hostname]));
  return { rows, hosts };
}

function toPeer(row, hosts) {
  return {
    row,
    name: leaf(row.cwd),
    label: \`\${leaf(row.cwd)}#\${short(row.id)}\`,
    host: hosts.get(row.machineId) ?? row.machineId,
  };
}

async function roster() {
  const { rows, hosts } = await allInstances();
  return rows.filter((r) => r.status === "running" || r.status === "starting").map((r) => toPeer(r, hosts));
}

// fork_of resolves against every row the caller owns, regardless of status —
// stop_delegate's own text promises "delegate again to resume from it", so a
// stopped delegate has to still be forkable. Unlike roster(), not filtered to
// running/starting.
async function resolveForkSource(parentId, target) {
  const { rows, hosts } = await allInstances();
  const mine = rows.filter((r) => r.parentInstanceId === parentId).map((r) => toPeer(r, hosts));
  try {
    return resolve(mine, target);
  } catch (error) {
    let outside = false;
    try {
      resolve(rows.map((r) => toPeer(r, hosts)), target);
      outside = true;
    } catch {
      outside = false;
    }
    if (outside) throw new Error(\`"\${target}" is not your delegate — you can only fork your own delegates.\`);
    throw error;
  }
}

// opencode's own session_id is NOT unique across our rows: a resume reuses
// the same session key (opencode.ts:spawn), so more than one live instance
// can carry it. context carries no id of ours to prefer instead — the
// plugin protocol has no such field — so an ambiguous match resolves to the
// most recently updated live row, the best guess available.
function meOf(peers, context) {
  const matches = peers.filter((p) => p.row.sessionId === context.sessionID);
  if (matches.length <= 1) return matches[0];
  return matches.reduce((newest, p) =>
    new Date(p.row.updatedAt).getTime() > new Date(newest.row.updatedAt).getTime() ? p : newest
  );
}

function resolve(peers, target) {
  const needle = target.trim().toLowerCase().replace(/^@/, "");
  const byId = peers.find((p) => p.row.id === needle);
  if (byId) return byId;
  const idPart = needle.includes("#") ? needle.split("#").pop() : needle;
  if (idPart.length >= 6) {
    const byShort = peers.filter((p) => p.row.id.startsWith(idPart));
    if (byShort.length === 1) return byShort[0];
  }
  const exact = peers.filter((p) => p.name.toLowerCase() === needle);
  if (exact.length === 1) return exact[0];
  const partial = peers.filter((p) => p.name.toLowerCase().includes(needle));
  const candidates = exact.length > 1 ? exact : partial;
  if (candidates.length === 1) return candidates[0];
  if (candidates.length === 0) {
    const known = peers.map((p) => p.label).join(", ") || "none are running";
    throw new Error(\`No running session matches "\${target}". Running now: \${known}.\`);
  }
  throw new Error(\`"\${target}" matches \${candidates.length} sessions — name one by its short id.\`);
}

async function relay(verb, body) {
  const res = await fetch(\`\${HUB}/api/relay/\${verb}\`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    // The hub's own refusal text (e.g. an unknown delegate type's "Available:"
    // list) is the useful part — a bare status code drops exactly what the
    // model needs to retry correctly, so it has to reach the model verbatim.
    const detail = await res.text().catch(() => "");
    throw new Error(\`the hub answered \${res.status}\${detail ? \`: \${detail}\` : ""}\`);
  }
}

export const WhiffleHandoff = async () => {
  return {
    tool: {
      list_sessions: tool({
        description:
          "List the other sessions running on the fleet, with the directory each is working in. " +
          "The listing shows where each session works, not what it is currently doing, how busy it " +
          "is, or how likely it is to pick up a handoff — and recency is not an ownership signal. " +
          "Use it to find a session that already owns the work, or to name a delegate.",
        args: {},
        async execute(_args, context) {
          const peers = await roster();
          if (peers.length === 0) return "No other sessions are running.";
          const me = meOf(peers, context);
          const myId = me ? me.row.id : null;
          return peers
            .map((p) => {
              const tags = [
                p.host,
                p.row.model ?? "default model",
                age(p.row.updatedAt),
                ...(myId && p.row.parentInstanceId === myId ? ["your delegate"] : []),
                ...(me && me.row.parentInstanceId === p.row.id ? ["your parent session"] : []),
              ];
              return \`- \${p.label} — \${p.row.cwd} · \${tags.join(" · ")}\`;
            })
            .join("\\n");
        },
      }),
      handoff: tool({
        description:
          "Send a message to another session on the fleet — to continue one of your own " +
          "delegates, or to brief a session that already owns the work. An idle target wakes " +
          "and works on it immediately; a busy target finishes its current turn first, then " +
          "reads everything queued in one wake turn. Write the message as a brief " +
          "for another engineer who cannot see your conversation. For new standalone work, use delegate instead.",
        args: {
          target: tool.schema.string().describe('The session to hand to: its directory name, e.g. "keeboard", or its id.'),
          message: tool.schema.string().describe("The brief. Include the finding, the paths involved, and the ask."),
          urgent: tool.schema.boolean().optional().describe("Force delivery to one of YOUR delegates: a busy claude delegate reads it mid-turn; other harnesses interrupt their turn to read it now. Only valid toward your own delegates."),
        },
        async execute({ target, message, urgent }, context) {
          const peers = await roster();
          const from = leaf(context.directory);
          const me = meOf(peers, context);
          if (!me) throw new Error("this session is not registered on the fleet yet");
          const myId = me.row.id;
          const body = \`[Hand-off from the \${from} session — another agent, not the user]\\n\\n\${message}\`;
          if (urgent) {
            const mine = peers.filter((p) => p.row.parentInstanceId === myId);
            let peer;
            try {
              peer = resolve(mine, target);
            } catch (error) {
              let outside = false;
              try { resolve(peers, target); outside = true; } catch { outside = false; }
              if (outside) throw new Error(\`"\${target}" is not your delegate — you can only send urgent messages to your own delegates.\`);
              throw error;
            }
            await relay("send", {
              instanceId: peer.row.id,
              message: {
                type: "user",
                message: { role: "user", content: body },
                parent_tool_use_id: null,
                origin: { kind: "peer", from: myId, name: from, fromSession: myId },
                shouldQuery: false,
              },
              urgent: true,
              from: myId,
            });
            return \`Delivered urgently to your delegate \${peer.label}. Its current turn was interrupted to read it now — a claude delegate reads it mid-turn instead.\`;
          }
          const peer = resolve(peers, target);
          await relay("send", {
            instanceId: peer.row.id,
            message: {
              type: "user",
              message: { role: "user", content: body },
              parent_tool_use_id: null,
              origin: { kind: "peer", from: myId, name: from, fromSession: myId },
              shouldQuery: false,
            },
          });
          return \`Handed to \${peer.label} (\${peer.row.cwd} on \${peer.host}). It is queued there and will be picked up when that session finishes its current turn.\`;
        },
      }),
      start_session: tool({
        description:
          "Start a NEW session on the fleet and give it work. It gets its own row in the sidebar, " +
          "its own transcript the user can open and read, and it survives after this turn ends. Use " +
          "it when work belongs in a different directory and no session is running there yet.",
        args: {
          cwd: tool.schema.string().describe("Absolute directory the new session works in."),
          prompt: tool.schema.string().describe("The opening instruction, as a full brief."),
          sideQuest: tool.schema.boolean().optional().describe("A detour from this session's work. Default false."),
          model: tool.schema.string().optional().describe("Model id. Omit to let the server choose."),
        },
        async execute({ cwd, prompt, sideQuest, model }, context) {
          // Fast local refusal for a leaf; the hub's own check stays
          // authoritative. An unregistered session proceeds as before.
          const me = meOf(await roster(), context);
          if (me && me.row.canDelegate === false) throw new Error("This session is a leaf delegate — it was spawned with can_delegate=false and may not delegate or start sessions. Do the work yourself, or handoff to your parent session.");
          const id = crypto.randomUUID();
          await relay("spawn", {
            instanceId: id,
            cwd,
            harness: "opencode",
            ...(model ? { model } : {}),
            ...(sideQuest ? { scratch: { baseCwd: cwd } } : {}),
            // Who asked, by opencode's own session id: the hub resolves it to
            // the live row itself (see /api/relay/spawn), fresher than meOf —
            // and the target machine with it, so no machineId is sent.
            spawnedBy: { sessionKey: context.sessionID },
          });
          await relay("send", {
            instanceId: id,
            message: {
              type: "user",
              message: { role: "user", content: prompt },
              parent_tool_use_id: null,
              origin: { kind: "peer", name: leaf(cwd) },
            },
          });
          return {
            output: \`Started \${leaf(cwd)}\${sideQuest ? " as a side quest" : ""} in \${cwd}. It is in the sidebar now.\`,
            title: leaf(cwd),
            metadata: { instanceId: id },
          };
        },
      }),
      delegate: tool({
        description:
          "Run a task as a SUB-AGENT: a new temporary fleet session nested under this one. It works " +
          "autonomously in its own transcript the user can watch, and reports back to this session " +
          "automatically when each of its turns completes. Guide it or send follow-ups with handoff. " +
          "Prefer this over start_session when the work is a delegation that must report back, and " +
          "over handoff for new standalone work, even in another repository (set cwd there). To " +
          "continue a prior delegate's conversation instead of starting fresh, set fork_of. Prefer " +
          "'type' over raw harness/model where a fleet delegate type fits — it routes by what the " +
          "work needs.",
        args: {
          prompt: tool.schema.string().describe("The full brief. The delegate cannot see this conversation."),
          type: tool.schema.string().optional().describe("A named fleet delegate type. Resolved hub-side; sets harness/model/effort/skills for you. An explicit harness/model/skills below still overrides it. Type definitions are snapshotted when the fleet last synced this plugin — edits made in the dashboard since then are not reflected here, but still resolve hub-side." + ${JSON.stringify(typeLine)}),
          harness: tool.schema.string().optional().describe("Which runtime runs the delegate: one of 'claude', 'opencode', 'pi'. 'opencode' with model 'opencode-go/deepseek-v4-pro' delegates to DeepSeek. Default claude. Overrides the type's harness."),
          model: tool.schema.string().optional().describe("Model id for the harness, e.g. opencode-go/deepseek-v4-flash. Omit for the harness default, or for the type's own model. Overrides the type's model."),
          cwd: tool.schema.string().optional().describe("Absolute directory the delegate works in. Defaults to this session's directory."),
          skills: tool.schema.array(tool.schema.string()).optional().describe("Skill names to load natively into the delegate session. Each skill is invoked via the harness's own slash-command mechanism before the prompt — the same as if the user typed /skill-name in that session. Works cross-harness. Overrides the type's skills."),
          fork_of: tool.schema.string().optional().describe("Fork an earlier delegate: pass the instanceId this tool returned for it. The new delegate starts with the full conversation of that prior delegate — the source is untouched. Works best on the SAME model, where it also reuses the prompt cache; a different model still works but re-ingests the transcript at full cost."),
          can_delegate: tool.schema.boolean().optional().describe("Let the delegate spawn delegates and sessions of its own. Default false: a delegate is a leaf and does the work itself, which keeps the tree one level deep and every report visible here. A type marked 'may delegate by default' flips that default; an explicit value here wins either way. Set true only for an orchestrator-style delegate that must fan out."),
        },
        async execute({ prompt, type, harness, model, cwd, skills, fork_of, can_delegate }, context) {
          const peers = await roster();
          const me = meOf(peers, context);
          if (!me) throw new Error("this session is not registered on the fleet yet");
          // Fast local refusal for a leaf; the hub's own check stays authoritative.
          if (me.row.canDelegate === false) throw new Error("This session is a leaf delegate — it was spawned with can_delegate=false and may not delegate or start sessions. Do the work yourself, or handoff to your parent session.");
          const parentId = me.row.id;
          const id = crypto.randomUUID();
          const workdir = cwd ?? context.directory;

          let resume;
          let modelNote = "";
          if (fork_of) {
            const source = await resolveForkSource(parentId, fork_of);
            if (!source.row.sessionId) {
              throw new Error(\`Your delegate \${source.label} has no session yet to fork — it never started, or hasn't emitted one. Delegate fresh instead of forking it.\`);
            }
            // A fork resumes the source's own stored transcript; that
            // transcript belongs to one harness, so the spawn has to land on
            // the same one.
            const sourceHarness = source.row.harness ?? undefined;
            if (harness && sourceHarness && harness !== sourceHarness) {
              throw new Error(\`cannot fork a \${sourceHarness} delegate into \${harness} — transcripts don't transfer across harnesses.\`);
            }
            harness = harness ?? sourceHarness;
            resume = { sessionKey: source.row.sessionId, fork: true };
            if (source.row.model && model && source.row.model !== model) {
              modelNote = \` Forked from a \${source.row.model} delegate onto \${model} — the conversation carries over, but the prompt cache does not; the transcript re-ingests at full cost.\`;
            }
          }

          await relay("spawn", {
            instanceId: id,
            cwd: workdir,
            // Resolution stays hub-side (see /api/relay/spawn): this plugin
            // only passes the name through.
            ...(type ? { type } : {}),
            ...(harness ? { harness } : {}),
            ...(model ? { model } : {}),
            ...(skills?.length ? { skills } : {}),
            ...(resume ? { resume } : {}),
            scratch: { baseCwd: workdir },
            parent: { instanceId: parentId },
            // The hub re-resolves the requester from this and corrects
            // parent if meOf picked a stale row for the same session key.
            spawnedBy: { sessionKey: context.sessionID },
            // Left out when unsaid so the hub can fill it from the type's own
            // default before it falls back to a leaf.
            ...(can_delegate === undefined ? {} : { canDelegate: can_delegate }),
          });
          await relay("send", {
            instanceId: id,
            message: {
              type: "user",
              message: { role: "user", content: prompt },
              parent_tool_use_id: null,
              origin: { kind: "peer", from: parentId, name: leaf(context.directory), fromSession: parentId },
            },
          });
          return {
            output: \`Delegated to \${harness ?? "claude"} session \${leaf(workdir)}#\${short(id)}.\${resume ? " It starts with the full conversation of the forked delegate." : ""}\${modelNote} It runs as a temporary session nested under this one; its report arrives here automatically when each of its turns completes. Guide it or send follow-ups with handoff("\${id}", ...).\`,
            title: \`\${leaf(workdir)}#\${short(id)}\`,
            metadata: { delegateInstanceId: id },
          };
        },
      }),
      stop_delegate: tool({
        description:
          "Stop one of YOUR delegates (a session you spawned with delegate). Only your own delegates " +
          "can be stopped. The transcript survives.",
        args: {
          target: tool.schema.string().describe('The delegate to stop: its directory name, e.g. "keeboard", or its id.'),
        },
        async execute({ target }, context) {
          const peers = await roster();
          const me = meOf(peers, context);
          if (!me) throw new Error("this session is not registered on the fleet yet");
          const myId = me.row.id;
          const mine = peers.filter((p) => p.row.parentInstanceId === myId);
          let peer;
          try {
            peer = resolve(mine, target);
          } catch (error) {
            let outside = false;
            try { resolve(peers, target); outside = true; } catch { outside = false; }
            if (outside) throw new Error(\`"\${target}" is not your delegate — you can only stop or interrupt your own delegates.\`);
            throw error;
          }
          await relay("stop", { instanceId: peer.row.id, from: myId });
          return \`Stopped your delegate \${peer.label}. Its transcript is preserved; delegate again to resume from it.\`;
        },
      }),
      interrupt_delegate: tool({
        description:
          "Interrupt one of YOUR delegates mid-turn without ending it — the fleet's pause. It keeps " +
          "its state; resume it with handoff.",
        args: {
          target: tool.schema.string().describe('The delegate to interrupt: its directory name, e.g. "keeboard", or its id.'),
        },
        async execute({ target }, context) {
          const peers = await roster();
          const me = meOf(peers, context);
          if (!me) throw new Error("this session is not registered on the fleet yet");
          const myId = me.row.id;
          const mine = peers.filter((p) => p.row.parentInstanceId === myId);
          let peer;
          try {
            peer = resolve(mine, target);
          } catch (error) {
            let outside = false;
            try { resolve(peers, target); outside = true; } catch { outside = false; }
            if (outside) throw new Error(\`"\${target}" is not your delegate — you can only stop or interrupt your own delegates.\`);
            throw error;
          }
          await relay("interrupt", { instanceId: peer.row.id, from: myId });
          return \`Interrupted your delegate \${peer.label}. Its current turn stopped; it keeps all state. Resume or redirect it with handoff("\${peer.row.id}", ...).\`;
        },
      }),
      answer_delegate: tool({
        description:
          "Answer an ask your delegate parked and routed to you. Answers are keyed by the EXACT " +
          "question text and the value is the chosen option label — copy them from the " +
          '"[delegate-ask ...]" message the delegate sent you. Pass deny=true to refuse the ask ' +
          "instead. Leave answers empty and deny false to allow the ask unchanged.",
        args: {
          target: tool.schema.string().describe('The delegate to answer: its directory name, e.g. "keeboard", or its id.'),
          requestId: tool.schema.string().describe("The requestId from the delegate's [delegate-ask ...] line."),
          answers: tool.schema.record(tool.schema.string(), tool.schema.string()).optional().describe("Exact question text to chosen option label, for each question asked."),
          deny: tool.schema.boolean().optional().describe("Refuse the ask instead of answering it. Default false."),
        },
        async execute({ target, requestId, answers, deny }, context) {
          const peers = await roster();
          const me = meOf(peers, context);
          if (!me) throw new Error("this session is not registered on the fleet yet");
          const myId = me.row.id;
          const mine = peers.filter((p) => p.row.parentInstanceId === myId);
          let peer;
          try {
            peer = resolve(mine, target);
          } catch (error) {
            let outside = false;
            try { resolve(peers, target); outside = true; } catch { outside = false; }
            if (outside) throw new Error(\`"\${target}" is not your delegate — you can only answer your own delegates.\`);
            throw error;
          }
          // Answers alone: this side never held the delegate's tool call, so the
          // harness that parked the ask folds them back into it (QUESTION_DISMISSED
          // and settledQuestionResult in @whiffle/core — this plugin ships as source
          // and cannot import them). A denial carries words for the same reason.
          const result = deny
            ? { behavior: "deny", message: "The user dismissed the question without answering it." }
            : { behavior: "allow", ...(answers ? { updatedInput: { answers } } : {}) };
          await relay("answer", { instanceId: peer.row.id, requestId, result, from: myId });
          return deny ? \`Denied your delegate \${peer.label}'s ask.\` : \`Answered your delegate \${peer.label}'s ask.\`;
        },
      }),
      send_to_user: tool({
        description:
          "Display a message directly to the user (delivered to their Telegram). Use this for " +
          "progress updates, partial results, or content the user must see exactly as written " +
          "before the task finishes.",
        args: {
          message: tool.schema.string().describe("The text to show the user, exactly as it should read."),
        },
        async execute({ message }, context) {
          const me = meOf(await roster(), context);
          if (!me) throw new Error("this session is not registered on the fleet yet");
          await relay("message", { machineId: me.row.machineId, instanceId: me.row.id, text: message });
          return "Sent to the user — it lands in their Telegram when the hub has a bridge, and is dropped otherwise.";
        },
      }),
      note_for_user: tool({
        description:
          "Record a note for the user about a concern they raised, saying what you actually did " +
          "about it. Use this after you have acted on something the user pushed back on: which " +
          "file you fixed, what you ran, what you found. The note is shown to the user, so write " +
          "what changed, not that you understood.",
        args: {
          note: tool.schema.string().describe("What you actually did about it, in a sentence or two. Ten characters minimum."),
        },
        async execute({ note }, context) {
          const me = meOf(await roster(), context);
          if (!me) throw new Error("this session is not registered on the fleet yet");
          // Session-scoped, with no id: the caller is never told which rule fired, so the hub
          // settles everything outstanding for this session from the note alone.
          const res = await fetch(\`\${HUB}/api/rules/ack\`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ instanceId: me.row.id, note }),
            signal: AbortSignal.timeout(5000),
          });
          // A refusal comes back as the hub's own bare sentence; it says the useful thing better
          // than anything this side could invent, so pass it through.
          if (res.status === 400) return await res.text();
          if (!res.ok) throw new Error(\`the hub answered \${res.status}\`);
          return "Recorded. The user sees this note in their dashboard.";
        },
      }),
    },
  };
};
`;

/**
 * Whether a parked permission should be auto-allowed by the daemon itself.
 *
 * A question always routes — the parent session, or the user, answers it. Only
 * `acceptEdits` is left to the caller: granting edits alone needs the
 * permission's own type, which this decision does not see.
 */
export function autoAllows(
  permissionMode: string | undefined,
  kind: "question" | "tool"
): boolean {
  if (kind === "question") {
    return false;
  }
  return permissionMode === "bypassPermissions";
}

/** opencode's own name for the tool a question rides on. */
const QUESTION_TOOL = "question";

/**
 * What a question part is written down as. opencode calls the tool `question`;
 * the rest of the fleet calls it {@link ASK_USER_QUESTION}, and the renderer
 * keys off that name, so the rename happens here rather than in the dashboard.
 */
const toolNameOf = (tool: string): string =>
  tool === QUESTION_TOOL ? ASK_USER_QUESTION : tool;

/** opencode's question shape, which says `multiple` where the fleet says `multiSelect`. */
const questionsOf = (raw: unknown): UserQuestion[] | null => {
  if (!Array.isArray(raw)) {
    return null;
  }
  const questions: UserQuestion[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      return null;
    }
    const q = item as {
      question?: unknown;
      header?: unknown;
      options?: unknown;
      multiple?: unknown;
    };
    if (typeof q.question !== "string" || !Array.isArray(q.options)) {
      return null;
    }
    questions.push({
      question: q.question,
      header: typeof q.header === "string" ? q.header : q.question,
      options: q.options as UserQuestion["options"],
      multiSelect: q.multiple === true,
    });
  }
  return questions;
};

/**
 * How a question ended, read off the part opencode already keeps: the asked
 * questions live in `state.input`, and the reader's choices in
 * `state.metadata.answers` as one label array per question, in the order they
 * were asked.
 *
 * Taking it from the part rather than from the `question.*` events is what
 * makes every route agree. The part completes whether the answer came through
 * whiffle, through opencode's own TUI, or from any other client on the server —
 * and because opencode stores it, a reloaded transcript replays it too. Events
 * would have covered only the live case, and only the routes we thought of.
 *
 * `null` for any part that is not a question, which is every other tool.
 */
function questionResultOf(part: {
  tool: string;
  state: { status: string; input?: unknown; metadata?: unknown };
}): UserQuestionResult | null {
  if (part.tool !== QUESTION_TOOL) {
    return null;
  }
  const questions = questionsOf(
    (part.state.input as { questions?: unknown } | undefined)?.questions
  );
  if (!questions) {
    return null;
  }
  const raw = (part.state.metadata as { answers?: unknown } | undefined)
    ?.answers;
  // A question that completed carrying no answers is one the reader walked away
  // from; it is not an answered question with an empty map, and saying so is the
  // whole reason the outcome is a union.
  if (!Array.isArray(raw)) {
    return { outcome: "dismissed", questions };
  }
  const answers: UserAnswers = {};
  questions.forEach((question, i) => {
    const picked = Array.isArray(raw[i]) ? (raw[i] as string[]) : [];
    // opencode answers uniformly in arrays. The array is kept only where the
    // question allowed several — a lone choice stored as a one-element array
    // would draw as a list of one.
    answers[question.question] = question.multiSelect
      ? picked
      : (picked[0] ?? "");
  });
  return { outcome: "answered", questions, answers };
}

/** A fleet MCP definition, in opencode's `opencode.json` `mcp` shape. */
const toOpencodeMcp = (
  config: FleetMcpConfig
): {
  type: "local" | "remote";
  command?: string[];
  url?: string;
  environment?: Record<string, string>;
  headers?: Record<string, string>;
} => {
  if ("url" in config) {
    return {
      type: "remote",
      url: config.url,
      ...(config.headers ? { headers: config.headers } : {}),
    };
  }
  return {
    type: "local",
    command: [config.command, ...(config.args ?? [])],
    ...(config.env ? { environment: config.env } : {}),
  };
};

/** Merges the fleet's servers into `opencode.json`, preserving every other key. */
const syncOpencodeMcp = async (
  desired: { name: string; config: FleetMcpConfig; enabled: boolean }[],
  managed: string[],
  report: Record<string, FleetItemState>
): Promise<string[]> => {
  const wanted = desired.filter((server) => server.enabled);
  const stored =
    (await readJson<Record<string, unknown>>(OPENCODE_CONFIG)) ?? {};
  const mcp = (stored.mcp as Record<string, unknown> | undefined) ?? {};

  for (const server of wanted) {
    mcp[server.name] = toOpencodeMcp(server.config);
    report[server.name] = { state: "applied" };
  }
  const names = wanted.map((server) => server.name);
  for (const name of managed) {
    if (names.includes(name)) {
      continue;
    }
    delete mcp[name];
    report[name] = { state: "removed" };
  }

  await writeJson(OPENCODE_CONFIG, { ...stored, mcp });
  return names;
};

export const OPENCODE_CAPABILITIES: HarnessCapabilities = {
  interrupt: true,
  permissionModes: ["default", "acceptEdits", "plan", "bypassPermissions"],
  setModel: true,
  // No effort scale anywhere in opencode's API: a model is chosen and that is
  // the whole of it. Nothing here emulates one — a slider that moved and
  // changed nothing would be worse than no slider.
  effort: false,
  contextUsage: true,
  supportedModels: true,
  supportedCommands: true,
  mcpStatus: true,
  mcpControl: true,
  listSessions: true,
  getSessionMessages: true,
  renameSession: true,
  deleteSession: true,
  fork: true,
  rewind: true,
  tagSession: true,
  skills: true,
  subagents: true,
  tasks: true,
  compaction: true,
  costUsd: true,
  thinking: true,
  images: true,
  handoff: true,
  hooks: false,
  plugins: true,
  fleet: true,
};

/** The scratch tag sidecar — opencode sessions have no tag, so whiffle keeps its own. */
const TAGS_PATH = join(homedir(), ".config", "opencode", "whiffle-tags.json");

const readTags = async (): Promise<Record<string, string>> => {
  const file = Bun.file(TAGS_PATH);
  if (!(await file.exists())) {
    return {};
  }
  try {
    return (await file.json()) as Record<string, string>;
  } catch {
    return {};
  }
};

const writeTag = async (
  sessionId: string,
  tag: string | null
): Promise<void> => {
  const tags = await readTags();
  if (tag === null) {
    delete tags[sessionId];
  } else {
    tags[sessionId] = tag;
  }
  await Bun.write(TAGS_PATH, JSON.stringify(tags));
};

const sessionToInfo = (session: Session, tag?: string): NeutralSessionInfo => ({
  sessionId: session.id,
  harness: "opencode",
  ...(session.title ? { customTitle: session.title } : {}),
  lastModified: session.time.updated,
  ...(session.time.created ? { createdAt: session.time.created } : {}),
  ...(session.directory ? { cwd: session.directory } : {}),
  ...(tag ? { tag } : {}),
});

/** A provider error's own words, kept whole: name, status and message ride together. */
const errorText = (error: unknown): string => {
  const e = error as
    | { name?: string; data?: { message?: string; statusCode?: number } }
    | undefined;
  const name = e?.name ?? "error";
  const status = e?.data?.statusCode;
  const message = e?.data?.message ?? "opencode session failed";
  return `${name}${status ? ` ${status}` : ""}: ${message}`;
};

/** `provider/model` or a bare model id, into opencode's two-part model reference. */
const splitModel = (
  model: string
): { providerID?: string; modelID?: string } => {
  const slash = model.indexOf("/");
  if (slash < 0) {
    return { modelID: model };
  }
  return { providerID: model.slice(0, slash), modelID: model.slice(slash + 1) };
};

/** `/name rest` → its parts; undefined for anything that is not a slash command. */
const parseCommand = (
  text: string
): { name: string; args: string } | undefined => {
  if (!text.startsWith("/") || text.length === 1) {
    return undefined;
  }
  const rest = text.slice(1);
  const sp = rest.indexOf(" ");
  if (sp === -1) {
    return { name: rest, args: "" };
  }
  return { name: rest.slice(0, sp), args: rest.slice(sp + 1) };
};

/** A message's final content, keyed by part id in arrival order, for its closing frame. */
interface PendingMessage {
  parts: Map<string, { kind: "text" | "thinking"; text: string }>;
}

/**
 * The live thinking stream, in the partial-event shape the dashboard's stream
 * reader already folds — the same events the claude adapter forwards from the
 * SDK verbatim. `NeutralStreamMessage` names only the text delta the adapters
 * emitted until now, so these three are typed here and widened once at the sink
 * rather than sent loosely.
 */
interface ThinkingStreamFrame {
  event:
    | {
        type: "content_block_start";
        content_block: { type: "thinking"; thinking: string };
      }
    | {
        type: "content_block_delta";
        delta: { type: "thinking_delta"; thinking: string };
      }
    | { type: "content_block_stop" };
  session_id?: string;
  type: "stream_event";
}

/** A child (subagent) session's own pipeline state, kept apart from the parent's. */
interface ChildState {
  pending: Map<string, PendingMessage>;
  roles: Map<string, "user" | "assistant">;
  toolsEmitted: Map<string, "called" | "resolved">;
}

const EMPTY_TOKENS = {
  input: 0,
  output: 0,
  reasoning: 0,
  cache: { read: 0, write: 0 },
};

export class OpencodeSession implements HarnessSession {
  readonly harness = "opencode" as const;
  sessionId: string | null;
  readonly #ctx: HarnessContext;
  readonly #client: OpencodeClient;
  readonly #directory: string;
  #model: string | undefined;
  #lastTokens = EMPTY_TOKENS;
  readonly #roles = new Map<string, "user" | "assistant">();
  readonly #costs = new Map<string, number>();
  #costBase = 0;
  readonly #pending = new Map<string, PendingMessage>();
  /** The reasoning part whose live block is open, so it is closed exactly once. */
  #openThinking: string | null = null;
  readonly #toolsEmitted = new Map<string, "called" | "resolved">();
  #busy = false;
  /** The last provider-retry note surfaced, so a repeating retry says it once. */
  #lastRetryNote = "";
  #turnOpen = false;
  readonly #queue: {
    parts: unknown[];
    model?: { providerID?: string; modelID?: string };
  }[] = [];
  #permissionMode: string | undefined;
  #providersCache: Promise<{ providers?: Provider[] } | undefined> | undefined;
  #commandNames: Promise<Set<string>> | null = null;
  readonly #questions = new Set<string>();
  readonly #questionData = new Map<string, UserQuestion[]>();
  readonly #childInfo = new Map<string, { agent?: string; title?: string }>();
  readonly #childState = new Map<string, ChildState>();
  readonly #boundCalls = new Set<string>();
  readonly #serverUrl: string;
  readonly #registerChild: (childId: string, callID: string) => void;
  readonly #onRelease: () => void;
  readonly instanceId: string;

  constructor(
    instanceId: string,
    ctx: HarnessContext,
    client: OpencodeClient,
    sessionId: string,
    directory: string,
    model: string | undefined,
    permissionMode: string | undefined,
    serverUrl: string,
    registerChild: (childId: string, callID: string) => void,
    onRelease: () => void
  ) {
    this.instanceId = instanceId;
    this.#ctx = ctx;
    this.#client = client;
    this.sessionId = sessionId;
    this.#directory = directory;
    this.#model = model;
    this.#permissionMode = permissionMode;
    this.#serverUrl = serverUrl;
    this.#registerChild = registerChild;
    this.#onRelease = onRelease;
  }

  /** Routes one opencode event into neutral frames for this session. */
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: the opencode event union's per-type routing switch; not refactored in this pass
  handle(event: Event): void {
    const p = event.properties as Record<string, unknown> & {
      sessionID?: string;
    };
    const sid = p.sessionID;
    if (sid !== undefined && sid !== this.sessionId) {
      return;
    }

    // `message.part.delta` is a real event the SDK's generated union omits, so
    // switch on the string form rather than the nominal `Event` union.
    const type = event.type as string;
    switch (type) {
      case "message.updated": {
        const { info } = p as { info?: Message };
        if (!info) {
          return;
        }
        this.#roles.set(info.id, info.role);
        if (info.role === "assistant") {
          this.#costs.set(info.id, info.cost);
          this.#lastTokens = info.tokens;
        }
        break;
      }
      case "message.part.updated": {
        const { part } = p as { part?: Part };
        if (!part) {
          return;
        }
        const { messageID } = part;
        if (
          messageID !== undefined &&
          part.sessionID !== undefined &&
          part.sessionID !== this.sessionId
        ) {
          return;
        }
        this.#part(part);
        break;
      }
      case "message.part.delta": {
        const props = event.properties as unknown as {
          sessionID?: string;
          messageID?: string;
          partID?: string;
          field?: string;
          delta?: string;
        };
        if (props.field !== "text") {
          break;
        }
        if (this.#roles.get(props.messageID ?? "") !== "assistant") {
          break;
        }
        if (!props.delta) {
          break;
        }
        this.#closeThinking();
        this.#ctx.frame({
          type: "stream_event",
          session_id: this.sessionId ?? undefined,
          event: {
            type: "content_block_delta",
            delta: { type: "text_delta", text: props.delta },
          },
        });
        // `message.part.delta` is the streaming chunks, and the full stream they
        // carry is the authoritative text — `part.text` on `message.part.updated`
        // is capped at 4000 chars, and a part longer than the transport's buffer
        // never lands at all. The accumulated deltas are the truth either way.
        if (props.partID) {
          const pending = this.#pendingOf(props.messageID ?? "");
          const existing = pending.parts.get(props.partID);
          const acc =
            (existing?.kind === "text" ? existing.text : "") + props.delta;
          pending.parts.set(props.partID, { kind: "text", text: acc });
        }
        break;
      }
      case "permission.updated": {
        if (sid !== this.sessionId) {
          return;
        }
        const permission = event.properties as Permission;
        const input = (permission.metadata ?? {}) as Record<string, unknown>;
        const kind = permission.type === "question" ? "question" : "tool";
        // opencode's permission system publishes events and never consults a
        // plugin, so the daemon is where a session's mode is enforced.
        if (
          autoAllows(this.#permissionMode, kind) ||
          (this.#permissionMode === "acceptEdits" && permission.type === "edit")
        ) {
          this.#replyPermission(permission.id, "once");
          break;
        }
        this.#ctx.permission({
          requestId: permission.id,
          toolName:
            permission.type === "question"
              ? "AskUserQuestion"
              : permission.type,
          input:
            kind === "question"
              ? { questions: input.questions ?? [input] }
              : input,
          requestKind: kind,
        });
        break;
      }
      case "permission.asked": {
        if (sid !== this.sessionId) {
          return;
        }
        const asked = event.properties as unknown as {
          id: string;
          sessionID: string;
          permission: string;
          metadata?: Record<string, unknown>;
        };
        if (
          autoAllows(this.#permissionMode, "tool") ||
          (this.#permissionMode === "acceptEdits" &&
            asked.permission === "edit")
        ) {
          this.#replyPermission(asked.id, "once");
          break;
        }
        this.#ctx.permission({
          requestId: asked.id,
          toolName: asked.permission,
          input: asked.metadata ?? {},
          requestKind: "tool",
        });
        break;
      }
      // opencode carries two generations of this event with byte-identical
      // payloads, and the server's own spec publishes both. Naming only the
      // older one is a silent failure waiting for the day it stops firing:
      // questions would simply stop appearing, with nothing raised anywhere.
      case "question.asked":
      case "question.v2.asked": {
        if (sid !== this.sessionId) {
          return;
        }
        const asked = event.properties as unknown as {
          id: string;
          sessionID: string;
          questions: {
            question: string;
            header: string;
            options: { label: string; description: string }[];
            multiple?: boolean;
          }[];
        };
        this.#questions.add(asked.id);
        const questions: UserQuestion[] = asked.questions.map((q) => ({
          question: q.question,
          header: q.header,
          options: q.options,
          multiSelect: q.multiple === true,
        }));
        this.#questionData.set(asked.id, questions);
        // Only the parked permission is raised here. The transcript row comes
        // from the `question` tool part this ask rides on, which opencode emits
        // and stores like any other tool — writing a second row from this event
        // would draw the same question twice, under two different ids.
        this.#ctx.permission({
          requestId: asked.id,
          toolName: ASK_USER_QUESTION,
          input: { questions },
          requestKind: "question",
        });
        break;
      }
      // A question can also be settled where whiffle cannot see it — in
      // opencode's own TUI, or by any other client on the same server. Without
      // these the `tool_use` the ask emitted never closes, and the row sits on
      // "waiting for your answer" for the rest of the session while the model
      // has long since moved on.
      //
      // `#questionData` is the guard against answering twice: `resolvePermission`
      // clears the entry before it replies, so the echo of whiffle's own reply
      // finds nothing here and falls through. Only a settlement whiffle did not
      // make still has its questions on hand.
      // A settlement whiffle did not make — opencode's own TUI, or any other
      // client on the server. The transcript needs nothing here, because the
      // `question` tool part completes on every route and carries the answers
      // with it; this only lets go of the parked request so a later
      // `resolvePermission` for the same id cannot reply to a closed question.
      case "question.replied":
      case "question.v2.replied":
      case "question.rejected":
      case "question.v2.rejected": {
        if (sid !== this.sessionId) {
          return;
        }
        const settled = event.properties as unknown as { requestID: string };
        this.#questions.delete(settled.requestID);
        this.#questionData.delete(settled.requestID);
        break;
      }
      case "session.status": {
        if (sid !== this.sessionId) {
          return;
        }
        const status = p.status as {
          type?: string;
          message?: string;
          next?: number;
        };
        // A retrying turn is still a turn in flight — and the provider's own
        // words go straight to the transcript. A quota notice that only ever
        // lived in this event once hid as a silent hang for an hour.
        this.#busy = status.type === "busy" || status.type === "retry";
        // biome-ignore lint/suspicious/noUnnecessaryConditions: #busy was just assigned a live boolean; biome's field-declaration inference doesn't see it
        if (this.#busy) {
          this.#turnOpen = true;
        }
        if (status.type === "retry" && status.message) {
          const wait = status.next
            ? ` — next attempt in ${Math.max(0, Math.round((status.next - Date.now()) / 1000))}s`
            : "";
          const note = `${status.message}${wait}`;
          if (note !== this.#lastRetryNote) {
            this.#lastRetryNote = note;
            this.#ctx.frame({
              type: "system",
              subtype: "provider_retry",
              session_id: this.sessionId ?? undefined,
              content: note,
            });
          }
        }
        this.#ctx.busy(this.#busy);
        break;
      }
      case "session.idle": {
        if (sid !== this.sessionId) {
          return;
        }
        this.#ctx.busy(false);
        this.#busy = false;
        this.#flushResult();
        // Everything queued during the turn is delivered now as one wake turn.
        this.#drainQueue();
        break;
      }
      case "session.error": {
        if (sid !== undefined && sid !== this.sessionId) {
          return;
        }
        const error = p.error as { name?: string; data?: { message?: string } };
        this.#ctx.busy(false);
        // biome-ignore lint/suspicious/noUnnecessaryConditions: `as` is an unchecked cast; p.error can still be undefined at runtime even though the cast type says otherwise
        if (error?.name === "MessageAbortedError") {
          this.#flushResult({ subtype: "aborted", is_error: false });
        } else {
          this.#flushResult({
            subtype: "error_during_execution",
            is_error: true,
            errors: [errorText(error)],
          });
        }
        break;
      }
      default:
        break;
    }
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: routes every opencode part kind (text, tool, reasoning, …) into neutral frames; not refactored in this pass
  #part(part: Part): void {
    const role = this.#roles.get(part.messageID);
    switch (part.type) {
      case "text": {
        if (part.synthetic || part.ignored) {
          return;
        }
        // Captured even before the message's role is known — a part can arrive
        // ahead of its `message.updated`, and dropping it is what left a
        // delegate's report empty. `#flushResult` filters by role at flush time,
        // when the role is settled. `part.text` is capped at 4000 chars (and a
        // part longer than the transport's buffer never lands at all), so the
        // `message.part.delta` text already accumulated here is the truth.
        this.#closeThinking();
        const pending = this.#pendingOf(part.messageID);
        const existing = pending.parts.get(part.id);
        const acc = existing?.kind === "text" ? existing.text : "";
        const text = acc.length >= part.text.length ? acc : part.text;
        pending.parts.set(part.id, { kind: "text", text });
        break;
      }
      case "reasoning": {
        if (role !== "assistant") {
          return;
        }
        const pending = this.#pendingOf(part.messageID);
        const stored = pending.parts.get(part.id);
        // A reasoning update carries the whole text again, so what streams is
        // what grew past the last one. A rewrite that does not extend it says
        // nothing rather than replaying the block.
        const sent = stored?.kind === "thinking" ? stored.text : "";
        if (this.#openThinking !== part.id) {
          this.#closeThinking();
          this.#openThinking = part.id;
          this.#thinkingFrame({
            type: "content_block_start",
            content_block: { type: "thinking", thinking: "" },
          });
        }
        if (part.text.length > sent.length && part.text.startsWith(sent)) {
          this.#thinkingFrame({
            type: "content_block_delta",
            delta: {
              type: "thinking_delta",
              thinking: part.text.slice(sent.length),
            },
          });
        }
        pending.parts.set(part.id, { kind: "thinking", text: part.text });
        break;
      }
      case "tool": {
        this.#closeThinking();
        // A `task` tool spawns a child session; its metadata carries the child id
        // (verified: `state.metadata.sessionId`), so bind it to this callID.
        if (part.tool === "task") {
          const meta = part.state as {
            metadata?: { sessionId?: string };
            input?: { subagent_type?: string };
            title?: string;
          };
          if (typeof meta.metadata?.sessionId === "string") {
            this.#bindChild(
              part.callID,
              meta.metadata.sessionId,
              meta.input?.subagent_type,
              meta.title
            );
          }
        }
        const { status } = part.state;
        const emitted = this.#toolsEmitted.get(part.callID);
        // One tool_use per call, on the first part that carries usable input.
        if (
          !emitted &&
          (status === "running" || status === "completed" || status === "error")
        ) {
          this.#ctx.frame({
            type: "assistant",
            message: {
              content: [
                {
                  type: "tool_use",
                  id: part.callID,
                  name: toolNameOf(part.tool),
                  input: part.state.input,
                },
              ],
            },
          });
          this.#toolsEmitted.set(part.callID, "called");
        }
        // One tool_result per call, once it completes or errors.
        if (
          (status === "completed" || status === "error") &&
          emitted !== "resolved"
        ) {
          const output =
            status === "completed" ? part.state.output : part.state.error;
          const metadata =
            status === "completed"
              ? (part.state as { metadata?: Record<string, unknown> }).metadata
              : undefined;
          const structuredContent =
            metadata && Object.keys(metadata).length > 0 ? metadata : undefined;
          const questionResult = questionResultOf(part);
          this.#ctx.frame({
            type: "user",
            message: {
              role: "user",
              content: [
                {
                  type: "tool_result",
                  tool_use_id: part.callID,
                  content: output,
                  is_error: status === "error",
                  ...(structuredContent ? { structuredContent } : {}),
                  ...(questionResult ? { questionResult } : {}),
                },
              ],
            },
          });
          this.#toolsEmitted.set(part.callID, "resolved");
        }
        break;
      }
      default:
        break;
    }
  }

  #pendingOf(messageID: string): PendingMessage {
    let pending = this.#pending.get(messageID);
    if (!pending) {
      pending = { parts: new Map() };
      this.#pending.set(messageID, pending);
    }
    return pending;
  }

  /**
   * Ships one live thinking frame. The neutral stream union carries the
   * thinking events itself (harness.ts widened 2026-08-16), so this is a plain
   * frame — no widening, the literals stay checked end to end.
   */
  #thinkingFrame(event: ThinkingStreamFrame["event"]): void {
    const frame: ThinkingStreamFrame = {
      type: "stream_event",
      session_id: this.sessionId ?? undefined,
      event,
    };
    this.#ctx.frame(frame);
  }

  /** Closes the live thinking block, if one is open. */
  #closeThinking(): void {
    if (this.#openThinking === null) {
      return;
    }
    this.#openThinking = null;
    this.#thinkingFrame({ type: "content_block_stop" });
  }

  /** A `session.created` event named a child; remember its info for the bind. */
  handleChildCreated(
    childId: string,
    agent: string | undefined,
    title: string | undefined
  ): void {
    this.#childInfo.set(childId, { agent, title });
  }

  /** Links a task call to its child session; emits the branch-opening frame once. */
  #bindChild(
    callID: string,
    childId: string,
    fallbackAgent: string | undefined,
    fallbackTitle: string | undefined
  ): void {
    if (this.#boundCalls.has(callID)) {
      return;
    }
    this.#boundCalls.add(callID);
    const info = this.#childInfo.get(childId);
    this.#ctx.frame({
      type: "system",
      subtype: "task_started",
      session_id: this.sessionId ?? undefined,
      tool_use_id: callID,
      task_id: childId,
      subagent_type: info?.agent ?? fallbackAgent ?? "subagent",
      description: info?.title ?? fallbackTitle ?? "",
    });
    this.#registerChild(childId, callID);
  }

  /** Routes a child-session event through the parent's frame stream under `callID`. */
  handleChild(event: Event, callID: string): void {
    const state = this.#childStateOf(callID);
    const type = event.type as string;
    const p = event.properties as Record<string, unknown>;
    switch (type) {
      case "message.updated": {
        const { info } = p as { info?: Message };
        if (!info) {
          return;
        }
        state.roles.set(info.id, info.role);
        break;
      }
      case "message.part.updated": {
        const { part } = p as { part?: Part };
        if (!part) {
          return;
        }
        this.#partChild(state, part, undefined, callID);
        break;
      }
      case "message.part.delta": {
        const props = event.properties as unknown as {
          field?: string;
          messageID?: string;
          delta?: string;
        };
        if (props.field !== "text") {
          break;
        }
        if (state.roles.get(props.messageID ?? "") !== "assistant") {
          break;
        }
        if (!props.delta) {
          break;
        }
        this.#ctx.frame({
          type: "stream_event",
          session_id: this.sessionId ?? undefined,
          parent_tool_use_id: callID,
          event: {
            type: "content_block_delta",
            delta: { type: "text_delta", text: props.delta },
          },
        });
        break;
      }
      case "session.idle":
      case "session.error":
        // The child's turn ended; replay its accumulated blocks as its branch's
        // final frames. No result frame — the parent's task tool_result closes it.
        this.#flushChild(state, callID);
        break;
      default:
        break;
    }
  }

  #childStateOf(callID: string): ChildState {
    let state = this.#childState.get(callID);
    if (!state) {
      state = { roles: new Map(), pending: new Map(), toolsEmitted: new Map() };
      this.#childState.set(callID, state);
    }
    return state;
  }

  #pendingChild(state: ChildState, messageID: string): PendingMessage {
    let pending = state.pending.get(messageID);
    if (!pending) {
      pending = { parts: new Map() };
      state.pending.set(messageID, pending);
    }
    return pending;
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: routes a subagent's part kinds into the parent session's neutral frames; not refactored in this pass
  #partChild(
    state: ChildState,
    part: Part,
    delta: string | undefined,
    callID: string
  ): void {
    const role = state.roles.get(part.messageID);
    switch (part.type) {
      case "text": {
        if (part.synthetic || part.ignored) {
          return;
        }
        if (role !== "assistant") {
          return;
        }
        if (delta) {
          this.#ctx.frame({
            type: "stream_event",
            session_id: this.sessionId ?? undefined,
            parent_tool_use_id: callID,
            event: {
              type: "content_block_delta",
              delta: { type: "text_delta", text: delta },
            },
          });
        }
        this.#pendingChild(state, part.messageID).parts.set(part.id, {
          kind: "text",
          text: part.text,
        });
        break;
      }
      case "reasoning":
        if (role !== "assistant") {
          return;
        }
        this.#pendingChild(state, part.messageID).parts.set(part.id, {
          kind: "thinking",
          text: part.text,
        });
        break;
      case "tool": {
        const { status } = part.state;
        const emitted = state.toolsEmitted.get(part.callID);
        if (
          !emitted &&
          (status === "running" || status === "completed" || status === "error")
        ) {
          this.#ctx.frame({
            type: "assistant",
            parent_tool_use_id: callID,
            message: {
              content: [
                {
                  type: "tool_use",
                  id: part.callID,
                  name: part.tool,
                  input: part.state.input,
                },
              ],
            },
          });
          state.toolsEmitted.set(part.callID, "called");
        }
        if (
          (status === "completed" || status === "error") &&
          emitted !== "resolved"
        ) {
          this.#ctx.frame({
            type: "user",
            parent_tool_use_id: callID,
            message: {
              role: "user",
              content: [
                {
                  type: "tool_result",
                  tool_use_id: part.callID,
                  content:
                    status === "completed"
                      ? part.state.output
                      : part.state.error,
                  is_error: status === "error",
                },
              ],
            },
          });
          state.toolsEmitted.set(part.callID, "resolved");
        }
        break;
      }
      default:
        break;
    }
  }

  #flushChild(state: ChildState, callID: string): void {
    for (const [messageID, pending] of state.pending) {
      if (state.roles.get(messageID) !== "assistant") {
        continue;
      }
      const blocks: NeutralAssistantBlock[] = [];
      for (const part of pending.parts.values()) {
        if (part.kind === "text") {
          blocks.push({ type: "text", text: part.text });
        } else {
          blocks.push({ type: "thinking", thinking: part.text });
        }
      }
      if (blocks.length === 0) {
        continue;
      }
      this.#ctx.frame({
        type: "assistant",
        uuid: messageID,
        parent_tool_use_id: callID,
        message: { content: blocks },
      });
    }
    state.pending.clear();
  }

  /**
   * Closes the turn: replays each assistant message's accumulated blocks as a
   * final frame, then a result. `result` overrides the default `success` result
   * for the abort/error paths, which also close a turn.
   */
  #flushResult(result?: {
    subtype: string;
    is_error: boolean;
    errors?: string[];
  }): void {
    // The live trace ends before the settled blocks replace it.
    this.#closeThinking();
    for (const [messageID, pending] of this.#pending) {
      if (this.#roles.get(messageID) !== "assistant") {
        continue;
      }
      const blocks: NeutralAssistantBlock[] = [];
      for (const part of pending.parts.values()) {
        if (part.kind === "text") {
          blocks.push({ type: "text", text: part.text });
        } else {
          blocks.push({ type: "thinking", thinking: part.text });
        }
      }
      if (blocks.length === 0) {
        continue;
      }
      this.#ctx.frame({
        type: "assistant",
        uuid: messageID,
        message: { content: blocks },
      });
    }
    const flushed = [...this.#pending.keys()];
    this.#pending.clear();
    // A ghost idle (e.g. the idle that trails an abort) has no open turn and must
    // not emit a result frame; only a real turn close or an explicit abort/error
    // does. Assistant-block replay above is unaffected.
    // biome-ignore lint/suspicious/noUnnecessaryConditions: #turnOpen is reassigned elsewhere in the class; biome's per-method inference doesn't see that
    if (!(this.#turnOpen || result)) {
      return;
    }
    const turnCost = [...this.#costs.values()].reduce((a, b) => a + b, 0);
    this.#ctx.frame({
      type: "result",
      subtype: result?.subtype ?? "success",
      is_error: result?.is_error ?? false,
      ...(result?.errors ? { errors: result.errors } : {}),
      total_cost_usd: this.#costBase + turnCost,
      cache: {
        read: this.#lastTokens.cache.read,
        write: this.#lastTokens.cache.write,
      },
    });
    this.#costBase += turnCost;
    this.#costs.clear();
    for (const messageID of flushed) {
      this.#roles.delete(messageID);
    }
    for (const [callID, state] of this.#toolsEmitted) {
      if (state === "resolved") {
        this.#toolsEmitted.delete(callID);
      }
    }
    this.#turnOpen = false;
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: routes a send between urgent-abort, hand-back-queue, and command/prompt branches; not refactored in this pass
  send(
    message: NeutralUserMessage,
    extras: {
      attachments?: { name: string; content: string }[];
      images?: { mediaType: string; data: string }[];
      urgent?: boolean;
    }
  ): void {
    const { content } = message.message;
    let text =
      typeof content === "string"
        ? content
        : content
            .filter(
              (block): block is { type: "text"; text: string } =>
                block.type === "text"
            )
            .map((block) => block.text)
            .join("\n");

    // Urgent delivery: start a turn NOW, busy or not. Busy: interrupt the
    // running turn first, with a factual note. Idle: prompt directly — urgent
    // to an idle session degrading to a silent append left delegates holding
    // unread briefs forever, since drained appends never wake a session.
    const urgent = Boolean(extras.urgent);
    if (urgent && this.#busy) {
      text = `[Urgent — your previous turn was interrupted to deliver this]\n\n${text}`;
    }

    const parts: (
      | { type: "text"; text: string }
      | { type: "file"; mime: string; filename: string; url: string }
    )[] = [];
    if (text) {
      parts.push({ type: "text", text });
    }
    for (const image of extras.images ?? []) {
      parts.push({
        type: "file",
        mime: image.mediaType,
        filename: "image",
        url: `data:${image.mediaType};base64,${image.data}`,
      });
    }
    for (const attachment of extras.attachments ?? []) {
      parts.push({
        type: "text",
        text: `\n\n<pasted-text name="${attachment.name}">\n${attachment.content}\n</pasted-text>`,
      });
    }

    const model = this.#model ? splitModel(this.#model) : undefined;

    if (urgent) {
      // biome-ignore lint/complexity/noVoid: fire-and-forget: send() itself is not awaited by its callers
      void this.#client.session
        .abort({
          // biome-ignore lint/style/noNonNullAssertion: invariant: sessionId is set once in the constructor and never nulled; the interface types it nullable for other harnesses
          path: { id: this.sessionId! },
          query: { directory: this.#directory },
        })
        // biome-ignore lint/suspicious/noEmptyBlockStatements: the abort's own failure is not actionable; the prompt below runs regardless
        .catch(() => {})
        .then(() => this.#prompt(parts, model));
    } else if ((message as { shouldQuery?: boolean }).shouldQuery === false) {
      // Delivery rule (matches the claude adapter): a peer message reaching an
      // IDLE session is the turn that wakes it. Silent appends left sessions
      // holding unread briefs forever — delivered work must run. While busy it
      // queues, and the idle drain delivers everything as ONE wake turn.
      // biome-ignore lint/suspicious/noUnnecessaryConditions: #busy is reassigned elsewhere in the class; biome's per-method inference doesn't see that
      if (this.#busy) {
        this.#queue.push({ parts, ...(model ? { model } : {}) });
      } else {
        this.#ctx.busy(true);
        this.#prompt(parts, model);
      }
    } else {
      this.#ctx.busy(true);
      const command = parseCommand(text);
      if (command) {
        // biome-ignore lint/complexity/noVoid: fire-and-forget: send() itself is not awaited by its callers
        void this.#commandOrPrompt(command.name, command.args, parts, model);
      } else {
        this.#prompt(parts, model);
      }
    }

    // A hand-off is queued rather than asked, so the server emits nothing until
    // it is drained. Echoed as the frame the dashboard reads, the moment it lands.
    if (isInjected(message.origin)) {
      this.#ctx.frame({ ...message, session_id: this.sessionId ?? undefined });
    }
  }

  /** Starts one prompt turn with the given parts and optional model. */
  #prompt(
    parts: unknown[],
    model?: { providerID?: string; modelID?: string }
  ): void {
    this.#turnOpen = true;
    // biome-ignore lint/complexity/noVoid: fire-and-forget: #prompt itself is not awaited by its callers
    void this.#client.session
      .promptAsync({
        // biome-ignore lint/style/noNonNullAssertion: invariant: sessionId is set once in the constructor and never nulled; the interface types it nullable for other harnesses
        path: { id: this.sessionId! },
        query: { directory: this.#directory },
        body: {
          parts: parts as never,
          // A bare model id (no provider) is left to opencode's default; never send `providerID: ''`.
          ...(model?.providerID && model.modelID
            ? {
                model: { providerID: model.providerID, modelID: model.modelID },
              }
            : {}),
          ...(this.#permissionMode === "plan" ? { agent: "plan" } : {}),
        },
      })
      .then((res) => {
        if (res.error) {
          this.#ctx.failed(new Error(errorText(res.error)));
        }
      });
  }

  /**
   * Delivers everything queued while the session was busy as ONE wake turn:
   * all queued parts, in arrival order, in a single prompt. One turn instead
   * of a turn per message keeps a burst of reports from becoming a burst of
   * junk "Acknowledged" turns; a prompt instead of a silent append keeps
   * delivered work from sitting unread forever.
   */
  #drainQueue(): void {
    if (this.#queue.length === 0) {
      return;
    }
    const queued = this.#queue.splice(0);
    const parts = queued.flatMap((next) => next.parts);
    const model = queued.find((next) => next.model)?.model;
    this.#ctx.busy(true);
    this.#prompt(parts, model);
  }

  /** The command names this session can answer, fetched once and cached. */
  #commandNamesOf(): Promise<Set<string>> {
    if (!this.#commandNames) {
      this.#commandNames = this.#client.command
        .list({ query: { directory: this.#directory } })
        .then(
          (res) =>
            new Set(
              (res.error ? [] : (res.data as Command[])).map(
                (command) => command.name
              )
            )
        );
    }
    return this.#commandNames;
  }

  /** A `/name` turned: run it as a command, or fall back to a plain prompt. */
  async #commandOrPrompt(
    name: string,
    args: string,
    parts: unknown[],
    model?: { providerID?: string; modelID?: string }
  ): Promise<void> {
    const names = await this.#commandNamesOf();
    if (!names.has(name)) {
      this.#prompt(parts, model);
      return;
    }
    this.#turnOpen = true;
    // biome-ignore lint/complexity/noVoid: fire-and-forget: #commandOrPrompt itself is not awaited by its callers
    void this.#client.session
      .command({
        // biome-ignore lint/style/noNonNullAssertion: invariant: sessionId is set once in the constructor and never nulled; the interface types it nullable for other harnesses
        path: { id: this.sessionId! },
        query: { directory: this.#directory },
        body: {
          command: name,
          arguments: args,
          ...(this.#model ? { model: this.#model } : {}),
          ...(this.#permissionMode === "plan" ? { agent: "plan" } : {}),
        },
      })
      .then((res) => {
        if (res.error) {
          this.#ctx.failed(new Error(errorText(res.error)));
        }
      });
  }

  /** The current model's context window, from a lazily-cached provider list. */
  async #contextLimit(): Promise<number> {
    if (!this.#model) {
      return 200_000;
    }
    this.#providersCache ??= this.#client.config
      .providers({ query: { directory: this.#directory } })
      .then((result) =>
        result.error ? undefined : (result.data as { providers?: Provider[] })
      );
    const data = await this.#providersCache;
    const providers = data?.providers ?? [];
    const ref = splitModel(this.#model);
    for (const provider of providers) {
      if (ref.providerID && provider.id !== ref.providerID) {
        continue;
      }
      const model = ref.modelID ? provider.models?.[ref.modelID] : undefined;
      if (model) {
        return model.limit.context;
      }
    }
    return 200_000;
  }

  async control(method: string, args: unknown[]): Promise<unknown> {
    switch (method) {
      case CONTROL_INTERRUPT:
        await this.#client.session.abort({
          // biome-ignore lint/style/noNonNullAssertion: invariant: sessionId is set once in the constructor and never nulled; the interface types it nullable for other harnesses
          path: { id: this.sessionId! },
          query: { directory: this.#directory },
        });
        return undefined;
      case CONTROL_SET_MODEL:
        this.#model = args[0] as string;
        return undefined;
      case CONTROL_SET_PERMISSION_MODE:
        this.#permissionMode = args[0] as string;
        return undefined;
      case CONTROL_CONTEXT_USAGE: {
        const tokens = this.#lastTokens;
        const total =
          tokens.input +
          tokens.output +
          tokens.reasoning +
          tokens.cache.read +
          tokens.cache.write;
        const maxTokens = await this.#contextLimit();
        return {
          totalTokens: total,
          maxTokens,
          percentage: Math.min(100, Math.round((total / maxTokens) * 100)),
          categories: [
            {
              name: "Input",
              tokens: tokens.input,
              color: "var(--flexoki-blue)",
            },
            {
              name: "Output",
              tokens: tokens.output,
              color: "var(--flexoki-green)",
            },
            {
              name: "Reasoning",
              tokens: tokens.reasoning,
              color: "var(--flexoki-orange)",
            },
          ],
        };
      }
      case CONTROL_SUPPORTED_MODELS: {
        const result = await this.#client.config.providers({
          query: { directory: this.#directory },
        });
        if (result.error) {
          return [];
        }
        const providers =
          (result.data as { providers?: Provider[] }).providers ?? [];
        const models: ModelInfo[] = [];
        for (const provider of providers) {
          for (const [modelID, model] of Object.entries(
            provider.models ?? {}
          )) {
            models.push({
              value: `${provider.id}/${modelID}`,
              displayName: `${model.name ?? modelID}`,
            });
          }
        }
        return models;
      }
      case CONTROL_SUPPORTED_COMMANDS: {
        const result = await this.#client.command.list({
          query: { directory: this.#directory },
        });
        if (result.error) {
          return [];
        }
        return (result.data as Command[]).map(
          (command): SlashCommand => ({
            name: command.name,
            description: command.description ?? "",
            argumentHint: "",
          })
        );
      }
      case CONTROL_MCP_STATUS: {
        const result = await this.#client.mcp.status({
          query: { directory: this.#directory },
        });
        if (result.error) {
          return [];
        }
        const statuses = (result.data ?? {}) as Record<string, McpStatus>;
        return Object.entries(statuses).map(
          ([name, status]): McpServerStatus => ({
            name,
            status: typeof status === "string" ? status : "connected",
          })
        );
      }
      case CONTROL_MCP_RECONNECT:
        await this.#client.mcp.connect({
          path: { name: args[0] as string },
          query: { directory: this.#directory },
        });
        return undefined;
      case CONTROL_MCP_TOGGLE: {
        const name = args[0] as string;
        const enabled = args[1] as boolean;
        if (enabled) {
          await this.#client.mcp.connect({
            path: { name },
            query: { directory: this.#directory },
          });
        } else {
          await this.#client.mcp.disconnect({
            path: { name },
            query: { directory: this.#directory },
          });
        }
        return undefined;
      }
      default:
        // An unsupported control verb is a silent no-op, never a user-facing
        // failure: the hub may send a reload this harness has no verb for, and a
        // session must not answer that with an error the reader sees.
        console.warn(`[opencode] no control verb ${method} — ignored`);
        return undefined;
    }
  }

  resolvePermission(requestId: string, result: PermissionResult): void {
    if (this.#questions.has(requestId)) {
      this.#questions.delete(requestId);
      const questions = this.#questionData.get(requestId) ?? [];
      this.#questionData.delete(requestId);
      // Nothing is framed on either branch: replying settles the `question`
      // tool part, and that part is what writes the row. Framing here as well
      // drew the answer twice, once under the request id and once under the
      // tool's own call id.
      if (result.behavior === "deny") {
        // biome-ignore lint/complexity/noVoid: fire-and-forget: resolvePermission itself is not awaited by its callers
        void this.#rejectQuestion(requestId);
        return;
      }
      // The reader's choices arrive keyed by question text (QuestionCard builds
      // `UserAnswers` that way); opencode's reply API wants one label array per
      // question, in the order `question.asked` published them — so the join is
      // the question text on both sides.
      const answersByQuestion =
        (result as { updatedInput?: { answers?: UserAnswers } }).updatedInput
          ?.answers ?? {};
      const answers = questions.map((q) => {
        const raw = answersByQuestion[q.question];
        if (Array.isArray(raw)) {
          return raw;
        }
        if (typeof raw === "string") {
          return [raw];
        }
        return [] as string[];
      });
      // biome-ignore lint/complexity/noVoid: fire-and-forget: resolvePermission itself is not awaited by its callers
      void this.#replyQuestion(requestId, answers);
      return;
    }
    let response: "once" | "always" | "reject";
    if (result.behavior === "deny") {
      response = "reject";
    } else if (result.remember) {
      response = "always";
    } else {
      response = "once";
    }
    this.#replyPermission(requestId, response);
  }

  /** The one answer path for a tool permission — the auto-allow shares it. */
  #replyPermission(
    requestId: string,
    response: "once" | "always" | "reject"
  ): void {
    // biome-ignore lint/complexity/noVoid: fire-and-forget: #replyPermission itself is not awaited by its callers
    void this.#client.postSessionIdPermissionsPermissionId({
      // biome-ignore lint/style/noNonNullAssertion: invariant: sessionId is set once in the constructor and never nulled; the interface types it nullable for other harnesses
      path: { id: this.sessionId!, permissionID: requestId },
      query: { directory: this.#directory },
      body: { response },
    });
  }

  #replyQuestion(id: string, answers: string[][]): Promise<void> {
    return (
      fetch(
        `${this.#serverUrl}/question/${id}/reply?directory=${encodeURIComponent(this.#directory)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ answers }),
        }
      )
        .then((res) => {
          if (!res.ok) {
            this.#ctx.failed(
              new Error(`opencode question reply failed: ${res.status}`)
            );
          }
        })
        // biome-ignore lint/suspicious/noEmptyBlockStatements: the fetch's own network failure already left #ctx.failed uncalled; nothing further to report here
        .catch(() => {})
    );
  }

  #rejectQuestion(id: string): Promise<void> {
    return (
      fetch(
        `${this.#serverUrl}/question/${id}/reject?directory=${encodeURIComponent(this.#directory)}`,
        {
          method: "POST",
        }
      )
        .then((res) => {
          if (!res.ok) {
            this.#ctx.failed(
              new Error(`opencode question reject failed: ${res.status}`)
            );
          }
        })
        // biome-ignore lint/suspicious/noEmptyBlockStatements: the fetch's own network failure already left #ctx.failed uncalled; nothing further to report here
        .catch(() => {})
    );
  }

  async interrupt(): Promise<void> {
    await this.#client.session.abort({
      // biome-ignore lint/style/noNonNullAssertion: invariant: sessionId is set once in the constructor and never nulled; the interface types it nullable for other harnesses
      path: { id: this.sessionId! },
      query: { directory: this.#directory },
    });
  }

  async stop(): Promise<void> {
    this.#onRelease();
    await this.#client.session
      .abort({
        // biome-ignore lint/style/noNonNullAssertion: invariant: sessionId is set once in the constructor and never nulled; the interface types it nullable for other harnesses
        path: { id: this.sessionId! },
        query: { directory: this.#directory },
      })
      // biome-ignore lint/suspicious/noEmptyBlockStatements: stop() is tearing down regardless; the abort's own failure is not actionable
      .catch(() => {});
  }

  // biome-ignore lint/suspicious/useAwait: implements Harness.dispose's Promise<void> contract; this session's teardown is synchronous
  async dispose(): Promise<void> {
    this.#onRelease();
  }
}

export class OpencodeHarness implements Harness {
  readonly kind = "opencode" as const;
  readonly capabilities = OPENCODE_CAPABILITIES;
  auth: import("@whiffle/core").AuthState = "authenticated";

  #client: OpencodeClient | null = null;
  /** The URL the sessiond-held server announced; the sessions' `fetch` base. */
  #serverUrl: string | null = null;
  #sessiond: Promise<SessiondClient> | undefined;
  #ready: Promise<OpencodeClient> | null = null;
  // Keyed by instanceId, not opencode's own session id: a resume reuses the
  // same sessionKey (opencode.ts:spawn), so multiple live instances can share
  // one opencode session id, and a map keyed by THAT would silently overwrite
  // an earlier instance's entry with a later one's on every such resume.
  // Event routing, which only has opencode's own id off the wire, falls back
  // to {@link OpencodeHarness.#sessionForSid}.
  readonly #sessions = new Map<string, OpencodeSession>();
  readonly #children = new Map<
    string,
    { parent: OpencodeSession; callID: string }
  >();
  #disposed = false;
  readonly #pumpDirs = new Set<string>();

  async detect(): Promise<HarnessReport> {
    const installed = resolveBin("opencode") !== undefined;
    let version: string | undefined;
    if (installed) {
      const ran = await Bun.$`opencode --version`.quiet().nothrow();
      const said = ran.stdout.toString().trim();
      if (ran.exitCode === 0 && said) {
        version = said;
      }
    }
    return {
      harness: "opencode",
      installed,
      ...(version ? { version } : {}),
      auth: installed ? "authenticated" : "unauthenticated",
      capabilities: OPENCODE_CAPABILITIES,
    };
  }

  /**
   * The machine's one sessiond connection for this harness, dialled lazily.
   * A dropped socket is re-dialled and the SERVER is untouched by that — the
   * property the whole leaf exists for.
   */
  async sessiond(
    // `WHIFFLE_SESSIOND_ENDPOINT` is sessiond's own override
    // (`sessiond/src/main.ts`), honoured here too so a dev run — or a test —
    // points both halves at a scratch socket instead of the real one.
    endpoint: string = process.env.WHIFFLE_SESSIOND_ENDPOINT ??
      sessiondEndpoint()
  ): Promise<SessiondClient> {
    const existing = await this.#sessiond?.catch(() => undefined);
    if (existing && !existing.closed) {
      return existing;
    }
    this.#sessiond = (async () => {
      await ensureSessiond(endpoint);
      return SessiondClient.connect(endpoint);
    })();
    return this.#sessiond;
  }

  #ensure(): Promise<OpencodeClient> {
    if (this.#client) {
      return Promise.resolve(this.#client);
    }
    if (!this.#ready) {
      // A spawn after a dispose is a revival, not a leak: the adapter is a
      // module singleton, the server it attaches to outlived the teardown, and
      // the pumps must be allowed to re-subscribe. Cleared here rather than in
      // `dispose` so an in-flight teardown still stops its own pumps.
      this.#disposed = false;
      this.#ready = (async () => {
        await this.#writePlugin();
        // Ask on everything the dashboard can surface. Questions default to
        // allow and are answered through the session's `question.asked` round
        // trip, so no permission key is set for them here. `webfetch` is the
        // exception: fleet policy is the firecrawl MCP, and a `deny` publishes
        // no permission event at all, so it never reaches {@link autoAllows}.
        const config = {
          permission: { edit: "ask", bash: "ask", webfetch: "deny" },
          // Fleet policy: search is the Exa MCP. `webfetch: 'deny'` above
          // removes the fetch built-in; `websearch` has no permission key,
          // so the tool itself is switched off.
          tools: { websearch: false },
        };
        // Not `createOpencode`: that spawns the server as THIS process's child,
        // so every agent restart took the machine's opencode sessions with it.
        // The server goes under sessiond instead and we attach as a client —
        // the same client the bundled pair would have handed us.
        const sessiond = await this.sessiond();
        const url = await attachOpencodeServer({
          sessiond,
          spec: {
            // The SDK builds this exact command line
            // (`@opencode-ai/sdk/dist/server.js`); we build it here because the
            // spawn is sessiond's now, not `cross-spawn`'s.
            command: resolveBin("opencode") ?? "opencode",
            args: ["serve", "--hostname=127.0.0.1", "--port=0"],
            env: { OPENCODE_CONFIG_CONTENT: JSON.stringify(config) },
          },
        });
        this.#serverUrl = url;
        const client = createOpencodeClient({ baseUrl: url });
        this.#client = client;
        return client;
      })().catch((error) => {
        this.#ready = null;
        throw error;
      });
    }
    return this.#ready;
  }

  /** Writes the hand-off plugin into opencode's global plugin dir before the server boots. */
  async #writePlugin(): Promise<void> {
    await Bun.$`mkdir -p ${OPENCODE_PLUGINS}`.quiet();
    const pkg =
      (await readJson<{ dependencies?: Record<string, string> }>(
        OPENCODE_PACKAGE
      )) ?? {};
    if (!pkg.dependencies?.["@opencode-ai/plugin"]) {
      await writeJson(OPENCODE_PACKAGE, {
        ...pkg,
        dependencies: {
          ...(pkg.dependencies ?? {}),
          "@opencode-ai/plugin": "1.18.18",
        },
      });
    }
    // Same "Available types" sentence claude's and pi's own `delegateTypeLine`
    // build — see `buildHandoffPluginSource`'s own comment for why this is
    // read once here rather than kept live.
    const types = await fetchDelegateTypes();
    const typeLine = types.length
      ? ` Available types: ${types.map((type) => `'${type.name}' (${type.description}${type.canDelegate ? "; may delegate by default" : ""})`).join("; ")}.`
      : "";
    const source = buildHandoffPluginSource(typeLine);
    const existing = Bun.file(OPENCODE_HANDOFF_PLUGIN);
    const current = (await existing.exists()) ? await existing.text() : "";
    if (current !== source) {
      await Bun.write(OPENCODE_HANDOFF_PLUGIN, source);
    }
  }

  /** Starts the directory-scoped subscription for a directory, once per unique cwd. */
  #ensurePump(client: OpencodeClient, directory: string): void {
    // biome-ignore lint/suspicious/noUnnecessaryConditions: #disposed is set true by dispose(), a different method biome's per-method inference doesn't see
    if (this.#disposed || this.#pumpDirs.has(directory)) {
      return;
    }
    this.#pumpDirs.add(directory);
    // biome-ignore lint/complexity/noVoid: fire-and-forget pump loop; #ensurePump must not block waiting for it
    // biome-ignore lint/suspicious/noEmptyBlockStatements: reconnection is handled inside the loop; a final rejection here is not actionable
    void this.#pumpDirectory(client, directory).catch(() => {});
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: routes every subscribed event to its owning session or child; not refactored in this pass
  async #pumpDirectory(
    client: OpencodeClient,
    directory: string
  ): Promise<void> {
    let delay = 1000;
    // biome-ignore lint/suspicious/noUnnecessaryConditions: #disposed is set true by dispose(), a different method biome's per-method inference doesn't see
    while (!this.#disposed) {
      try {
        // biome-ignore lint/performance/noAwaitInLoops: reconnects the SSE stream after a drop; must retry sequentially with backoff
        const { stream } = await client.event.subscribe({
          query: { directory },
        });
        for await (const event of stream) {
          delay = 1000;
          if (event.type === "session.created") {
            this.#routeChildCreated(event);
            continue;
          }
          const sid = this.#eventSession(event);
          const session = sid ? this.#sessionForSid(sid) : undefined;
          if (session) {
            session.handle(event);
          } else if (sid) {
            const child = this.#children.get(sid);
            if (child) {
              child.parent.handleChild(event, child.callID);
            }
          }
        }
      } catch {
        // The stream ended or dropped; reconnect below unless disposed.
      }
      // biome-ignore lint/suspicious/noUnnecessaryConditions: #disposed is set true by dispose(), a different method biome's per-method inference doesn't see
      if (this.#disposed) {
        break;
      }
      await Bun.sleep(delay);
      delay = Math.min(delay * 2, 30_000);
    }
  }

  /** A child session was created; hand its info to the named parent for binding. */
  #routeChildCreated(event: Event): void {
    const props = event.properties as unknown as {
      sessionID?: string;
      info?: { id?: string; parentID?: string; agent?: string; title?: string };
    };
    const childId = props.info?.id ?? props.sessionID;
    const parentId = props.info?.parentID;
    if (!(childId && parentId)) {
      return;
    }
    const parent = this.#sessionForSid(parentId);
    if (parent) {
      parent.handleChildCreated(childId, props.info?.agent, props.info?.title);
    }
  }

  #eventSession(event: Event): string | undefined {
    const p = event.properties as Record<string, unknown> & {
      sessionID?: string;
      info?: { sessionID?: string };
      part?: { sessionID?: string };
    };
    return p.sessionID ?? p.info?.sessionID ?? p.part?.sessionID;
  }

  /**
   * Resolves opencode's own session id, off an event, back to one of ours.
   * `#sessions` is keyed by instanceId now, so this is the lookup that used to
   * be free with a `sessionId`-keyed map. When more than one of our sessions
   * shares that opencode id (the resume collision the rekey exists for), the
   * most recently spawned one wins — Map iteration is insertion order, so the
   * last match is the newest — on the theory that a live event is more likely
   * meant for whichever instance most recently took that session over.
   */
  #sessionForSid(sid: string): OpencodeSession | undefined {
    let found: OpencodeSession | undefined;
    for (const session of this.#sessions.values()) {
      if (session.sessionId === sid) {
        found = session;
      }
    }
    return found;
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: creates/resumes/forks a session across three branches, then wires the session up; not refactored in this pass
  async spawn(
    spec: SpawnPayload,
    ctx: HarnessContext
  ): Promise<HarnessSession> {
    const client = await this.#ensure();
    this.#ensurePump(client, ctx.cwd);
    let sessionId: string;

    if (spec.resume?.fork) {
      const fork = await client.session.fork({
        path: { id: spec.resume.sessionKey },
        query: { directory: ctx.cwd },
        body: spec.resume.atMessage ? { messageID: spec.resume.atMessage } : {},
      });
      if (fork.error || !fork.data) {
        throw new Error("opencode could not fork the session");
      }
      sessionId = (fork.data as Session).id;
    } else if (spec.resume) {
      // Re-open: opencode sessions persist in the server's DB, so resuming is
      // just addressing the id again — but only an id the server actually
      // holds. A key nobody holds is refused loudly here rather than addressed
      // blindly: a blind address becomes a live handle whose every prompt
      // fails, plus an init frame that cements the bogus key into the hub row
      // (noteInstanceSession trusts it), poisoning the session permanently.
      const held = await client.session.get({
        path: { id: spec.resume.sessionKey },
        query: { directory: ctx.cwd },
      });
      if (held.error || !held.data) {
        throw new Error(
          `opencode has no session ${spec.resume.sessionKey} to resume in ${ctx.cwd}`
        );
      }
      sessionId = spec.resume.sessionKey;
      if (spec.resume.atMessage) {
        const reverted = await client.session.revert({
          path: { id: spec.resume.sessionKey },
          query: { directory: ctx.cwd },
          body: { messageID: spec.resume.atMessage },
        });
        if (reverted.error) {
          throw new Error("opencode could not rewind to that message");
        }
      }
    } else {
      const created = await client.session.create({
        query: { directory: ctx.cwd },
      });
      if (created.error || !created.data) {
        throw new Error("opencode could not create the session");
      }
      sessionId = (created.data as Session).id;
    }

    let session!: OpencodeSession;
    session = new OpencodeSession(
      ctx.instanceId,
      ctx,
      client,
      sessionId,
      ctx.cwd,
      spec.model,
      spec.permissionMode,
      // biome-ignore lint/style/noNonNullAssertion: invariant: #ensure() above resolves only once attachOpencodeServer has set #serverUrl
      this.#serverUrl!,
      (childId, callID) =>
        this.#children.set(childId, { parent: session, callID }),
      () => {
        this.#sessions.delete(ctx.instanceId);
        for (const [childId, entry] of this.#children) {
          if (entry.parent === session) {
            this.#children.delete(childId);
          }
        }
      }
    );
    this.#sessions.set(ctx.instanceId, session);
    ctx.session(sessionId);
    // The init frame the dashboard reads the model / cwd / commands off.
    ctx.frame({
      type: "system",
      subtype: "init",
      session_id: sessionId,
      cwd: ctx.cwd,
      ...(spec.model ? { model: spec.model } : {}),
      ...(spec.permissionMode ? { permissionMode: spec.permissionMode } : {}),
    });

    // Load skills natively: send each as a /command before the first prompt.
    // The opencode server queues them in order, so skills load before work.
    if (spec.skills?.length) {
      for (const skill of spec.skills) {
        // biome-ignore lint/performance/noAwaitInLoops: skills must load in order, before the first prompt
        await client.session.command({
          path: { id: sessionId },
          query: { directory: ctx.cwd },
          body: { command: skill, arguments: "" },
        });
      }
    }

    return session;
  }

  async listSessions(dir?: string): Promise<NeutralSessionInfo[]> {
    if (resolveBin("opencode") === undefined) {
      return [];
    }
    const client = await this.#ensure();
    const tags = await readTags();

    if (dir) {
      const result = await client.session.list({ query: { directory: dir } });
      if (result.error || !result.data) {
        return [];
      }
      // Subagent children do not belong in the rail.
      return (result.data as Session[])
        .filter((session) => !session.parentID)
        .map((session) => sessionToInfo(session, tags[session.id]));
    }

    // Machine catalog: every session on the server, merged and deduped by id.
    // Asked per project worktree AND once unscoped: a scoped list only matches
    // its exact directory, so a session living directly under a parent dir
    // (e.g. /home/o with only / as a project worktree) appears in neither —
    // verified live at 1.18.19, where `?directory=/` answers []. The unscoped
    // list covers those; the per-worktree queries stay so an opencode whose
    // unscoped list is project-scoped still reports the whole machine.
    const projects = await client.project.list();
    if (projects.error || !projects.data) {
      return [];
    }
    const lists = await Promise.all([
      client.session
        .list()
        .then((res) => (res.error || !res.data ? [] : (res.data as Session[])))
        .catch(() => [] as Session[]),
      ...(projects.data as Project[]).map((project) =>
        client.session
          .list({ query: { directory: project.worktree } })
          .then((res) =>
            res.error || !res.data ? [] : (res.data as Session[])
          )
          .catch(() => [] as Session[])
      ),
    ]);
    const seen = new Set<string>();
    const merged: Session[] = [];
    for (const list of lists) {
      for (const session of list) {
        if (session.parentID || seen.has(session.id)) {
          continue;
        }
        seen.add(session.id);
        merged.push(session);
      }
    }
    return merged.map((session) => sessionToInfo(session, tags[session.id]));
  }

  async getSessionInfo(
    sessionKey: string,
    dir?: string
  ): Promise<NeutralSessionInfo | undefined> {
    if (resolveBin("opencode") === undefined) {
      return undefined;
    }
    const client = await this.#ensure();
    const result = await client.session.get({
      path: { id: sessionKey },
      query: { directory: dir },
    });
    if (result.error || !result.data) {
      return undefined;
    }
    const tags = await readTags();
    return sessionToInfo(result.data as Session, tags[sessionKey]);
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: reads the session, its revert point, and its subagent children in one pass; not refactored in this pass
  async getSessionMessages(
    sessionKey: string,
    dir?: string
  ): Promise<SessionMessage[]> {
    if (resolveBin("opencode") === undefined) {
      return [];
    }
    const client = await this.#ensure();
    const result = await client.session.messages({
      path: { id: sessionKey },
      query: { directory: dir },
    });
    if (result.error || !result.data) {
      return [];
    }
    let rows = result.data as { info: Message; parts: Part[] }[];

    // opencode keeps the full history even after a rewind; reflect the session's
    // `revert` point by dropping it and everything after.
    const sessionRes = await client.session.get({
      path: { id: sessionKey },
      query: { directory: dir },
    });
    const revertID = (sessionRes.data as Session).revert?.messageID;
    if (revertID) {
      const idx = rows.findIndex((row) => row.info.id === revertID);
      if (idx >= 0) {
        rows = rows.slice(0, idx);
      }
    }

    const entries = toTranscript(sessionKey, rows);

    // Subagents: children of this session, linked to their parent's task tool
    // call by the task ToolPart's `state.metadata.sessionId` (verified capture).
    const childrenRes = await client.session.children({
      path: { id: sessionKey },
    });
    if (childrenRes.error || !childrenRes.data) {
      return entries;
    }

    const callByChild = new Map<string, string>();
    for (const row of rows) {
      for (const part of row.parts) {
        if (part.type !== "tool" || part.tool !== "task") {
          continue;
        }
        const childId = (part.state as { metadata?: { sessionId?: string } })
          .metadata?.sessionId;
        if (typeof childId === "string") {
          callByChild.set(childId, part.callID);
        }
      }
    }

    for (const child of childrenRes.data as Session[]) {
      const callID = callByChild.get(child.id);
      if (!callID) {
        continue;
      }
      // biome-ignore lint/performance/noAwaitInLoops: children are appended to the transcript in this order; parallel fetches would reorder subagents
      const childRes = await client.session.messages({
        path: { id: child.id },
        query: { directory: dir },
      });
      if (childRes.error || !childRes.data) {
        continue;
      }
      const childEntries = toTranscript(
        child.id,
        childRes.data as { info: Message; parts: Part[] }[]
      );
      for (const entry of childEntries) {
        entry.parent_tool_use_id = callID;
      }
      entries.push(...childEntries);
    }

    return entries;
  }

  renameSession(
    sessionKey: string,
    title: string,
    dir?: string
  ): Promise<void> {
    if (resolveBin("opencode") === undefined) {
      return Promise.resolve(undefined);
    }
    return this.#ensure()
      .then((client) =>
        client.session.update({
          path: { id: sessionKey },
          query: { directory: dir },
          body: { title },
        })
      )
      .then(() => undefined);
  }

  async tagSession(
    sessionKey: string,
    tag: string | null,
    _dir?: string
  ): Promise<void> {
    await writeTag(sessionKey, tag);
  }

  deleteSession(sessionKey: string, dir?: string): Promise<void> {
    if (resolveBin("opencode") === undefined) {
      return Promise.resolve(undefined);
    }
    return this.#ensure()
      .then((client) =>
        client.session.delete({
          path: { id: sessionKey },
          query: { directory: dir },
        })
      )
      .then(() => undefined);
  }

  async machine(method: string, args: unknown[]): Promise<unknown> {
    switch (method) {
      case CONTROL_GET_TODOS: {
        const client = await this.#ensure();
        const result = await client.session.todo({
          path: { id: args[0] as string },
          ...(args[1] ? { query: { directory: args[1] as string } } : {}),
        });
        if (result.error || !result.data) {
          return [];
        }
        return (result.data as Todo[])
          .filter((todo) => todo.status !== "cancelled")
          .map((todo): import("@whiffle/core").NeutralTask => ({
            id: todo.id,
            subject: todo.content,
            status:
              todo.status === "in_progress" || todo.status === "completed"
                ? todo.status
                : "pending",
            blocks: [],
            blockedBy: [],
          }));
      }
      default:
        return undefined;
    }
  }

  /**
   * Tear down the AGENT SIDE. The server is deliberately left running: it is
   * sessiond's child now, it owns the machine's live sessions, and killing it
   * here would re-create exactly the death this leaf removes. A rebuilt
   * supervisor calls {@link OpencodeHarness.spawn} again, {@link #ensure}
   * re-reads the announced port from the ring, and the per-directory SSE pumps
   * re-subscribe against the same still-running server.
   */
  // biome-ignore lint/suspicious/useAwait: implements Harness.dispose's Promise<void> contract; this teardown is synchronous
  async dispose(): Promise<void> {
    this.#disposed = true;
    this.#pumpDirs.clear();
    // The socket, not the child: a closed sessiond connection is re-dialled by
    // `sessiond()` and the held server never notices.
    // biome-ignore lint/complexity/noVoid: fire-and-forget close; dispose() must not block on the socket teardown
    // biome-ignore lint/suspicious/noEmptyBlockStatements: best-effort close, a failed close here is not actionable
    void this.#sessiond?.then((client) => client.close()).catch(() => {});
    this.#sessiond = undefined;
    this.#client = null;
    this.#serverUrl = null;
    this.#ready = null;
  }

  async syncFleet(config: FleetConfig): Promise<FleetSyncReport> {
    const sidecar = await readSidecar(OPENCODE_SIDECAR);
    const report: FleetSyncReport = {
      mcp: {},
      marketplaces: {},
      plugins: {},
      skills: {},
      at: Date.now(),
    };

    const mcp = await syncOpencodeMcp(
      config.mcp,
      sidecar.mcp ?? [],
      report.mcp
    );
    // Remove the skills/memory the pre-2026-08-14 sync wrote; opencode reads
    // ~/.claude/skills/ and its own memory file, so whiffle no longer owns these.
    if (Object.keys(sidecar.skills).length > 0) {
      // biome-ignore lint/style/noNonNullAssertion: invariant: report.skills is initialized to {} a few lines above; TS drops the narrowing across the earlier await
      await syncSkillFiles(OPENCODE_SKILLS, [], sidecar.skills, report.skills!);
    }
    if (sidecar.memory !== undefined) {
      await syncMemory(OPENCODE_MEMORY, null, sidecar.memory, report);
    }
    await writeJson(OPENCODE_SIDECAR, { mcp });
    return report;
  }

  async fleetStatus(): Promise<FleetSyncReport> {
    const sidecar = await readSidecar(OPENCODE_SIDECAR);
    const report: FleetSyncReport = {
      mcp: {},
      marketplaces: {},
      plugins: {},
      skills: {},
      at: Date.now(),
    };

    const stored =
      (await readJson<{ mcp?: Record<string, unknown> }>(OPENCODE_CONFIG)) ??
      {};
    for (const name of sidecar.mcp ?? []) {
      report.mcp[name] = stored.mcp?.[name]
        ? { state: "applied" }
        : { state: "failed", detail: "not in opencode.json" };
    }
    return report;
  }
}

/** opencode `{info, parts}` → the neutral transcript entries the folder reads. */
/**
 * Exported for its own sake as well as the session's: this is the whole of what
 * a reopened transcript is, so it is the one place a reload's fidelity can be
 * checked against parts a real server stored.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: replays every part kind opencode stores; not refactored in this pass
export function toTranscript(
  sessionKey: string,
  rows: { info: Message; parts: Part[] }[]
): SessionMessage[] {
  const entries: SessionMessage[] = [];
  for (const { info, parts } of rows) {
    if (info.role === "user") {
      const text = parts
        .filter((part): part is TextPart => part.type === "text")
        .map((part) => part.text)
        .join("\n");
      if (text) {
        entries.push({
          type: "user",
          uuid: info.id,
          session_id: sessionKey,
          message: { role: "user", content: text },
          parent_tool_use_id: null,
          parent_agent_id: null,
        });
      }
      continue;
    }

    // An assistant message: its text/reasoning become one entry; its tool parts
    // become a tool_use entry, and each tool result a user entry.
    const blocks: NeutralAssistantBlock[] = [];
    for (const part of parts) {
      if (part.type === "text" && !part.synthetic && !part.ignored) {
        blocks.push({ type: "text", text: part.text });
      } else if (part.type === "reasoning") {
        blocks.push({ type: "thinking", thinking: part.text });
      } else if (part.type === "tool") {
        blocks.push({
          type: "tool_use",
          id: part.callID,
          name: toolNameOf(part.tool),
          input: part.state.input,
        });
      }
    }
    if (blocks.length) {
      entries.push({
        type: "assistant",
        uuid: info.id,
        session_id: sessionKey,
        message: {
          role: "assistant",
          model: `${(info as AssistantMessage).providerID}/${(info as AssistantMessage).modelID}`,
          content: blocks,
        },
        parent_tool_use_id: null,
        parent_agent_id: null,
      });
    }
    for (const part of parts) {
      if (part.type !== "tool") {
        continue;
      }
      if (part.state.status === "completed" || part.state.status === "error") {
        const output =
          part.state.status === "completed"
            ? part.state.output
            : part.state.error;
        const metadata =
          part.state.status === "completed"
            ? (part.state as { metadata?: Record<string, unknown> }).metadata
            : undefined;
        const structuredContent =
          metadata && Object.keys(metadata).length > 0 ? metadata : undefined;
        entries.push({
          type: "user",
          uuid: `${info.id}:${part.id}`,
          session_id: sessionKey,
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: part.callID,
                content: output,
                is_error: part.state.status === "error",
                ...(structuredContent ? { structuredContent } : {}),
                // Replay says what the live stream said: opencode keeps the
                // asked questions and the chosen answers on the part itself, so
                // a reopened transcript draws the answered card rather than
                // losing the exchange.
                ...(questionResultOf(part)
                  ? { questionResult: questionResultOf(part) }
                  : {}),
              },
            ],
          },
          parent_tool_use_id: null,
          parent_agent_id: null,
        });
      }
    }
  }
  return entries;
}

export const opencodeHarness: Harness = new OpencodeHarness();
