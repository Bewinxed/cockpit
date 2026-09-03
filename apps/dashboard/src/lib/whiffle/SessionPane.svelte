<script lang="ts">
  import type {
    EffortLevel,
    HarnessKind,
    PermissionMode,
    PermissionResult,
    SessionMessage,
  } from "@whiffle/core";
  /**
   * One conversation, whole: the identity header, the transcript (Chat) or its
   * graph (Flow), and the floating composer with any parked permission or
   * question stacked above it. Held per open tab by the session layout, so its
   * scroll offset and half-typed message survive a switch — nothing here
   * unmounts on navigation.
   */
  import { untrack } from "svelte";
  import type { TransitionConfig } from "svelte/transition";
  import { page } from "$app/state";
  import FlowView from "$lib/components/features/flow/FlowView.svelte";
  import AutopilotToggle from "./AutopilotToggle.svelte";
  import {
    blankSession,
    clearReadFault,
    clearRestore,
    commandRecord,
    ensureAlive,
    type HistorySource,
    interrupt,
    latestCommandFor,
    loadCommands,
    loadMcpServers,
    openSession,
    type PendingPermission,
    pendingRestore,
    relaunchSession,
    type SendExtras,
    type SessionState,
    sendFailureNotice,
    streamCapable,
    streamHistory,
    submitCommand,
    whiffle,
  } from "./client.svelte";
  import { effortStops, hasEffortScale } from "./effort-levels";
  import { mapTranscript, routedToParent } from "./frames";
  import { delegateHandle } from "./links";
  import { covers, ensureModels, models } from "./models.svelte";
  import { PERMISSION_MODES } from "./permission-modes";
  import { sessionName } from "./session-name";
  // StaticTail removed — virtua's ssrCount renders the tail directly.
  import Composer, { type Mention } from "./transcript/Composer.svelte";
  import Prompt from "./transcript/Prompt.svelte";
  import SessionHeader, {
    type SettingChange,
  } from "./transcript/SessionHeader.svelte";
  import Transcript from "./transcript/Transcript.svelte";
  import TranscriptSkeleton from "./transcript/TranscriptSkeleton.svelte";

  let {
    viewId,
    browsing,
    browsingCwd,
    browsingHarness,
    visible,
    focused,
    serverTail = null,
    serverHistory = null,
    hideHeader = false,
    view = "chat" as "chat" | "flow",
    onview = (() => {
      // No parent listening — chat/flow toggling is a no-op until one binds.
    }) as (v: "chat" | "flow") => void,
  }: {
    viewId: string;
    browsing: string | null;
    browsingCwd: string;
    browsingHarness: string;
    /** Whether this pane is on screen at all — governs row building. */
    visible: boolean;
    /**
     * Whether this pane is the one being worked in. Defaults to `visible`,
     * so a single-pane layout behaves exactly as it always has.
     */
    focused?: boolean;
    /**
     * The newest turns the SERVER read back, handed down by value.
     *
     * This used to be claimed from `page.data` under a `page.params.id ===
     * viewId` guard — which only worked while the URL was the thing that
     * decided which conversation was on screen. It no longer is. The layout
     * captures the page's data once per real navigation and gives it to the
     * one pane it was loaded for; every other pane reads its transcript over
     * the socket, exactly as a background tab always did.
     */
    serverTail?: unknown;
    /** Where the server said this conversation's transcript can be read from. */
    serverHistory?: Promise<HistorySource | null> | null;
    /** When true, the SessionHeader is not rendered (a shared header is drawn by the parent). */
    hideHeader?: boolean;
    /** Which view to show: chat transcript or flow graph. Managed by parent. */
    view?: "chat" | "flow";
    /** Called when the user toggles between chat and flow. */
    onview?: (v: "chat" | "flow") => void;
  } = $props();

  /** The newest turns the server read back, and the identity that names them. */
  interface ServerTail {
    cwd: string;
    harness: string;
    machineId: string;
    messages: SessionMessage[];
    sessionId: string;
    viewId: string;
  }

  /** Why this pane has nothing to show, when it has nothing to show. */
  let failure = $state<{
    reason: "offline" | "failed";
    message: string;
  } | null>(null);
  /** The hub answered 404: no row, no stored file, no machine that knows the id. */
  let missing = $state(false);
  /** The read finished, cleanly, with nothing in it — a transcript with no turns yet. */
  let empty = $state(false);
  /** Bumped by Retry: the one thing that re-runs the read after it has failed. */
  let attempt = $state(0);

  /**
   * Whether the hub holds this id as a running session. This, not the tab's
   * remembered context, is what decides the tense of the read: a live session
   * is subscribed to and its frames reconciled behind the history; a stored one
   * is only read. The old `browsing === null` test stood in for it and was
   * wrong for every live session opened from the sidebar, which arrived with a
   * context and so was never opened at all.
   */
  const isLive = $derived(whiffle.instances.some((row) => row.id === viewId));

  /**
   * Where the server said this conversation's transcript can be read from —
   * streamed with the page, so it is in hand before the socket is. The layout
   * hands it to the pane this navigation actually loaded; the others are open
   * tabs, not this navigation, and read over the socket instead.
   */
  const history = $derived<Promise<HistorySource | null> | null>(serverHistory);

  /**
   * Reads a conversation's history: one read, addressed by the id alone.
   *
   * The hub resolves the id — a live row to its SDK key, anything else to
   * whichever machine holds the file — so there is no stored read to try
   * first and no live read to fall back to. What used to be two reads and a
   * fleet-wide locate was also two chances to end with nothing in flight and
   * nothing on screen; now every way this ends is a named state.
   *
   * `source` is the server's descriptor when this pane is the one the URL
   * loaded, and carries the only thing the id does not say: a location
   * spelled out by an old link, sent to the hub as an override.
   */
  async function readHistory(
    id: string,
    source: Promise<HistorySource | null> | null,
    hint: { machineId: string; cwd: string; harness: string } | null,
    running: boolean
  ): Promise<void> {
    const named = await source;
    const outcome = await streamHistory(
      named && named.viewId === id
        ? { ...named, live: named.live || running }
        : {
            viewId: id,
            machineId: hint?.machineId ?? "",
            // The rail row's real SDK key when it has one — never the view id
            // itself, and nothing at all when the row has not named one yet.
            // The store adopts this sessionId, and any later
            // revive/relaunch/rewind re-sends it as the resume key; an
            // instance id there becomes a bogus handle the hub then cements
            // into the row permanently. The read's own header names the key
            // when this is blank; the id tail stays for the read, which the
            // hub resolves on its own.
            sessionId:
              whiffle.instances.find((row) => row.id === id)?.sessionId ??
              undefined,
            cwd: hint?.cwd ?? "",
            harness: hint?.harness as never,
            live: running,
          }
    );
    if (!outcome.ok) {
      // 404 is an answer, not a fault: nothing the hub or any machine holds
      // goes by this id. Retrying would ask the same question.
      if (outcome.status === 404) {
        missing = true;
      } else {
        failure = { reason: outcome.reason, message: outcome.message };
      }
      return;
    }
    // Skipped means another read already holds this view; its outcome is the
    // one that counts, and this one has nothing to say about emptiness.
    if (outcome.skipped) {
      return;
    }
    // A clean read of nothing. For a running session that is a conversation
    // that has not started, and the stream will say so when it does; for a
    // stored one it is the whole answer, and the skeleton would otherwise
    // wait for turns that are never coming.
    if (!running && (whiffle.session(id)?.messages.length ?? 0) === 0) {
      empty = true;
    }
  }

  // Bring the conversation into being: a stored session reads its transcript
  // back, a live one is opened (subscribed) and read back to what it said
  // before this tab joined.
  //
  // Deliberately untracked around the store. Both calls read AND write the
  // session's own `messages` / `loading`, so a plainly-tracked effect re-runs
  // itself on the transcript it just published; the URL this pane was opened
  // with, whether the hub holds it live, plus an explicit retry, are the only
  // things that should start a read.
  $effect(() => {
    const id = viewId;
    const cwd = browsingCwd;
    const harness = browsingHarness;
    const hint = browsing ? { machineId: browsing, cwd, harness } : null;
    const running = isLive;
    // biome-ignore lint/complexity/noVoid: read-only dependency — Retry bumps `attempt` purely to re-run this effect
    void attempt;
    if (!id) {
      return;
    }
    // Retry the read once the hub can actually answer. On a reload the effect
    // first runs while the socket is still reconnecting — a live session's
    // machineId isn't known yet and a stored read can't reach the socket.
    // Tracking the connection and the live session's machineId (neither
    // written by the read below) re-runs this the moment it becomes
    // answerable, so the transcript reads back instead of staying empty.
    // biome-ignore lint/complexity/noVoid: read-only dependency — re-runs this effect once the hub or the session's machineId become known, per the comment above
    void whiffle.status;
    // biome-ignore lint/complexity/noVoid: read-only dependency — re-runs this effect once the hub or the session's machineId become known, per the comment above
    void whiffle.session(id)?.machineId;
    untrack(() => {
      failure = null;
      missing = false;
      empty = false;
      // A running session is opened — hydrated from its row and subscribed to
      // — on every pass, and ahead of the guard below: the guard skips a pane
      // whose read landed before the hub's rows arrived, and that pane would
      // otherwise never subscribe. Opening is idempotent; reading is not.
      if (running || !hint) {
        openSession(id);
      }
    });
    // A pane the reader RETURNS to needs no re-read: the store kept ingesting
    // while the tab was hidden (only the transcript's row-building froze), so
    // re-reading replaced a full transcript with the tail chunk — content
    // collapsed, scrollTop clamped, the view lurched, and the follow rode the
    // rebuild. That was the tab-switch scroll hijack. On a stream-capable hub
    // the stream heals any gap on its own; on a legacy hub the re-read stays,
    // because there a reconnect really can have dropped frames on the floor.
    const held = whiffle.session(id);
    if (held?.initialized && held.messages.length > 0 && streamCapable()) {
      return;
    }
    // The server's answer for whichever conversation the URL names; a pane the
    // reader left open in another tab was never part of this navigation and
    // is read by its id like any other.
    const named = history;
    untrack(() => {
      // biome-ignore lint/complexity/noVoid: fire-and-forget inside untrack — readHistory reports its outcome through the store fields this effect reads
      void readHistory(id, named, hint, running);
    });
  });

  /**
   * The newest turns, read at render time and shipped with the page. This is
   * what the SERVER paints: without it the first response carried an empty pane
   * and the conversation only appeared once the bundle had hydrated and the
   * stream had answered. Claimed by the pane the URL names, exactly as the
   * history descriptor above is.
   */
  const tail = $derived((serverTail as ServerTail | null) ?? null);

  /**
   * The conversation as a session, built from the page's own data.
   *
   * The whiffle store is a module singleton, so on the server it is shared by
   * every request — filling it in during a render would hand one reader's
   * transcript to the next. Nothing here touches it: this is request-local, it
   * renders the server's HTML and the client's first (hydrating) render, and it
   * is dropped the moment the real store session carries the conversation.
   */
  const seeded = $derived.by<SessionState | null>(() => {
    // Nothing read back means nothing to stand in for: the store's own empty
    // and loading states are better than a blank pane pretending to be one.
    // tail may be a deferred placeholder during SSR streaming (no .messages yet).
    if (!tail || tail.viewId !== viewId || tail.messages.length === 0) {
      return null;
    }
    const blank = blankSession(viewId);
    const mapped = mapTranscript(viewId, tail.messages);
    blank.machineId = tail.machineId;
    blank.cwd = tail.cwd;
    blank.sessionId = tail.sessionId ?? null;
    blank.harness = tail.harness as HarnessKind;
    blank.messages = mapped.messages;
    blank.subagents = mapped.subagents;
    blank.initialized = mapped.messages.length > 0;
    return blank;
  });

  /**
   * Whether the live store has taken this conversation over. A one-way latch:
   * the store session exists from the first effect (empty), and swapping to it
   * then would blank the transcript the server just painted. It earns the pane
   * once it has something to show — history read back, a turn in flight, or a
   * permission waiting.
   */
  let live = $state(false);
  $effect(() => {
    const held = whiffle.session(viewId);
    if (!held) {
      return;
    }
    if (held.messages.length > 0 || held.busy || held.pending.length > 0) {
      live = true;
    }
  });

  const session = $derived(live || !seeded ? whiffle.session(viewId) : seeded);
  const machineId = $derived(whiffle.session(viewId)?.machineId ?? "");

  /**
   * Whether the virtualized transcript may be shown.
   *
   * `live` above is the moment the STORE has the conversation, which is several
   * frames before the transcript can draw it: virtua mounts, measures its rows
   * (the scroll height doubles as it goes), and only then scrolls home. Swapping
   * on `live` alone therefore replaced the server's painted tail with a column
   * that was still being measured — a blank content area for those frames.
   *
   * So the two are handed over instead of swapped. The static tail stays on
   * screen, the transcript mounts *behind* it under `visibility: hidden` (which
   * still lays out and measures, unlike `display: none`), and this flips the
   * instant `Transcript` says it has landed. Both boxes are the same rect by the
   * `.tr` padding contract, so the flip moves nothing — and because it is one
   * assignment, the two are never both painted.
   */
  // No standin, no veil, no handover. The transcript renders directly from
  // the seeded session (server tail) on SSR via virtua's `ssrCount`, then
  // switches to live data when the WS delivers. Virtua owns the DOM from
  // the first frame — its SSR support renders the tail items as real DOM
  // nodes that hydrate in place.

  /**
   * A session the hub could not find anywhere: not in its rows, not in its
   * store, not on any machine it asked. There is nothing to subscribe to and
   * nothing to read back, so the pane says so instead of sitting empty. This
   * used to be inferred from a blank `machineId` once the rows had arrived,
   * which mistook every stored session still being located for a lost one;
   * now it is the hub's own 404.
   */
  const unaddressable = $derived(missing);

  /**
   * A stored transcript with no machine behind it: readable, not writable.
   *
   * A pane that had its history but no `machineId` used to render a live
   * composer — one that took keystrokes, refused them at the `!machineId`
   * guard, and said nothing. A transcript with words in it should still be
   * read; it just cannot be written to.
   */
  const readOnly = $derived(
    !isLive && !!session && !session.machineId && session.messages.length > 0
  );

  /**
   * What stopped the transcript arriving, from whichever side saw it. The
   * pane's own read reports through `failure`; a read the store started for
   * itself — a socket backfill, a peek — reports through the session's
   * `readFault`. Either one is a card with a button, never a skeleton.
   */
  const fault = $derived(failure ?? session?.readFault ?? null);

  /** Try again: forget what was said about the last read, then read. */
  function retry(): void {
    clearReadFault(viewId);
    attempt += 1;
  }

  // The header's MCP count wants a reading, and the composer's `/` menu wants
  // the descriptions; only a live session answers either.
  //
  // Untracked around the store, for the same reason the read effect above is:
  // both loaders read their own `commandsPending` / mcp guard AND write it, so a
  // plainly-tracked effect takes those flags as dependencies and re-runs itself
  // the instant the call it just fired flips them — on a session that can't
  // answer, the rejection clears the guard and the effect re-fires in a tight
  // loop (thousands of `supportedCommands … failed` a second). Only a change in
  // whether this pane addresses a live session, or the hub becoming reachable,
  // should start a load: a first run before the socket opens is refused, and
  // the MCP ask keeps that refusal as `[]`. `isLive` is the board's notion —
  // a sleeping row is on the board too — and a sleeping session has no process
  // to ask, so the gate is the running list.
  $effect(() => {
    const liveForCommands =
      !!session &&
      whiffle.runningInstances.some((row) => row.id === viewId) &&
      !!machineId &&
      whiffle.status === "connected";
    if (!liveForCommands) {
      return;
    }
    const id = viewId;
    const mid = machineId;
    untrack(() => {
      // biome-ignore lint/complexity/noVoid: fire-and-forget inside untrack — each loader tracks its own pending guard
      void loadMcpServers(id, mid);
      // biome-ignore lint/complexity/noVoid: fire-and-forget inside untrack — each loader tracks its own pending guard
      void loadCommands(id, mid);
    });
  });

  const HARNESS_LABEL: Record<string, string> = {
    claude: "Claude Code",
    opencode: "opencode",
    code: "opencode",
    pi: "pi",
  };
  const agentName = $derived(
    HARNESS_LABEL[session?.harness ?? ""] ?? session?.harness ?? "Agent"
  );

  const machineName = $derived(
    whiffle.machines.find((m) => m.machineId === machineId)?.hostname ??
      machineId
  );

  /**
   * What this conversation is called. The same helper the tab strip uses, so
   * the tab and the bar under it are never naming two different sessions.
   */
  const servedNames = $derived(
    (page.data as { names?: Record<string, string> }).names ?? {}
  );
  const title = $derived(sessionName(viewId, servedNames, browsingCwd).label);

  const stats = $derived(whiffle.statsOf(viewId));
  const activity = $derived(whiffle.activityOf(viewId));
  const instanceRow = $derived(whiffle.instances.find((i) => i.id === viewId));

  // The session settings — model, permission mode, effort — are switchable from
  // the header now, so the same reference data the spawn form uses is derived
  // here and the store setters are the exact desktop path a change takes.
  const machineRow = $derived(
    whiffle.machines.find((m) => m.machineId === machineId) ?? null
  );
  const harnessReport = $derived(
    machineRow?.harnesses?.find(
      (report) => report.harness === session?.harness
    ) ?? null
  );
  /** The permission modes this session's harness can honour; empty hides the picker. */
  const offeredModes = $derived(
    harnessReport
      ? PERMISSION_MODES.filter((mode) =>
          harnessReport.capabilities.permissionModes.includes(mode.value)
        )
      : PERMISSION_MODES
  );
  /** The offered row for the model in force, which is what carries its scale. */
  const chosenModel = $derived.by(() => {
    const model = session?.model;
    if (!model) {
      return null;
    }
    return models.offered.find((row) => covers(row, model)) ?? null;
  });
  /** Whether the harness runs at an effort at all — the row is named either way. */
  const harnessEffort = $derived(harnessReport?.capabilities.effort !== false);
  /** Only drawn when the harness and the model both report an effort scale. */
  const showEffort = $derived(harnessEffort && hasEffortScale(chosenModel));
  const effortStopsForModel = $derived(effortStops(chosenModel));

  // Populate the model list so the effort scale can be read even before the
  // picker is opened; a session with nothing to ask just leaves it empty. One
  // attempt per session coming up, and on nothing else: the store's own reads
  // are untracked so a failed ask cannot re-run this.
  $effect(() => {
    // biome-ignore lint/complexity/noVoid: read-only dependency — re-runs once per change in how many sessions are running
    void whiffle.runningInstances.length;
    untrack(ensureModels);
  });

  /** What `@` can name: the other conversations in the strip, and the machines. */
  const mentions = $derived<Mention[]>([
    ...whiffle.instances
      .filter((row) => row.id !== viewId)
      .slice(0, 40)
      .map((row) => ({
        handle: delegateHandle(row),
        label: delegateHandle(row),
        detail: row.title?.trim() || row.cwd,
      })),
    ...whiffle.machines.map((machine) => ({
      handle: machine.hostname || machine.machineId,
      label: machine.hostname || machine.machineId,
      detail: machine.status,
    })),
  ]);

  const commands = $derived(whiffle.commandsOf(viewId));

  /**
   * Every operator action on this conversation goes out as ONE tracked command
   * and reports back the id its stages are readable under. Nothing here wraps a
   * promise to invent a state: what the header, the cards and the composer draw
   * is the tracker's own account of the action, on both the stream path and the
   * legacy one (where the same calls run and their promises are the stages).
   */
  function onmodel(model: string): SettingChange {
    if (!machineId) {
      return null;
    }
    return submitCommand(viewId, machineId, "set-model", { model });
  }

  function onpermission(mode: PermissionMode): SettingChange {
    if (!machineId) {
      return null;
    }
    // bypassPermissions is a launch decision the SDK refuses to switch into, so
    // that one mode relaunches the session in place; the rest switch live. A
    // relaunch is a different operation on the wire, not a `set-permission-mode`
    // command, so it stays its own call and hands the header its promise —
    // sending it as that command would put the call the SDK refuses on the wire.
    if (mode === "bypassPermissions") {
      return relaunchSession(viewId, machineId, mode);
    }
    return submitCommand(viewId, machineId, "set-permission-mode", { mode });
  }

  function oneffort(level: EffortLevel): SettingChange {
    if (!machineId) {
      return null;
    }
    return submitCommand(viewId, machineId, "set-effort", { effort: level });
  }

  /**
   * A parked request's answer, as a command. The id goes back to the card that
   * asked, which is the only thing that reads it: several cards can be parked
   * at once and they all answer in the same kind.
   */
  function onanswer(
    request: PendingPermission,
    result: PermissionResult
  ): string | null {
    if (!machineId) {
      return null;
    }
    return submitCommand(request.instanceId, machineId, "permission.answer", {
      requestId: request.requestId,
      result,
    });
  }

  // A delegate's ask belongs to its parent, never the reader's queue.
  const parked = $derived<PendingPermission[]>(
    (session?.pending ?? []).filter((p) => !routedToParent(p))
  );

  let draft = $state("");
  /** The composer instance, for the one thing a binding cannot hand back. */
  let composer = $state<ReturnType<typeof Composer> | null>(null);

  /** What the live region says, when a send of this session's has failed. */
  const sendFailure = $derived(sendFailureNotice(viewId));

  /**
   * "Edit" on a message that never sent: the store parks the whole payload in
   * this session's restore slot and the pane spends it here — text into the
   * draft the composer is bound to, attachments into the composer itself. The
   * row offering Edit is two components away from `draft`, so the store is the
   * channel; this is the far end of it.
   */
  $effect(() => {
    const slot = pendingRestore(viewId);
    if (!slot) {
      return;
    }
    const id = viewId;
    untrack(() => {
      draft = slot.text;
      composer?.restore(slot.extras);
      clearRestore(id);
    });
  });

  /**
   * How tall the floating composer column actually is, measured by the composer
   * itself. The bare input is ~50px; a parked permission stacks above it and can
   * stand several hundred. Published to the body as `--composer-clearance` — the
   * measured height plus the column's bottom offset and one more step of
   * breathing room — which is what the transcript reserves at its foot, so the
   * row that raised a permission is never the row the permission covers.
   */
  let composerHeight = $state(0);

  const flowSubagents = $derived(
    new Map(Object.entries(session?.subagents ?? {}))
  );

  /**
   * The gap in front of the send command: a dead session is revived before the
   * message goes out, and until it does there is no record to read a stage
   * from. Without this the composer would take a second Enter during the revive
   * and send the same thing twice.
   */
  let reviving = $state(false);

  /** Whether this session's last message is out of this tab but not yet taken. */
  const sending = $derived(
    reviving || latestCommandFor(viewId, "send")?.stage === "submitted"
  );

  function onsubmit(text: string, extras: SendExtras = {}): void {
    if (!machineId) {
      // A tripwire, not a guard anybody should hit: a pane with no machine
      // renders no composer at all. A render race can still land one keystroke
      // here, so it stays — but loud in development, because the whole point of
      // this change is that a typed sentence never disappears without a word.
      if (import.meta.env.DEV) {
        console.warn("composer rendered without a machine", viewId);
      }
      return;
    }
    if (sending) {
      return;
    }
    const mid = machineId;
    reviving = true;
    // A message to a dead session revives it first. A revive that FAILS no
    // longer swallows the message: the send is submitted either way, and the
    // hub's own refusal ("machine X is not connected") becomes the command's
    // failed stage. The ledger is the report — which is why there is nothing
    // to catch here, and why the `.catch(() => {})` that used to sit on this
    // chain (and ate every send made from a plain-http origin) is gone.
    const submit = () => submitCommand(viewId, mid, "send", { text, extras });
    // biome-ignore lint/complexity/noVoid: fire-and-forget by intent — the command tracker (submit) is the report, per the comment above
    void ensureAlive(viewId, mid)
      .then(submit, submit)
      .finally(() => {
        reviving = false;
      });
  }

  /**
   * The queue-jump the shortcut sheet has promised all along (mod+Enter,
   * "Interrupt and send"): stop the turn in flight, then send — "do this
   * INSTEAD", where plain Enter's queue is "do this next". Two tracked
   * commands, deliberately: the interrupt's local half drops the working pill
   * at once, the send's echo renders at once, and any gap between the turn
   * dying and the message being taken is narrated by the queued row rather
   * than guessed at. On an idle session it is exactly a send.
   */
  function oninterruptsend(text: string, extras: SendExtras = {}): void {
    if (!machineId || sending) {
      return;
    }
    if (session?.busy) {
      submitCommand(viewId, machineId, "interrupt", {});
    }
    onsubmit(text, extras);
  }

  function onstop(): void {
    // Through the tracker, not the bare legacy call: the record it leaves is
    // how the transcript recognises the coming `result.error` as the receipt
    // of THIS stop and renders "Interrupted" instead of a failure card.
    if (machineId) {
      submitCommand(viewId, machineId, "interrupt", {});
    }
  }

  /* ---- the parked prompt's exit --------------------------------------- */

  const reduceMotionQuery =
    typeof window === "undefined"
      ? null
      : window.matchMedia("(prefers-reduced-motion: reduce)");

  /**
   * `cubic-bezier(x1, y1, x2, y2)` as a JS easing, so a Svelte transition rides
   * the exact curve the CSS token names rather than a look-alike from
   * `svelte/easing`. Svelte samples the `css` function through this and bakes
   * linear keyframes, so the curve has to live here to survive the trip.
   */
  function cubicBezier(
    x1: number,
    y1: number,
    x2: number,
    y2: number
  ): (t: number) => number {
    const at = (a: number, b: number, t: number): number =>
      3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t ** 2 * b + t ** 3;
    return (t) => {
      // Newton–Raphson for the parameter whose x is t, then read that point's y
      // — the same solve the compositor does for a CSS timing function.
      let g = t;
      for (let i = 0; i < 8; i += 1) {
        const err = at(x1, x2, g) - t;
        const slope =
          3 * (1 - g) ** 2 * x1 +
          6 * (1 - g) * g * (x2 - x1) +
          3 * g ** 2 * (1 - x2);
        if (Math.abs(err) < 1e-5 || slope === 0) {
          break;
        }
        g -= err / slope;
      }
      return at(y1, y2, g);
    };
  }

  /** --e-out, the doctrine's exit curve. */
  const easeOut = cubicBezier(0.7, 0, 0.84, 0);

  /**
   * An answered prompt leaves DOWNWARD and fast — it is dismissed, not
   * withdrawn upward toward the transcript it came from — at 120ms on --e-out,
   * because an exit that takes as long as its entrance reads as hesitation.
   *
   * Only opacity and transform move: the card holds its box for the whole
   * 120ms, so the cards below it do not creep during the flight and the
   * composer's measured height (and with it `--composer-clearance`) settles in
   * one step when the node is actually gone. Under reduced motion the node is
   * simply removed.
   */
  function promptExit(_node: Element): TransitionConfig {
    if (reduceMotionQuery?.matches) {
      return { duration: 0 };
    }
    return {
      duration: 120,
      easing: easeOut,
      css: (t, u) => `opacity: ${t}; transform: translateY(${u * 4}px);`,
    };
  }
