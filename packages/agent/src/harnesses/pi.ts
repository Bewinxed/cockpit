/**
 * The pi adapter (badlogic / earendil-works).
 *
 * pi is an in-process TypeScript SDK: `createAgentSession` returns an
 * `AgentSession` whose `subscribe()` streams the events the TUI would render.
 * There is no permission system — pi deliberately has none — so the permission
 * surface is empty and the dashboard hides it (capabilities). Sessions are
 * append-only JSONL trees on disk; `SessionManager` re-opens and forks them.
 *
 * The translation maps pi's stream (text/thinking deltas, tool calls, tool
 * results, turns) onto the same neutral frames the claude and opencode
 * adapters produce, so the dashboard renders pi with full parity everywhere
 * the harness has a feature to map.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import type { Model } from "@earendil-works/pi-ai/compat";
import {
  type AgentSession,
  type AgentSessionEvent,
  createAgentSession,
  defineTool,
  ModelRuntime,
  SessionManager,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type {
  AuthState,
  FleetConfig,
  FleetSyncReport,
  HarnessCapabilities,
  HarnessReport,
  NeutralAssistantBlock,
  NeutralSessionInfo,
  NeutralUserMessage,
  PermissionResult,
  SendPayload,
  SessionMessage,
  SpawnPayload,
} from "@whiffle/core";
import {
  CONTROL_CONTEXT_USAGE,
  CONTROL_INTERRUPT,
  CONTROL_SET_MODEL,
} from "@whiffle/core";
import { Type } from "typebox";
import type { Harness, HarnessContext, HarnessSession } from "../harness";
import { resolveBin } from "../tools";
import {
  hashText,
  readSidecar,
  syncMemory,
  syncSkillFiles,
  writeJson,
} from "./fleet-common";
import {
  fetchDelegateTypes,
  type HandoffDeps,
  handoffActions,
  SPAWNING_TOOLS,
} from "./handoff-shared";

/** pi's own config files — the machine profile the fleet sync converges. */
const PI_DIR = join(homedir(), ".pi", "agent");
const PI_SKILLS = join(PI_DIR, "skills");
const PI_MEMORY = join(PI_DIR, "AGENTS.md");
const PI_SIDECAR = join(PI_DIR, "whiffle-fleet.json");

export const PI_CAPABILITIES: HarnessCapabilities = {
  interrupt: true,
  permissionModes: [],
  setModel: true,
  // pi streams thinking but offers no knob for how much of it to do.
  effort: false,
  contextUsage: true,
  supportedModels: true,
  supportedCommands: false,
  mcpStatus: false,
  mcpControl: false,
  listSessions: true,
  getSessionMessages: true,
  renameSession: false,
  deleteSession: true,
  fork: true,
  rewind: false,
  tagSession: false,
  skills: true,
  subagents: false,
  tasks: false,
  compaction: true,
  costUsd: false,
  thinking: true,
  images: true,
  handoff: true,
  hooks: false,
  plugins: false,
  fleet: true,
};

const textOf = (content: unknown): string => {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((block) =>
        typeof block === "object" && block !== null && "text" in block
          ? String((block as { text: unknown }).text)
          : ""
      )
      .filter(Boolean)
      .join("\n");
  }
  return "";
};

/** A pi `Model` is resolved by its `id`, which is what the dashboard sends. */
const modelIdOf = (model: Model<any>): string =>
  String((model as { id?: unknown }).id ?? "");

/** A hand-off tool, in pi's `ToolDefinition` form: TypeBox params over the shared body. */
const answer = (text: string, details: Record<string, unknown> = {}) => ({
  content: [{ type: "text" as const, text }],
  details,
});

/** Same line the claude adapter's `delegate` description carries — see handoff.ts's own comment. */
const delegateTypeLine = (types: HandoffDeps["delegateTypes"]): string =>
  types?.length
    ? ` Available types: ${types.map((type) => `'${type.name}' (${type.description})`).join("; ")}.`
    : "";

