/**
 * Per-message reactive hints, computed ONCE in the session pane and passed
 * down as props.  Before this existed, each mounted ChatMessage ran 6
 * derivations that subscribed to `cockpit.instances` and
 * `cockpit.session(id).messages` independently — pushing one message
 * re-evaluated 30+ ChatMessages × 6 derivations with `.find()` / `.some()`
 * on the full store.  A single derivation in SessionPane now does the same
 * work in one linear pass and hands each ChatMessage a plain object.
 */
import type { Message } from './types';
import {
  delegateOf,
  isDelegateReport,
  matchesSession,
} from './frames';
import { resolveInstanceId } from './links';
import { sourcesForMessage, type SourceRef } from './sources';

/** The subset of an InstanceRow that hint computation actually reads. */
interface HintRow {
  id: string;
  cwd: string;
  model?: string | null;
  parentInstanceId?: string | null;
}

export interface MessageHints {
  suppressedAsDelegateTraffic: boolean;
  followUpLabel: string | null;
  briefParent: (HintRow & { label: string }) | null;
  peerSenderModel: string | null;
  suppressedAsTaskEcho: boolean;
  sources: SourceRef[];
  /** `/session/<id>` for the session a peer/hand-off message names, if resolvable. */
  sessionHref: string | null;
}

const EMPTY: MessageHints = {
  suppressedAsDelegateTraffic: false,
  followUpLabel: null,
  briefParent: null,
  peerSenderModel: null,
  suppressedAsTaskEcho: false,
  sources: [],
  sessionHref: null,
};

/**
 * Compute hints for every message in one pass.  The result is keyed by
 * `message.id` — the caller looks up each group's message and passes the
 * hints object as a prop.
 */
export function computeMessageHints(
  messages: Message[],
  instanceId: string,
  instances: ReadonlyArray<HintRow>,
  subagents: Record<string, unknown>,
): Map<string, MessageHints> {
  const map = new Map<string, MessageHints>();

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const id = msg.id;
    if (!id) continue;

    // Fast path: most message types don't need any hint at all.
    const type = msg.type;
    if (
      type !== 'user.peer' &&
      type !== 'user.delegate_ask' &&
      type !== 'tool.handoff' &&
      type !== 'ui.system_note' &&
      type !== 'assistant'
    ) {
      map.set(id, EMPTY);
      continue;
    }

    let suppressedAsDelegateTraffic = false;
    let followUpLabel: string | null = null;
    let briefParent: (HintRow & { label: string }) | null = null;
    let peerSenderModel: string | null = null;
    let suppressedAsTaskEcho = false;
    let sources: SourceRef[] = [];
    let sessionHref: string | null = null;

    // ── suppressedAsDelegateTraffic ───────────────────────────────
    if (type === 'user.peer' || type === 'user.delegate_ask') {
      let eligible = true;
      if (type === 'user.peer') {
        eligible = isDelegateReport(msg, instanceId, instances);
      }
      if (eligible) {
        const peerSession = msg.metadata?.peerSession;
        if (peerSession) {
          suppressedAsDelegateTraffic = messages.some(
            (m) =>
              (m.type === 'tool.handoff' || m.type === 'tool.use') &&
              m.metadata?.delegateInstanceId != null &&
              matchesSession(peerSession, m.metadata.delegateInstanceId),
          );
        }
      }
    }

    // ── followUpLabel ────────────────────────────────────────────
    if (type === 'tool.handoff' && msg.metadata?.handoffKind !== 'delegate') {
      const row = delegateOf(String(msg.content), instanceId, instances);
      if (row) {
        const name = row.cwd.split('/').filter(Boolean).pop() ?? row.cwd;
        followUpLabel = `${name}#${row.id.slice(0, 8)}`;
      }
    }

    // ── briefParent ──────────────────────────────────────────────
    if (type === 'user.peer' && !msg.metadata?.reportKind) {
      const row = instances.find(
        (r) => r.id === (instanceId || msg.instanceId),
      );
      if (row?.parentInstanceId) {
        const parent = instances.find(
          (r) => r.id === row.parentInstanceId,
        );
        if (parent) {
          const sender =
            msg.metadata?.peerSession ?? msg.metadata?.peerFrom;
          const parentLeaf =
            parent.cwd.split('/').filter(Boolean).pop() ?? parent.cwd;
          const matched = sender
            ? matchesSession(sender, parent.id)
            : msg.metadata?.peerName === parentLeaf;
          if (matched) {
            briefParent = {
              ...parent,
              label: `${parentLeaf}#${parent.id.slice(0, 8)}`,
            };
          }
        }
      }
    }

    // ── peerSenderModel ──────────────────────────────────────────
    if (type === 'user.peer') {
      if (briefParent) {
        peerSenderModel = briefParent.model ?? null;
      } else {
        const sender =
          msg.metadata?.peerSession ?? msg.metadata?.peerFrom;
        if (sender) {
          const row = instances.find((r) =>
            matchesSession(sender, r.id),
          );
          peerSenderModel = row?.model ?? null;
        }
      }
    }

    // ── suppressedAsTaskEcho ─────────────────────────────────────
    if (
      type === 'ui.system_note' &&
      msg.metadata?.noteKind === 'Task notification'
    ) {
      const toolId = msg.metadata?.noteTaskToolId;
      if (toolId) {
        suppressedAsTaskEcho = Boolean(subagents[toolId]);
      }
    }

    // ── sources ──────────────────────────────────────────────────
    if (type === 'assistant') {
      sources = sourcesForMessage(messages, i);
    }

    // ── sessionHref ─────────────────────────────────────────────
    // A report names its delegate, a hand-off its target. A stored transcript
    // keeps only the short id, so it resolves against the fleet's live rows.
    if (type === 'user.peer') {
      const sender = msg.metadata?.peerSession ?? msg.metadata?.peerFrom;
      const id = resolveInstanceId(sender, instances);
      sessionHref = id ? `/session/${id}` : null;
    } else if (type === 'tool.handoff') {
      const full = msg.metadata?.delegateInstanceId;
      if (typeof full === 'string') {
        sessionHref = `/session/${full}`;
      } else {
        const short = /#([0-9a-f]{8,})$/.exec(String(msg.content ?? '').trim());
        const id = short ? resolveInstanceId(short[1], instances) : undefined;
        sessionHref = id ? `/session/${id}` : null;
      }
    }

    map.set(id, {
      suppressedAsDelegateTraffic,
      followUpLabel,
      briefParent,
      peerSenderModel,
      suppressedAsTaskEcho,
      sources,
      sessionHref,
    });
  }

  return map;
}
