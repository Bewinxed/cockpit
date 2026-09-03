import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import {
  type HandoffDeps,
  handoffActions,
  SPAWNING_TOOLS,
} from "./harnesses/handoff-shared";

/**
 * The tools a Claude session uses to hand work to another session. The bodies
 * are the shared {@link handoffActions}; this file only wraps them in the
 * in-process MCP server the claude SDK injects under the name `whiffle`.
 *
 * Two properties are load-bearing and set by the shared actions, not here:
 * `origin: peer` marks the message as another agent's word, and
 * `shouldQuery: false` appends it without starting a turn.
 */

export type { HandoffDeps };

/**
 * The name the SDK injects this server under, and so the prefix of every tool
 * it exposes: `mcp__whiffle__handoff`, `…__start_session`, `…__delegate`.
 */
export const MCP_SERVER_NAME = "whiffle";

/**
 * Called when a tool handler returns structured data the Claude SDK would
 * otherwise drop. The harness intercepts the result text and injects the
 * structured payload onto the `tool_result` content block it can match.
 */
export type OnStructuredResult = (
  resultText: string,
  data: Record<string, unknown>
) => void;

/**
 * `delegate`'s `type` line: every fleet-configured preset, name and
 * description, so the calling model can route by what a type is FOR rather
 * than by a model string. Built once from `deps.delegateTypes` — the caller
 * fetched it once for this session — and never rebuilt, because the tool
 * description feeds the prompt cache and a description that could change
 * mid-session would invalidate it on every delegate call.
 */
const delegateTypeLine = (types: HandoffDeps["delegateTypes"]): string =>
  types?.length
    ? ` Available types: ${types.map((type) => `'${type.name}' (${type.description}${type.canDelegate ? "; may delegate by default" : ""})`).join("; ")}.`
    : "";

