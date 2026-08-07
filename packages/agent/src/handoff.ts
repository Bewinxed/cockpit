import type { Envelope, InstanceRow, SendPayload, SpawnPayload } from '@cockpit/core';
import { COCKPIT_ENV, COCKPIT_HUB_PORT } from '@cockpit/core';
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

/**
 * The tools a session uses to hand work to another session.
 *
 * This is the point of the feature: the agent that found the problem is the one
 * that knows what to say about it, so it does the telling. A reader retyping the
 * finding into another session's composer is the thing this exists to avoid.
 *
 * Two properties are load-bearing and set here rather than left to the caller:
 *
 * - `origin: peer` marks the message as another agent's word. The receiving
 *   session weighs it as reported speech instead of as its user's instruction,
 *   which is what stops one repo's agent borrowing authority in another.
 * - `shouldQuery: false` appends it without starting a turn. The target is
 *   usually mid-work; the note waits for it to finish rather than derailing it.
 */

/** Where the hub answers REST, derived from the websocket url the daemon uses. */
const hubHttpUrl = (): string => {
  const ws = process.env[COCKPIT_ENV.hubUrl] ?? `ws://localhost:${COCKPIT_HUB_PORT}/ws`;
  return ws.replace(/^ws/, 'http').replace(/\/ws$/, '');
};

/** The last path segment — how the rail names a session, and how the model will. */
const leafOf = (path: string): string => path.split('/').filter(Boolean).pop() ?? path;

interface Peer {
  row: InstanceRow;
  name: string;
}

/**
 * The fleet, read from the hub rather than from this daemon's own sessions:
 * the whole point is reaching a session that is usually somewhere else.
 */
