/**
 * Per-message reactive hints, computed ONCE in the session pane and passed
 * down as props.  Before this existed, each mounted ChatMessage ran 6
 * derivations that subscribed to `whiffle.instances` and
 * `whiffle.session(id).messages` independently — pushing one message
 * re-evaluated 30+ ChatMessages × 6 derivations with `.find()` / `.some()`
 * on the full store.  A single derivation in SessionPane now does the same
 * work in one linear pass and hands each ChatMessage a plain object.
 */

import { delegateOf, isDelegateReport, matchesSession } from "./frames";
import { resolveInstanceId } from "./links";
import { type SourceRef, sourcesForMessage } from "./sources";
import type { Message } from "./types";

/** The subset of an InstanceRow that hint computation actually reads. */
interface HintRow {
  cwd: string;
  id: string;
  model?: string | null;
  parentInstanceId?: string | null;
}

export interface MessageHints {
  briefParent: (HintRow & { label: string }) | null;
  followUpLabel: string | null;
  peerSenderModel: string | null;
  /** `/session/<id>` for the session a peer/hand-off message names, if resolvable. */
  sessionHref: string | null;
  sources: SourceRef[];
  suppressedAsDelegateTraffic: boolean;
  suppressedAsTaskEcho: boolean;
}

/** The instance id a stored transcript keeps at the end of a `#`-suffixed label. */
const TRAILING_INSTANCE_ID = /#([0-9a-f]{8,})$/;

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
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one linear pass over every hint kind a message can carry, computed once for the whole transcript — see the module doc for why it isn't per-derivation
export function computeMessageHints(
  messages: Message[],
  instanceId: string,
  instances: readonly HintRow[],
  subagents: Record<string, unknown>
): Map<string, MessageHints> {
  const map = new Map<string, MessageHints>();

  for (let i = 0; i < messages.length; i += 1) {
    const msg = messages[i];
    const { id: messageId } = msg;
    if (!messageId) {
      continue;
    }

    // Fast path: most message types don't need any hint at all.
    const { type } = msg;
    if (
      type !== "user.peer" &&
      type !== "user.delegate_ask" &&
      type !== "tool.handoff" &&
      type !== "ui.system_note" &&
      type !== "assistant"
    ) {
      map.set(messageId, EMPTY);
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
    if (type === "user.peer" || type === "user.delegate_ask") {
      let eligible = true;
      if (type === "user.peer") {
        eligible = isDelegateReport(msg, instanceId, instances);
      }
      if (eligible) {
        const peerSession = msg.metadata?.peerSession;
        if (peerSession) {
          suppressedAsDelegateTraffic = messages.some(
            (m) =>
              (m.type === "tool.handoff" || m.type === "tool.use") &&
              // biome-ignore lint/suspicious/noEqualsToNull: `!==` alone would let `undefined` (no metadata at all) through — this must reject both null and missing
              m.metadata?.delegateInstanceId != null &&
              matchesSession(peerSession, m.metadata.delegateInstanceId)
          );
        }
      }
    }

    // ── followUpLabel ────────────────────────────────────────────
    if (type === "tool.handoff" && msg.metadata?.handoffKind !== "delegate") {
      const row = delegateOf(String(msg.content), instanceId, instances);
      if (row) {
        const name = row.cwd.split("/").filter(Boolean).pop() ?? row.cwd;
        followUpLabel = `${name}#${row.id.slice(0, 8)}`;
      }
    }

    // ── briefParent ──────────────────────────────────────────────
    if (type === "user.peer" && !msg.metadata?.reportKind) {
      const row = instances.find(
        (r) => r.id === (instanceId || msg.instanceId)
      );
      if (row?.parentInstanceId) {
        const parent = instances.find((r) => r.id === row.parentInstanceId);
        if (parent) {
          const sender = msg.metadata?.peerSession ?? msg.metadata?.peerFrom;
          const parentLeaf =
            parent.cwd.split("/").filter(Boolean).pop() ?? parent.cwd;
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
    if (type === "user.peer") {
      if (briefParent) {
        peerSenderModel = briefParent.model ?? null;
      } else {
        const sender = msg.metadata?.peerSession ?? msg.metadata?.peerFrom;
        if (sender) {
          const row = instances.find((r) => matchesSession(sender, r.id));
          peerSenderModel = row?.model ?? null;
        }
      }
    }

    // ── suppressedAsTaskEcho ─────────────────────────────────────
    if (
      type === "ui.system_note" &&
      msg.metadata?.noteKind === "Task notification"
    ) {
      const toolId = msg.metadata?.noteTaskToolId;
      if (toolId) {
        suppressedAsTaskEcho = Boolean(subagents[toolId]);
      }
    }

    // ── sources ──────────────────────────────────────────────────
    if (type === "assistant") {
      sources = sourcesForMessage(messages, i);
    }

    // ── sessionHref ─────────────────────────────────────────────
    // A report names its delegate, a hand-off its target. A stored transcript
    // keeps only the short id, so it resolves against the fleet's live rows.
    if (type === "user.peer") {
      const sender = msg.metadata?.peerSession ?? msg.metadata?.peerFrom;
      const resolved = resolveInstanceId(sender, instances);
      sessionHref = resolved ? `/session/${resolved}` : null;
    } else if (type === "tool.handoff") {
      const full = msg.metadata?.delegateInstanceId;
      if (typeof full === "string") {
        sessionHref = `/session/${full}`;
      } else {
        const short = TRAILING_INSTANCE_ID.exec(
          String(msg.content ?? "").trim()
        );
        const resolved = short
          ? resolveInstanceId(short[1], instances)
          : undefined;
        sessionHref = resolved ? `/session/${resolved}` : null;
      }
    }

    map.set(messageId, {
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