/** The tools themselves, separated from the server so they can be exercised directly. */
export function handoffTools(
  deps: HandoffDeps,
  onStructured?: OnStructuredResult
) {
  const actions = handoffActions(deps);
  const all = [
    tool(
      "list_sessions",
      "List the other sessions running on the fleet, with the directory each is working in. " +
        "The listing shows where each session works, not what it is currently doing, how busy it " +
        "is, or how likely it is to pick up a handoff — and recency is not an ownership signal. " +
        "Use it to find a session that already owns the work, or to name a delegate.",
      {},
      async () => ({
        content: [
          { type: "text" as const, text: await actions.listSessions() },
        ],
      })
    ),
    tool(
      "handoff",
      "Send a message to another session on the fleet — to continue one of your own " +
        "delegates, or to brief a session that already owns the work. An idle target wakes " +
        "and works on it immediately; a busy target finishes its current turn first, then " +
        "reads everything queued in one wake turn. Write the message as a brief " +
        "for another engineer who cannot see your conversation: what you found, where (file " +
        "and line), and what you are asking them to do. For new standalone work, use delegate instead.",
      {
        target: z
          .string()
          .describe(
            'The session to hand to: its directory name, e.g. "keeboard", or its id.'
          ),
        message: z
          .string()
          .describe(
            "The brief. Include the finding, the paths involved, and the ask."
          ),
        urgent: z
          .boolean()
          .optional()
          .describe(
            "Force delivery to one of YOUR delegates: a busy claude delegate reads it mid-turn; " +
              "other harnesses interrupt their turn to read it now. Only valid toward your own delegates."
          ),
      },
      async ({ target, message, urgent }) => ({
        content: [
          {
            type: "text" as const,
            text: await actions.handoff(target, message, urgent),
          },
        ],
      })
    ),
    tool(
      "start_session",
      "Start a NEW Claude Code session on the fleet and give it work. Unlike a subagent, this " +
        "is a full session of its own: it gets its own row in the sidebar, its own transcript " +
        "the user can open and read, its own model and permission mode, and it survives after " +
        "this turn ends. Use it when the user asks you to spin something off, or when work " +
        "belongs in a different directory and no session is running there yet. Prefer " +
        "`handoff` when a session is ALREADY running in that directory.",
      {
        cwd: z
          .string()
          .describe(
            "Absolute directory the new session works in. Often a DIFFERENT project from this " +
              "one — if the user named another repository or folder, use that. Defaults to " +
              "this session's directory only when they did not."
          ),
        prompt: z
          .string()
          .describe(
            "The opening instruction. Write it as a full brief: the new session cannot see this conversation."
          ),
        sideQuest: z
          .boolean()
          .optional()
          .describe(
            "A detour from this session's work. It appears nested under this session in the " +
              "sidebar and shares its directory. Default false."
          ),
        model: z
          .string()
          .optional()
          .describe("Model id. Omit to let the SDK choose."),
      },
      async ({ cwd, prompt, sideQuest, model }) => {
        const result = await actions.startSession(
          cwd,
          prompt,
          sideQuest,
          model
        );
        const sc = { instanceId: result.id, title: result.title };
        onStructured?.(result.text, sc);
        return {
          content: [{ type: "text" as const, text: result.text }],
          structuredContent: sc,
        };
      }
    ),
    tool(
      "delegate",
      "Run a task as a SUB-AGENT: a new temporary fleet session nested under this one. It works " +
        "autonomously in its own transcript the user can watch, and reports back to this session " +
        "automatically when each of its turns completes — no report protocol to follow. Guide it " +
        "or send follow-ups with handoff. Prefer this over start_session when the work is a " +
        "delegation that must report back, and over handoff for new standalone work, even in " +
        "another repository (set cwd there). To continue a prior delegate's conversation instead " +
        "of starting fresh, set fork_of. Prefer `type` over raw harness/model: it routes by what " +
        "the work needs, not by a model string you have to already know." +
        delegateTypeLine(deps.delegateTypes),
      {
        prompt: z
          .string()
          .describe(
            "The full brief. The delegate cannot see this conversation."
          ),
        type: z
          .string()
          .optional()
          .describe(
            "A named delegate type — see the types listed above. Sets harness/model/effort/skills " +
              "for you; an explicit harness/model/skills below still overrides what the type says. " +
              "Type definitions are snapshotted when this session starts — edits made in the " +
              "dashboard apply to sessions started afterward, not to this one."
          ),
        harness: z
          .enum(["claude", "opencode", "pi"])
          .optional()
          .describe(
            "Which runtime runs the delegate. 'opencode' with model 'opencode-go/deepseek-v4-pro' " +
              "delegates to DeepSeek. Default claude. Overrides `type`'s harness when both are set."
          ),
        model: z
          .string()
          .optional()
          .describe(
            "Model id for the harness, e.g. opencode-go/deepseek-v4-flash. Omit for the harness " +
              "default, or for `type`'s own model. Overrides `type`'s model when both are set."
          ),
        cwd: z
          .string()
          .optional()
          .describe("Defaults to this session's directory."),
        skills: z
          .array(z.string())
          .optional()
          .describe(
            "Skill names to load natively into the delegate session. Each skill is invoked " +
              "via the harness's own slash-command mechanism before the prompt — the same as " +
              "if the user typed /skill-name in that session. Works cross-harness. Overrides " +
              "`type`'s skills when both are set."
          ),
        fork_of: z
          .string()
          .optional()
          .describe(
            "Fork an earlier delegate: pass the instanceId this tool returned for it. The new " +
              "delegate starts with the full conversation of that prior delegate — the source is " +
              "untouched. Works best on the SAME model, where it also reuses the prompt cache; a " +
              "different model still works but re-ingests the transcript at full cost."
          ),
        can_delegate: z
          .boolean()
          .optional()
          .describe(
            "Let the delegate spawn delegates and sessions of its own. Default false: a delegate is a " +
              "leaf and does the work itself, which keeps the tree one level deep and every report " +
              'visible here. A type marked "may delegate by default" flips that default; an explicit ' +
              "value here wins either way. Set true only for an orchestrator-style delegate that must fan out."
          ),
      },
      async ({
        prompt,
        type,
        harness,
        model,
        cwd,
        skills,
        fork_of,
        can_delegate,
      }) => {
        const result = await actions.delegate(prompt, {
          cwd,
          harness,
          model,
          skills,
          forkOf: fork_of,
          type,
          canDelegate: can_delegate,
        });
        const sc = { delegateInstanceId: result.id, title: result.title };
        onStructured?.(result.text, sc);
        return {
          content: [{ type: "text" as const, text: result.text }],
          structuredContent: sc,
        };
      }
    ),
    tool(
      "stop_delegate",
      "Stop one of YOUR delegates (a session you spawned with delegate). Only your own delegates " +
        "can be stopped. The transcript survives.",
      {
        target: z
          .string()
          .describe(
            'The delegate to stop: its directory name, e.g. "keeboard", or its id.'
          ),
      },
      async ({ target }) => ({
        content: [
          { type: "text" as const, text: await actions.stopDelegate(target) },
        ],
      })
    ),
    tool(
      "interrupt_delegate",
      "Interrupt one of YOUR delegates mid-turn without ending it — the fleet's pause. It keeps " +
        "its state; resume it with handoff.",
      {
        target: z
          .string()
          .describe(
            'The delegate to interrupt: its directory name, e.g. "keeboard", or its id.'
          ),
      },
      async ({ target }) => ({
        content: [
          {
            type: "text" as const,
            text: await actions.interruptDelegate(target),
          },
        ],
      })
    ),
    tool(
      "answer_delegate",
      "Answer an ask your delegate parked and routed to you. Answers are keyed by the EXACT " +
        "question text and the value is the chosen option label — copy them from the " +
        '"[delegate-ask ...]" message the delegate sent you. Pass deny=true to refuse the ask ' +
        "instead. Leave answers empty and deny false to allow the ask unchanged.",
      {
        target: z
          .string()
          .describe(
            'The delegate to answer: its directory name, e.g. "keeboard", or its id.'
          ),
        requestId: z
          .string()
          .describe(
            'The requestId from the delegate\'s "[delegate-ask ...]" line.'
          ),
        answers: z
          .record(z.string())
          .optional()
          .describe(
            "Exact question text → chosen option label, for each question asked."
          ),
        deny: z
          .boolean()
          .optional()
          .describe("Refuse the ask instead of answering it. Default false."),
      },
      async ({ target, requestId, answers, deny }) => ({
        content: [
          {
            type: "text" as const,
            text: await actions.answerDelegate(
              target,
              requestId,
              answers,
              deny
            ),
          },
        ],
      })
    ),
    tool(
      "send_to_user",
      "Display a message directly to the user (delivered to their Telegram). Use this for " +
        "progress updates, partial results, or content the user must see exactly as written " +
        "before the task finishes.",
      {
        message: z
          .string()
          .describe("The text to show the user, exactly as it should read."),
      },
      async ({ message }) => ({
        content: [
          { type: "text" as const, text: await actions.sendToUser(message) },
        ],
      })
    ),
    tool(
      "note_for_user",
      "Record a note for the user about a concern they raised, saying what you actually did " +
        "about it. Use this after you have acted on something the user pushed back on: which " +
        "file you fixed, what you ran, what you found. The note is shown to the user, so write " +
        "what changed, not that you understood.",
      {
        note: z
          .string()
          .describe(
            "What you actually did about it, in a sentence or two. Ten characters minimum."
          ),
      },
      async ({ note }) => ({
        content: [
          {
            type: "text" as const,
            text: await actions.acknowledgeConcern(note),
          },
        ],
      })
    ),
  ];
  return deps.canDelegate === false
    ? all.filter((entry) => !SPAWNING_TOOLS.has(entry.name))
    : all;
}

export function handoffServer(
  deps: HandoffDeps,
  onStructured?: OnStructuredResult
) {
  return createSdkMcpServer({
    name: MCP_SERVER_NAME,
    version: "1.0.0",
    instructions:
      deps.canDelegate === false
        ? "This session is a delegate spawned without permission to delegate further, so it has " +
          "no delegate or start_session tools: do the work yourself rather than looking for a " +
          "way to fan it out. handoff still reaches your parent session, or a session that " +
          "already owns related work, and the user sees your transcript as it happens."
        : "A repository may have several sessions; the listing shows where each works, not what it " +
          "is doing. Hand work to an existing session only to continue work it already owns. For new " +
          "standalone work in another repository, spawn a delegate with cwd set there instead. " +
          "An idle handoff target wakes and works immediately; a busy one finishes its current " +
          "turn, then reads everything queued in one wake turn.",
    tools: handoffTools(deps, onStructured),
  });
}