const piHandoffTools = (deps: HandoffDeps): ToolDefinition[] => {
  const actions = handoffActions(deps);
  const all: ToolDefinition[] = [
    defineTool({
      name: "list_sessions",
      label: "List sessions",
      description:
        "List the other sessions running on the fleet, with the directory each is working in. " +
        "The listing shows where each session works, not what it is currently doing, how busy it " +
        "is, or how likely it is to pick up a handoff — and recency is not an ownership signal. " +
        "Use it to find a session that already owns the work, or to name a delegate.",
      parameters: Type.Object({}),
      execute: async () => answer(await actions.listSessions()),
    }),
    defineTool({
      name: "handoff",
      label: "Hand off to a session",
      description:
        "Send a message to another session on the fleet — to continue one of your own " +
        "delegates, or to brief a session that already owns the work. An idle target wakes " +
        "and works on it immediately; a busy target finishes its current turn first, then " +
        "reads everything queued in one wake turn. Write the message as a brief for another " +
        "engineer. For new standalone work, use delegate instead.",
      parameters: Type.Object({
        target: Type.String(),
        message: Type.String(),
        urgent: Type.Optional(Type.Boolean()),
      }),
      execute: async (_id, params) => {
        const p = params as {
          target: string;
          message: string;
          urgent?: boolean;
        };
        return answer(await actions.handoff(p.target, p.message, p.urgent));
      },
    }),
    defineTool({
      name: "start_session",
      label: "Start a session",
      description:
        "Start a NEW session on the fleet and give it work — its own row, transcript, model and " +
        "permission mode. Use it when work belongs in a different directory.",
      parameters: Type.Object({
        cwd: Type.String(),
        prompt: Type.String(),
        sideQuest: Type.Optional(Type.Boolean()),
        model: Type.Optional(Type.String()),
      }),
      execute: async (_id, params) => {
        const p = params as {
          cwd: string;
          prompt: string;
          sideQuest?: boolean;
          model?: string;
        };
        const result = await actions.startSession(
          p.cwd,
          p.prompt,
          p.sideQuest,
          p.model
        );
        return answer(result.text, {
          instanceId: result.id,
          title: result.title,
        });
      },
    }),
    defineTool({
      name: "delegate",
      label: "Delegate to a sub-session",
      description:
        "Run a task as a SUB-AGENT: a new temporary fleet session nested under this one, working " +
        "autonomously in its own transcript, and reporting back automatically when each turn " +
        "completes. Guide it or send follow-ups with handoff. Prefer this over start_session when " +
        "the work is a delegation that must report back, and over handoff for new standalone work, " +
        "even in another repository (set cwd there). To continue a prior delegate's conversation " +
        "instead of starting fresh, set fork_of to its instanceId — best on the same model, where " +
        "it also reuses the prompt cache; a different model still works but re-ingests the " +
        "transcript at full cost. Prefer `type` over raw harness/model where a fleet delegate " +
        "type fits." +
        delegateTypeLine(deps.delegateTypes),
      parameters: Type.Object({
        prompt: Type.String(),
        type: Type.Optional(
          Type.String({
            description:
              "A named delegate type — see the types listed above. Type definitions are " +
              "snapshotted when this session starts — edits made in the dashboard apply to " +
              "sessions started afterward, not to this one.",
          })
        ),
        harness: Type.Optional(
          Type.Union([
            Type.Literal("claude"),
            Type.Literal("opencode"),
            Type.Literal("pi"),
          ])
        ),
        model: Type.Optional(Type.String()),
        cwd: Type.Optional(Type.String()),
        fork_of: Type.Optional(Type.String()),
        can_delegate: Type.Optional(
          Type.Boolean({
            description:
              "Let the delegate spawn delegates and sessions of its own. Default false: a delegate " +
              "is a leaf and does the work itself, which keeps the tree one level deep and every " +
              'report visible here. A type marked "may delegate by default" flips that default; an ' +
              "explicit value here wins either way. Set true only for an orchestrator-style delegate that must fan out.",
          })
        ),
      }),
      execute: async (_id, params) => {
        const p = params as {
          prompt: string;
          type?: string;
          harness?: "claude" | "opencode" | "pi";
          model?: string;
          cwd?: string;
          fork_of?: string;
          can_delegate?: boolean;
        };
        const result = await actions.delegate(p.prompt, {
          cwd: p.cwd,
          harness: p.harness,
          model: p.model,
          forkOf: p.fork_of,
          type: p.type,
          canDelegate: p.can_delegate,
        });
        return answer(result.text, {
          delegateInstanceId: result.id,
          title: result.title,
        });
      },
    }),
    defineTool({
      name: "stop_delegate",
      label: "Stop a delegate",
      description:
        "Stop one of YOUR delegates (a session you spawned with delegate). Only your own delegates " +
        "can be stopped. The transcript survives.",
      parameters: Type.Object({ target: Type.String() }),
      execute: async (_id, params) =>
        answer(
          await actions.stopDelegate((params as { target: string }).target)
        ),
    }),
    defineTool({
      name: "interrupt_delegate",
      label: "Interrupt a delegate",
      description:
        "Interrupt one of YOUR delegates mid-turn without ending it — the fleet's pause. It keeps " +
        "its state; resume it with handoff.",
      parameters: Type.Object({ target: Type.String() }),
      execute: async (_id, params) =>
        answer(
          await actions.interruptDelegate((params as { target: string }).target)
        ),
    }),
    defineTool({
      name: "answer_delegate",
      label: "Answer a delegate",
      description:
        "Answer an ask your delegate parked and routed to you. Answers are keyed by the EXACT " +
        "question text and the value is the chosen option label — copy them from the " +
        '"[delegate-ask ...]" message the delegate sent you. Pass deny=true to refuse the ask ' +
        "instead. Leave answers empty and deny false to allow the ask unchanged.",
      parameters: Type.Object({
        target: Type.String(),
        requestId: Type.String(),
        answers: Type.Optional(Type.Record(Type.String(), Type.String())),
        deny: Type.Optional(Type.Boolean()),
      }),
      execute: async (_id, params) => {
        const p = params as {
          target: string;
          requestId: string;
          answers?: Record<string, string>;
          deny?: boolean;
        };
        return answer(
          await actions.answerDelegate(p.target, p.requestId, p.answers, p.deny)
        );
      },
    }),
    defineTool({
      name: "send_to_user",
      label: "Message the user",
      description:
        "Display a message directly to the user (delivered to their Telegram). Use this for " +
        "progress updates, partial results, or content the user must see exactly as written " +
        "before the task finishes.",
      parameters: Type.Object({ message: Type.String() }),
      execute: async (_id, params) =>
        answer(
          await actions.sendToUser((params as { message: string }).message)
        ),
    }),
    defineTool({
      name: "note_for_user",
      label: "Note for the user",
      description:
        "Record a note for the user about a concern they raised, saying what you actually did " +
        "about it. Use this after you have acted on something the user pushed back on: which " +
        "file you fixed, what you ran, what you found. The note is shown to the user, so write " +
        "what changed, not that you understood. Ten characters minimum.",
      parameters: Type.Object({ note: Type.String() }),
      execute: async (_id, params) =>
        answer(
          await actions.acknowledgeConcern((params as { note: string }).note)
        ),
    }),
  ];
  return deps.canDelegate === false
    ? all.filter((entry) => !SPAWNING_TOOLS.has(entry.name))
    : all;
};