</script>

<div class="pane">
  {#if session}
    {#if !hideHeader}
      <SessionHeader
        {activity}
        cost={stats.cost}
        cwd={session.cwd || browsingCwd}
        effort={session.effort}
        effortStops={effortStopsForModel}
        harness={session.harness}
        {harnessEffort}
        {machineName}
        maxTokens={stats.maxTokens}
        mcpCount={session.mcp?.length ?? null}
        model={session.model}
        {offeredModes}
        {oneffort}
        {onmodel}
        {onpermission}
        {onview}
        permissionMode={session.permissionMode}
        seed={session.cwd || browsingCwd || viewId}
        {showEffort}
        streaming={streamCapable()}
        {title}
        totalTokens={stats.totalTokens}
        trackedCommand={commandRecord}
        turns={stats.turns}
        {view}
      />
    {/if}

    <div
      class="body"
      style="--composer-clearance: calc({composerHeight}px + var(--space-4) + var(--space-4))"
    >
      <!-- The transcript area. Movement between conversations is owned by the
           pane above this one, so nothing here animates on a switch — this is
           the surface a swipe carries, not the thing that carries it. -->
      <div class="transcript-slide">
        {#if fault}
          <div class="stateful">
            <h2>
              {fault.reason === 'offline'
                ? 'This machine is offline'
                : "This transcript couldn't be read"}
            </h2>
            <p>{fault.message}</p>
            <button onclick={retry} type="button">Try again</button>
          </div>
        {:else if unaddressable}
          <div class="stateful">
            <h2>This session isn't reachable from here</h2>
            <p>
              The hub has no record of <code>{viewId}</code>, and no machine it
              can reach has a transcript filed under it. It may live on a
              machine that is offline, or it may have been deleted.
            </p>
            <a href="/session">Back to the fleet</a>
          </div>
        {:else if empty && session.messages.length === 0}
          <div class="stateful">
            <h2>Nothing has been said here yet</h2>
            <p>The transcript was found, and it has no turns in it.</p>
          </div>
        {:else if !session.initialized && session.messages.length === 0}
          <TranscriptSkeleton />
        {:else if view === 'flow'}
          <FlowView
            instanceId={viewId}
            messages={session.messages}
            streamingToolId={session.currentTool?.toolId}
            subagents={flowSubagents}
            totalCostUsd={session.totalCost}
          />
        {:else}
          <Transcript
            {agentName}
            cwd={session.cwd || browsingCwd}
            {focused}
            {machineName}
            {session}
            {visible}
          />
        {/if}
      </div>

      <!-- Composer stays outside the slide — it's shared structure. -->
      {#if !fault && (unaddressable || readOnly)}
        <p class="readonly">
          This transcript is stored; the session isn't reachable from here.
        </p>
      {:else if !fault}
        <Composer
          busy={session.busy}
          {commands}
          {mentions}
          {oninterruptsend}
          {onstop}
          {onsubmit}
          {sending}
          bind:this={composer}
          bind:height={composerHeight}
          bind:value={draft}
        >
          {#snippet leading()}
            <AutopilotToggle instance={instanceRow} instanceId={viewId} />
          {/snippet}
          {#snippet prompts()}
            {#each parked as request (request.requestId)}
              <div class="parked" out:promptExit>
                <Prompt
                  onanswer={(result) => onanswer(request, result)}
                  {request}
                />
              </div>
            {/each}
          {/snippet}
        </Composer>
      {/if}

      <p aria-live="polite" class="announce" role="status">{sendFailure}</p>
    </div>
  {:else}
    <!-- No session in the store yet: the same placeholder the transcript
         area shows, so the two loading moments look like one. -->
    <TranscriptSkeleton />
  {/if}
</div>

<style>
  /* Announced, never drawn: the live region carries the failure to a screen
     reader while the row itself carries it to everyone else. */
  .announce {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
    border: 0;
  }

  /* The composer's slot, when there is no composer. Sits where the input would,
     in the muted voice of something stating a fact rather than refusing one. */
  .readonly {
    margin: 0 auto var(--space-4);
    padding: var(--space-2) var(--space-3);
    color: var(--ink-muted);
    font-size: var(--text-xs);
    text-align: center;
  }

  .pane {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
    background: var(--surface-field);
  }
  .body {
    position: relative;
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-height: 0;
  }

  /* ── Transcript slide ─────────────────────────────────────────────
     Only the transcript area slides on tab switch. Header and composer
     stay put. The entering transcript slides in from the tab direction,
     the exiting one slides out the opposite way. */
  .transcript-slide {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-height: 0;
    overflow: hidden;
  }

  /**
   * The handover. The transcript is IN FLOW the whole time — it is the thing
   * that stays — so revealing it moves nothing; it is merely unpainted while it
   * measures. The server's tail is the one lifted out of flow and laid over it,
   * because both want to be `.body`'s whole box and two in-flow flex children
   * would take half each.
   */
  /* No standin — virtua renders the tail directly via ssrCount. */

  /* A named state, not an empty pane: what happened, in one line, and the one
     thing that can be done about it. */
  .stateful {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-3);
    max-width: 46ch;
    margin: auto;
    padding: var(--space-6);
  }
  .stateful h2 {
    font-size: var(--text-md);
    font-weight: var(--weight-strong);
    letter-spacing: var(--track-display);
    color: var(--ink-strong);
  }
  .stateful p {
    font-size: var(--text-base);
    line-height: var(--leading-body);
    color: var(--ink-muted);
  }
  .stateful code {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
  }
  .stateful button,
  .stateful a {
    height: 34px;
    padding: 0 var(--space-4);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    background: var(--surface-raised);
    color: var(--ink-body);
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
    display: inline-grid;
    place-items: center;
    text-decoration: none;
    cursor: pointer;
    transition:
      background-color var(--c-100) var(--e-in),
      transform var(--c-100) var(--e-in);
  }
  @media (hover: hover) and (pointer: fine) {
    .stateful button:hover,
    .stateful a:hover {
      background: var(--surface-hover);
    }
  }
  .stateful button:active,
  .stateful a:active {
    transform: scale(0.96);
  }
  @media (pointer: coarse) {
    .stateful button,
    .stateful a {
      height: 44px;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .stateful button,
    .stateful a {
      transition: none;
    }
    .stateful button:active,
    .stateful a:active {
      transform: none;
    }
  }
</style>