async function roster(exceptInstanceId: string): Promise<Peer[]> {
  const response = await fetch(`${hubHttpUrl()}/api/instances`, {
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`the hub answered ${response.status}`);
  const rows = (await response.json()) as InstanceRow[];
  return rows
    .filter((row) => row.id !== exceptInstanceId && (row.status === 'running' || row.status === 'starting'))
    .map((row) => ({ row, name: leafOf(row.cwd) }));
}

/**
 * Resolves what the model typed to one session.
 *
 * Ambiguity is reported rather than guessed: picking one of two sessions in the
 * same repo and saying nothing is how a hand-off lands somewhere the sender
 * never looks again.
 */
function resolve(peers: Peer[], target: string): Peer {
  const needle = target.trim().toLowerCase().replace(/^@/, '');
  const byId = peers.find((peer) => peer.row.id === needle);
  if (byId) return byId;

  const exact = peers.filter((peer) => peer.name.toLowerCase() === needle);
  if (exact.length === 1) return exact[0];

  const partial = peers.filter((peer) => peer.name.toLowerCase().includes(needle));
  const candidates = exact.length > 1 ? exact : partial;
  if (candidates.length === 1) return candidates[0];
  if (candidates.length === 0) {
    const known = peers.map((peer) => peer.name).join(', ') || 'none are running';
    throw new Error(`No running session matches "${target}". Running now: ${known}.`);
  }
  const listed = candidates.map((peer) => `${peer.name} (${peer.row.id})`).join(', ');
  throw new Error(`"${target}" matches more than one session: ${listed}. Name one by its id.`);
}

/** A session id the daemon can also address, so the model gets a name back. */
const newInstanceId = (): string => crypto.randomUUID();

export interface HandoffDeps {
  /** The session doing the handing over. */
  readonly instanceId: string;
  /** What it is working on, so the receiver knows who is calling. */
  readonly cwd: string;
  /** Puts an envelope on the daemon's hub socket. */
  readonly emit: (envelope: Envelope) => void;
}

/** The tools themselves, separated from the server so they can be exercised directly. */
export function handoffTools({ instanceId, cwd, emit }: HandoffDeps) {
  return [
      tool(
        'list_sessions',
        'List the other sessions running on the fleet, with the directory each is working in. ' +
          'Use this to find the right session to hand work to.',
        {},
        async () => {
          const peers = await roster(instanceId);
          if (peers.length === 0) {
            return { content: [{ type: 'text' as const, text: 'No other sessions are running.' }] };
          }
          const lines = peers.map(
            (peer) => `- ${peer.name} — ${peer.row.cwd} (id: ${peer.row.id})`
          );
          return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
        }
      ),
      tool(
        'handoff',
        'Send a message to another session on the fleet — the one already working in the ' +
          'repository the work belongs to. It arrives attributed to this session and does NOT ' +
          'interrupt: the other session picks it up when it finishes its current turn. Write the ' +
          'message as a brief for another engineer who cannot see your conversation: what you ' +
          'found, where (file and line), and what you are asking them to do.',
        {
          target: z
            .string()
            .describe('The session to hand to: its directory name, e.g. "keeboard", or its id.'),
          message: z
            .string()
            .describe('The brief. Include the finding, the paths involved, and the ask.'),
        },
        async ({ target, message }) => {
          const peer = resolve(await roster(instanceId), target);
          // The attribution goes in the body as well as the origin.
          //
          // `origin` is what the live UI and the SDK's trust gates read, but the
          // stored transcript does not keep it — so a reader who reloads, or a
          // dashboard that was not watching the moment it arrived, sees another
          // agent's instructions as if the user had typed them. Said in the text
          // too, it survives being written to disk and read back, and the
          // receiving model knows who is asking rather than assuming it was you.
          const from = leafOf(cwd);
          const body = `[Hand-off from the ${from} session — another agent, not the user]\n\n${message}`;
          const payload: SendPayload = {
            instanceId: peer.row.id,
            message: {
              type: 'user',
              message: { role: 'user', content: body },
              parent_tool_use_id: null,
              origin: {
                kind: 'peer',
                from: instanceId,
                name: from,
                fromSession: instanceId,
              },
              shouldQuery: false,
            },
          };
          emit({
            verb: 'send',
            machineId: peer.row.machineId,
            instanceId: peer.row.id,
            payload,
          });
          return {
            content: [
              {
                type: 'text' as const,
                text:
                  `Handed to ${peer.name} (${peer.row.cwd}). It is queued there and will be ` +
                  `picked up when that session finishes its current turn — it was not interrupted.`,
              },
            ],
          };
        }
      ),
      tool(
        'start_session',
        'Start a NEW Claude Code session on the fleet and give it work. Unlike a subagent, this ' +
          'is a full session of its own: it gets its own row in the sidebar, its own transcript ' +
          'the user can open and read, its own model and permission mode, and it survives after ' +
          'this turn ends. Use it when the user asks you to spin something off, or when work ' +
          'belongs in a different directory and no session is running there yet. Prefer ' +
          '`handoff` when a session is ALREADY running in that directory.',
        {
          cwd: z
            .string()
            .describe(
              'Absolute directory the new session works in. Often a DIFFERENT project from this ' +
                'one — if the user named another repository or folder, use that. Defaults to ' +
                'this session\'s directory only when they did not.'
            ),
          prompt: z
            .string()
            .describe('The opening instruction. Write it as a full brief: the new session cannot see this conversation.'),
          sideQuest: z
            .boolean()
            .optional()
            .describe(
              'A detour from this session\'s work. It appears nested under this session in the ' +
                'sidebar and shares its directory. Default false.'
            ),
          model: z.string().optional().describe('Model id. Omit to let the SDK choose.'),
        },
        async ({ cwd: workdir, prompt, sideQuest, model }) => {
          const id = newInstanceId();
          const payload: SpawnPayload = {
            instanceId: id,
            cwd: workdir,
            ...(model ? { model } : {}),
            // No worktree: the user works in their checkout, not in a detached
            // copy of it. A quest is kept apart by being a quest, not by being
            // somewhere else on disk.
            ...(sideQuest ? { scratch: { baseCwd: workdir } } : {}),
          };
          // Spawned on this machine: the daemon that runs this tool is the one
          // with the directory. Reaching another machine's disk is a different
          // question, and guessing at it would fail on a path that only looks
          // like it exists here.
          emit({ verb: 'spawn', machineId: '', instanceId: id, payload });
          // The opening instruction is a turn, so it goes as a normal send once
          // the session is up — `shouldQuery` unset, because this one *should* run.
          const opening: SendPayload = {
            instanceId: id,
            message: {
              type: 'user',
              message: { role: 'user', content: prompt },
              parent_tool_use_id: null,
              origin: { kind: 'peer', from: instanceId, name: leafOf(cwd), fromSession: instanceId },
            },
          };
          emit({ verb: 'send', machineId: '', instanceId: id, payload: opening });
          return {
            content: [
              {
                type: 'text' as const,
                text:
                  `Started ${leafOf(workdir)}${sideQuest ? ' as a side quest' : ''} in ${workdir} ` +
                  `(id: ${id}). It is in the sidebar now and the user can open its transcript. ` +
                  `Hand it more work later with handoff("${id}", ...).`,
              },
            ],
          };
        }
      ),
  ];
}

export function handoffServer(deps: HandoffDeps) {
  return createSdkMcpServer({
    name: 'outpost',
    version: '1.0.0',
    instructions:
      'Other Claude Code sessions running on this fleet, each with its own repository and its ' +
      'own context. Use these when work belongs to a repository this session is not in: hand it ' +
      'to the session already working there instead of changing files outside your own tree.',
    tools: handoffTools(deps),
  });
}