class PiSession implements HarnessSession {
  readonly harness = "pi" as const;
  sessionId: string | null = null;
  readonly #ctx: HarnessContext;
  readonly #session: AgentSession;
  #streamedText = "";
  #streamedThinking = "";
  #busy = false;

  constructor(ctx: HarnessContext, session: AgentSession) {
    this.#ctx = ctx;
    this.#session = session;
    this.sessionId = session.sessionId;
    session.subscribe((event) => this.#handle(event));
    ctx.session(session.sessionId);
    ctx.frame({
      type: "system",
      subtype: "init",
      session_id: session.sessionId,
      cwd: ctx.cwd,
      ...(session.model ? { model: modelIdOf(session.model) } : {}),
    });
  }

  #handle(event: AgentSessionEvent): void {
    switch (event.type) {
      case "message_update": {
        const ae = (event as { assistantMessageEvent?: { type?: string } })
          .assistantMessageEvent;
        if (!ae) {
          break;
        }
        switch (ae.type) {
          case "text_delta": {
            const delta = (ae as { delta?: string }).delta ?? "";
            this.#streamedText += delta;
            this.#ctx.frame({
              type: "stream_event",
              event: {
                type: "content_block_delta",
                delta: { type: "text_delta", text: delta },
              },
            });
            this.#ctx.busy(true);
            this.#busy = true;
            break;
          }
          case "thinking_delta": {
            this.#streamedThinking += (ae as { delta?: string }).delta ?? "";
            break;
          }
          case "toolcall_end": {
            const call = (
              ae as {
                toolCall?: {
                  id?: string;
                  name?: string;
                  arguments?: Record<string, unknown>;
                };
              }
            ).toolCall;
            if (!(call?.id && call.name)) {
              break;
            }
            this.#ctx.frame({
              type: "assistant",
              message: {
                content: [
                  {
                    type: "tool_use",
                    id: call.id,
                    name: call.name,
                    input: call.arguments ?? {},
                  },
                ],
              },
            });
            this.#ctx.busy(true);
            this.#busy = true;
            break;
          }
          default:
            break;
        }
        break;
      }
      case "tool_execution_end": {
        const { toolCallId, toolName, result, isError } = event as unknown as {
          toolCallId: string;
          toolName: string;
          result:
            | {
                content?: { type?: string; text?: string }[];
                details?: Record<string, unknown>;
              }
            | unknown;
          isError: boolean;
        };
        const content = Array.isArray(result)
          ? ""
          : textOf((result as { content?: unknown })?.content) || "";
        const details = (result as { details?: Record<string, unknown> } | null)
          ?.details;
        const structuredContent =
          details && Object.keys(details).length > 0 ? details : undefined;
        this.#ctx.frame({
          type: "user",
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: toolCallId,
                content,
                is_error: isError,
                ...(structuredContent ? { structuredContent } : {}),
              },
            ],
          },
        });
        break;
      }
      case "turn_end": {
        // The final assistant message: the streamed text already painted it, but
        // the closing frame replaces the buffer with the real blocks (and carries
        // any thinking the stream did not surface as text).
        const blocks: NeutralAssistantBlock[] = [];
        const message = (event as { message?: { content?: unknown[] } })
          .message;
        for (const block of message?.content ?? []) {
          const b = block as {
            type?: string;
            text?: string;
            thinking?: string;
          };
          if (b.type === "text" && b.text) {
            blocks.push({ type: "text", text: b.text });
          } else if (b.type === "thinking" && b.thinking) {
            blocks.push({ type: "thinking", thinking: b.thinking });
          }
        }
        if (blocks.length) {
          this.#ctx.frame({ type: "assistant", message: { content: blocks } });
        } else if (this.#streamedText) {
          this.#ctx.frame({
            type: "assistant",
            message: { content: [{ type: "text", text: this.#streamedText }] },
          });
        } else if (this.#streamedThinking) {
          this.#ctx.frame({
            type: "assistant",
            message: {
              content: [{ type: "thinking", thinking: this.#streamedThinking }],
            },
          });
        }
        break;
      }
      case "agent_end": {
        this.#streamedText = "";
        this.#streamedThinking = "";
        this.#ctx.busy(false);
        this.#busy = false;
        const willRetry = (event as { willRetry?: boolean }).willRetry === true;
        const failed = (
          event as { messages?: { role?: string; errorMessage?: string }[] }
        ).messages?.some(
          (m) => typeof m.errorMessage === "string" && m.errorMessage
        );
        this.#ctx.frame({
          type: "result",
          subtype: willRetry || failed ? "error_during_execution" : "success",
          is_error: willRetry === true || failed === true,
          ...(failed ? { errors: ["pi reported an error"] } : {}),
        });
        break;
      }
      case "session_info_changed":
        break;
      default:
        break;
    }
  }

  send(
    message: NeutralUserMessage,
    extras: Pick<SendPayload, "attachments" | "images" | "urgent">
  ): void {
    const text = textOf(message.message.content);
    const images = (extras.images ?? []).map((image) => ({
      type: "image" as const,
      data: image.data,
      mimeType: image.mediaType,
    }));
    const attachments = (extras.attachments ?? [])
      .map(
        (a) =>
          `\n\n<pasted-text name="${a.name}">\n${a.content}\n</pasted-text>`
      )
      .join("");

    if (extras.urgent && this.#busy) {
      const prompt = `[Urgent — your previous turn was interrupted to deliver this]\n\n${text}${attachments}`;
      void this.#session
        .abort()
        .catch(() => {})
        .then(() => {
          this.#ctx.busy(true);
          this.#busy = true;
          void this.#session
            .prompt(prompt, { images: images as never })
            .catch((error) => this.#ctx.failed(error));
        });
      return;
    }

    this.#ctx.busy(true);
    this.#busy = true;
    void this.#session
      .prompt(text + attachments, { images: images as never })
      .catch((error) => this.#ctx.failed(error));
  }

  async control(method: string, args: unknown[]): Promise<unknown> {
    switch (method) {
      case CONTROL_INTERRUPT:
        await this.#session.abort();
        return undefined;
      case CONTROL_SET_MODEL: {
        const model = await this.#resolveModel(args[0] as string);
        if (!model) {
          throw new Error(`pi does not know model ${args[0]}`);
        }
        await this.#session.setModel(model);
        return undefined;
      }
      case CONTROL_CONTEXT_USAGE: {
        const last = [...this.#session.messages]
          .reverse()
          .find((m) => (m as { usage?: unknown }).usage);
        const usage = (last as { usage?: { totalTokens?: number } })?.usage;
        const total = usage?.totalTokens ?? 0;
        return {
          totalTokens: total,
          maxTokens: 200_000,
          percentage: Math.min(100, Math.round((total / 200_000) * 100)),
          categories: [],
        };
      }
      default:
        // An unsupported control verb is a silent no-op, never a user-facing
        // failure: the hub may send a reload this harness has no verb for, and a
        // session must not answer that with an error the reader sees.
        console.warn(`[pi] no control verb ${method} — ignored`);
        return undefined;
    }
  }

  async #resolveModel(id: string): Promise<Model<any> | undefined> {
    const runtime = await PiHarness.runtime();
    return (await runtime.getAvailable()).find(
      (model) => modelIdOf(model) === id
    );
  }

  resolvePermission(_requestId: string, _result: PermissionResult): void {}

  async interrupt(): Promise<void> {
    await this.#session.abort();
  }

  async stop(): Promise<void> {
    await this.#session.abort().catch(() => {});
    await this.#session.waitForIdle().catch(() => {});
  }

  async dispose(): Promise<void> {
    this.#session.dispose();
  }
}

let runtimePromise: Promise<ModelRuntime> | null = null;

export class PiHarness implements Harness {
  readonly kind = "pi" as const;
  readonly capabilities = PI_CAPABILITIES;
  auth: AuthState = "authenticated";

  static runtime(): Promise<ModelRuntime> {
    if (!runtimePromise) {
      runtimePromise = ModelRuntime.create({ refreshOnCreate: false }).catch(
        (error) => {
          runtimePromise = null;
          throw error;
        }
      );
    }
    return runtimePromise;
  }

  async detect(): Promise<HarnessReport> {
    const installed = resolveBin("pi") !== undefined;
    return {
      harness: "pi",
      installed,
      auth: installed ? "authenticated" : "unauthenticated",
      capabilities: PI_CAPABILITIES,
    };
  }

  async #resolveModel(modelId: string): Promise<Model<any> | undefined> {
    const runtime = await PiHarness.runtime();
    return (await runtime.getAvailable()).find(
      (model) => modelIdOf(model) === modelId
    );
  }

  async spawn(
    spec: SpawnPayload,
    ctx: HarnessContext
  ): Promise<HarnessSession> {
    const runtime = await PiHarness.runtime();
    const model = spec.model ? await this.#resolveModel(spec.model) : undefined;
    // Fetched once, before this session's `delegate` tool description exists —
    // see `fetchDelegateTypes`'s own comment.
    // A leaf never builds the tool that needs the list, so skip the HTTP read.
    const delegateTypes =
      spec.canDelegate === false ? [] : await fetchDelegateTypes();

    let sessionManager: SessionManager | undefined;
    if (spec.resume?.fork) {
      const source = await this.#sessionPath(spec.resume.sessionKey, ctx.cwd);
      if (source) {
        sessionManager = SessionManager.forkFrom(source, ctx.cwd);
      }
    } else if (spec.resume) {
      const source = await this.#sessionPath(spec.resume.sessionKey, ctx.cwd);
      if (source) {
        sessionManager = SessionManager.open(source, undefined, ctx.cwd);
      }
    }

    const { session } = await createAgentSession({
      cwd: ctx.cwd,
      modelRuntime: runtime,
      ...(model ? { model } : {}),
      ...(sessionManager
        ? { sessionManager }
        : { sessionManager: SessionManager.create(ctx.cwd) }),
      customTools: piHandoffTools({
        instanceId: ctx.instanceId,
        cwd: ctx.cwd,
        emit: ctx.emit,
        delegateTypes,
        canDelegate: spec.canDelegate,
      }),
    });

    return new PiSession(ctx, session);
  }

  async #sessionPath(
    sessionKey: string,
    cwd: string
  ): Promise<string | undefined> {
    const sessions = await SessionManager.list(cwd);
    const found = sessions.find(
      (info) => info.id === sessionKey || info.path.includes(sessionKey)
    );
    return found?.path;
  }

  async listSessions(dir?: string): Promise<NeutralSessionInfo[]> {
    if (!dir) {
      return [];
    }
    const sessions = await SessionManager.list(dir);
    return sessions.map((info) => ({
      sessionId: info.id,
      harness: "pi",
      lastModified:
        (info as { updatedAt?: number }).updatedAt ??
        (info as { createdAt?: number }).createdAt ??
        Date.now(),
      ...(info.name ? { customTitle: info.name } : {}),
      ...(info.path ? { cwd: info.path } : {}),
    }));
  }

  async getSessionInfo(
    sessionKey: string,
    dir?: string
  ): Promise<NeutralSessionInfo | undefined> {
    const info = (await this.listSessions(dir)).find(
      (one) => one.sessionId === sessionKey
    );
    return info;
  }

  async getSessionMessages(
    sessionKey: string,
    dir?: string
  ): Promise<SessionMessage[]> {
    if (!dir) {
      return [];
    }
    const path = await this.#sessionPath(sessionKey, dir);
    if (!path) {
      return [];
    }
    const manager = SessionManager.open(path, undefined, dir);
    const entries: SessionMessage[] = [];
    for (const entry of manager.getEntries()) {
      if (entry.type !== "message") {
        continue;
      }
      const message = (entry as { message?: unknown }).message as
        | { role?: string; content?: unknown }
        | undefined;
      if (!message) {
        continue;
      }
      const role = message.role;
      if (role === "user") {
        entries.push({
          type: "user",
          uuid: entry.id,
          session_id: sessionKey,
          message: { role: "user", content: textOf(message.content) },
          parent_tool_use_id: null,
          parent_agent_id: null,
        });
      } else if (role === "assistant") {
        entries.push({
          type: "assistant",
          uuid: entry.id,
          session_id: sessionKey,
          message: { role: "assistant", content: toBlocks(message.content) },
          parent_tool_use_id: null,
          parent_agent_id: null,
        });
      } else if (role === "toolResult") {
        const tool = message as { toolCallId?: string; isError?: boolean };
        entries.push({
          type: "user",
          uuid: entry.id,
          session_id: sessionKey,
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: tool.toolCallId ?? "",
                content: textOf(message.content),
                is_error: tool.isError,
              },
            ],
          },
          parent_tool_use_id: null,
          parent_agent_id: null,
        });
      }
    }
    return entries;
  }

  renameSession(): Promise<void> {
    return Promise.resolve();
  }

  tagSession(): Promise<void> {
    return Promise.resolve();
  }

  async deleteSession(sessionKey: string, dir?: string): Promise<void> {
    if (!dir) {
      return;
    }
    const path = await this.#sessionPath(sessionKey, dir);
    if (path) {
      await Bun.$`rm -f ${path}`.quiet().nothrow();
    }
  }

  async dispose(): Promise<void> {
    runtimePromise = null;
  }

  async syncFleet(config: FleetConfig): Promise<FleetSyncReport> {
    const sidecar = await readSidecar(PI_SIDECAR);
    const report: FleetSyncReport = {
      mcp: {},
      marketplaces: {},
      plugins: {},
      skills: {},
      at: Date.now(),
    };

    // pi has no MCP and no plugins: the fleet's skills and memory are all it
    // can converge, and its reports say so for the tables it cannot.
    const skills = await syncSkillFiles(
      PI_SKILLS,
      config.skills ?? [],
      sidecar.skills,
      report.skills!
    );
    const memory = await syncMemory(
      PI_MEMORY,
      config.memory,
      sidecar.memory,
      report
    );

    await writeJson(PI_SIDECAR, { skills, ...(memory ? { memory } : {}) });
    // pi keeps its OWN copy of the skills, so it has to make its own claim: the
    // hub leaves bytes out only when every harness that converges them says it
    // already has that hash, and a harness that stays silent is one the fleet
    // would quietly stop sending content to.
    report.have = { skills };
    return report;
  }

  async fleetStatus(): Promise<FleetSyncReport> {
    const sidecar = await readSidecar(PI_SIDECAR);
    const report: FleetSyncReport = {
      mcp: {},
      marketplaces: {},
      plugins: {},
      skills: {},
      at: Date.now(),
    };

    for (const name of Object.keys(sidecar.skills)) {
      const file = Bun.file(join(PI_SKILLS, name, "SKILL.md"));
      report.skills![name] = (await file.exists())
        ? { state: "applied" }
        : { state: "failed", detail: "not on disk" };
    }
    if (sidecar.memory !== undefined) {
      const file = Bun.file(PI_MEMORY);
      const hash = (await file.exists()) ? hashText(await file.text()) : null;
      report.memory =
        hash === sidecar.memory
          ? { state: "applied" }
          : {
              state: "failed",
              detail: hash === null ? "not on disk" : "edited on this machine",
            };
    }
    // The same claim the sync makes, from the sidecar it already read: a status
    // that stayed silent would retract it and cost a full resend.
    report.have = { skills: sidecar.skills };
    return report;
  }
}

function toBlocks(content: unknown): NeutralAssistantBlock[] {
  if (!Array.isArray(content)) {
    return [];
  }
  const blocks: NeutralAssistantBlock[] = [];
  for (const block of content) {
    const b = block as {
      type?: string;
      text?: string;
      thinking?: string;
      id?: string;
      name?: string;
      arguments?: Record<string, unknown>;
    };
    if (b.type === "text" && b.text) {
      blocks.push({ type: "text", text: b.text });
    } else if (b.type === "thinking" && b.thinking) {
      blocks.push({ type: "thinking", thinking: b.thinking });
    } else if (b.type === "toolCall" && b.id && b.name) {
      blocks.push({
        type: "tool_use",
        id: b.id,
        name: b.name,
        input: b.arguments ?? {},
      });
    }
  }
  return blocks;
}

export const piHarness: Harness = new PiHarness();
