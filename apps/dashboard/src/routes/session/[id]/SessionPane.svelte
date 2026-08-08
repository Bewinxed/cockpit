<script module lang="ts">
  /**
   * Where each session was left, and whether it was left at the live edge.
   *
   * Module level, so a tab closed and opened again comes back where it was: the
   * pane itself is gone by then. A number alone is not enough — a transcript
   * left following its own output has to resume following it, not be pinned to
   * the pixel it happened to be at.
   */
  const scrollMemory = new Map<string, { top: number; atBottom: boolean }>();

  /** What was typed into each session's composer and not sent. */
  const drafts = new Map<string, string>();
</script>

<script lang="ts">
  import {
    IconArrowDown,
    IconChat,
    IconCheck,
    IconFlow,
    IconFork,
    IconPlay,
    IconSpinner,
    IconStop,
    IconSubagent,
    IconTools,
    IconTrash,
  } from '$lib/icons';
  import { toast } from 'svelte-sonner';
  import type { Component } from 'svelte';
  import { onMount, tick, untrack } from 'svelte';
  import { Markdown } from '$lib/components/ui/markdown';
  import { smoothText } from '$lib/utils/smooth-text.svelte';
  import { fly } from 'svelte/transition';
  import { quintOut } from 'svelte/easing';
  import { MediaQuery } from 'svelte/reactivity';
  import { Virtualizer } from 'virtua/svelte';
  import type { VirtualizerHandle } from 'virtua/svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import type { PermissionMode, PermissionResult } from '@cockpit/core';
  import {
    ChatInput,
    ChatMessage,
    SubagentBranch,
    ToolGroup,
    TranscriptSearch,
  } from '$lib/components/features';
  import { FlowView } from '$lib/components/features/flow';
  import ModelCombobox from '$lib/cockpit/ModelCombobox.svelte';
  import ContextMeter from '$lib/cockpit/ContextMeter.svelte';
  import { targetsFrom, type PeerTarget } from '$lib/cockpit/peer';
  import { swipeBetween } from '$lib/cockpit/swipe';
  import MachineLogin from '$lib/cockpit/MachineLogin.svelte';
  import { workingSet } from '$lib/cockpit/working-set.svelte';
  import ActivityDot from '$lib/cockpit/ActivityDot.svelte';
  import McpChips from '$lib/cockpit/McpChips.svelte';
  import SessionContext from '$lib/cockpit/SessionContext.svelte';
  import SessionContextButton from '$lib/cockpit/SessionContextButton.svelte';
  import PermissionStack from '$lib/cockpit/PermissionStack.svelte';
  import { questionsOf } from '$lib/cockpit/question';
  import { ACTIVITY_LABEL } from '$lib/cockpit/activity';
  import { sessionTitle } from '$lib/cockpit/links';
  import type {
    InstanceRow,
    PendingPermission,
    PermissionAnswer,
  } from '$lib/cockpit/client.svelte';
  import {
    backfillSession,
    cockpit,
    discardSession,
    ensureAlive,
    forkSession,
    interrupt,
    isResumable,
    keepSession,
    loadCommands,
    loadMcpServers,
    openSession,
    openTranscript,
    permissionAnswer,
    refreshContext,
    relaunchSession,
    resolvePermission,
    resumeSession,
    peerTargets,
    sendToPeer,
    sendOrRevive,
    setModel,
    setPermissionMode,
    stopSession,
  } from '$lib/cockpit/client.svelte';
  import { isTyping } from '$lib/utils/typing';
  import type { SendExtras } from '$lib/cockpit/client.svelte';
  import { PERMISSION_MODES, permissionModeLabel } from '$lib/cockpit/permission-modes';
  import * as AlertDialog from '$lib/components/ui/alert-dialog';
  import { Button, type ButtonVariant } from '$lib/components/ui/button';
  import * as ButtonGroup from '$lib/components/ui/button-group';
  import * as Select from '$lib/components/ui/select';
  import * as Sidebar from '$lib/components/ui/sidebar';
  import * as ToggleGroup from '$lib/components/ui/toggle-group';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import { sessionFailedMessage } from '$lib/cockpit/frames';
  import type { Message, TranscriptGroup } from '$lib/cockpit/types';
  import type { SubagentState } from '$lib/utils/flow-types';

  /**
   * One conversation's whole workspace: header, transcript, composer, context
   * rail. The route mounts one of these per open tab and only ever hides the
   * ones that are not on screen, so switching costs a `visibility` flip —
   * nothing is torn down, nothing is measured again, and the scroll offset and
   * the half-typed message survive because their DOM never left.
   */
  interface Props {
    viewId: string;
    /** A machine id means this pane is reading a stored transcript, not a live
     *  session — the `?machine=` the route arrived with. */
    browsing: string | null;
    browsingCwd: string;
    /** Whether this is the pane on screen. The keyboard, the polling and the
     *  gestures belong to that one; the rest only keep their place. */
    active: boolean;
  }

  let { viewId, browsing, browsingCwd, active }: Props = $props();

  // Opening writes to the store, so it stays in an effect; the read is derived.
  // Untracked, or the store reads it makes would re-arm this effect against the
  // very fields it writes — a transcript that comes back empty would reload forever.
  $effect(() => {
    const machineId = browsing;
    const cwd = browsingCwd;
    const id = viewId;
    untrack(() => {
      // A session being returned to is not opening at its end, so the pass that
      // would take it there stands down and the remembered offset is restored.
      anchored = scrollMemory.get(id)?.atBottom === false;
      if (machineId) void openTranscript({ viewId: id, machineId, sessionId: id, cwd });
      else openSession(id);
    });
  });
  const session = $derived(cockpit.session(viewId));

  /** The path this session works in — the header's second fact, and its title's
   *  fallback where the SDK has not named the transcript yet. */
  const cwdLabel = $derived(session?.cwd || browsingCwd || viewId);

  /** The last segment of it — which checkout, in the width a phone has. */
  const leaf = $derived(cwdLabel.split('/').filter(Boolean).pop() ?? cwdLabel);

  /**
   * What the session is about, not where it runs. A phone has room for exactly
   * one of the two, so the title leads and the path follows it from `sm` up.
   */
  const heading = $derived.by(() => {
    // Browsing a stored session, the route id *is* the SDK session id.
    const sessionId = browsing ? viewId : (session?.sessionId ?? null);
    const machineId = session?.machineId || browsing;
    const info =
      sessionId && machineId
        ? cockpit.catalogOf(machineId).find((row) => row.sessionId === sessionId)
        : undefined;
    return info ? sessionTitle(info) : leaf;
  });

  // Frames land in bursts; the preview reveals them at a steady rate so a turn
  // reads as typing rather than as a slideshow. Presentation only — the follow
  // pin and the unseen flag below still read `session.streaming` itself.
  const stream = smoothText(() => session?.streaming ?? '');

  // A live session this browser did not start has already said things, and frames
  // only carry what comes next — so read it back the moment the registry names
  // the SDK session behind it. Re-arms on `sessionId`, which is what arrives late.
  $effect(() => {
    const id = viewId;
    if (browsing || !cockpit.session(id)?.sessionId) return;
    untrack(() => void backfillSession(id));
  });

  let scroller = $state<HTMLDivElement | null>(null);
  // bind:this yields the component instance; fast-check can't see that its
  // exports satisfy VirtualizerHandle, so the cast lives in one derived.
  let vlistRaw = $state<unknown>(null);
  const vlist = $derived(vlistRaw as VirtualizerHandle | null);
  /** Whether the reader is parked at the live edge — measured before every growth. */
  let atBottom = $state(true);
  let unseen = $state(false);
  /** Absolute deadline while a user-toggled disclosure is animating — the pin
   *  must not chase growth the reader asked for. Re-armed from real geometry
   *  once the animation settles. */
  let followHold = 0;
  /** Whether this transcript has been parked at its end since it opened. */
  let anchored = false;

  function trackScroll() {
    if (!scroller) return;
    atBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
    if (atBottom) unseen = false;
    // Recorded as it moves rather than on the way out: by the time a switch has
    // run its effects the column already holds the *next* session's messages,
    // and a scroller measured then reports where that one starts.
    if (viewId) scrollMemory.set(viewId, { top: scroller.scrollTop, atBottom });
  }

  // Always the raw write. `scrollToIndex(last, 'end')` parks on the end of the
  // last virtualised group, and everything rendered after the list — the
  // streaming reply, the local echo, the permission stack — then sits below the
  // fold, which is the whole bug: the gap grew by one message height per turn
  // and never closed. scrollHeight is the true bottom of the real layout, and
  // the ResizeObserver re-applies it as virtua's estimates settle.
  function pinToLatest() {
    if (!scroller) return;
    scroller.scrollTop = scroller.scrollHeight;
  }

  function jumpToLatest() {
    pinToLatest();
    unseen = false;
  }

  /**
   * Holds the transcript at the bottom while the layout settles.
   *
   * Virtua opens with an *estimate* — `itemSize` per group — and a transcript of
   * tool cards and markdown is far taller than that, so the first paint's
   * `scrollHeight` is a fraction of the real one. A single pin lands on the
   * estimated bottom, which is nowhere near the last message, and the growth
   * that follows arrives as virtua measures each group it renders.
   *
   * So the bottom is re-taken every frame until it stops moving. Bounded twice
   * over: it gives up after `SETTLE_MS`, and the moment the reader scrolls away
   * from the edge it stops rather than fighting them for the scrollbar.
   */
  /**
   * Whether the reader has actually taken hold of the scrollbar.
   *
   * `atBottom` is measured in a scroll handler, and growth fires scroll events
   * too — so a transcript that grows faster than it is re-pinned latches
   * "the reader scrolled away" when nobody touched anything, and every follow
   * path is gated on it. Measured on a 390px viewport: the column grew from
   * 12.8k to 17k as virtua measured the narrower wrapping, and the transcript
   * gave up 4,236px short. A real gesture is the only thing that should stop it.
   */
  let grabbed = $state(false);

  const SETTLE_MS = 6000;
  let settling = 0;
  function settleAtBottom() {
    const until = performance.now() + SETTLE_MS;
    const token = ++settling;
    let lastHeight = -1;
    const step = () => {
      // A newer settle, a gone scroller, or a reader who took hold ends it —
      // deliberately not `atBottom`, which the growth itself keeps falsifying.
      if (token !== settling || !scroller || grabbed) return;
      // Virtua's own jump first. A raw `scrollTop = scrollHeight` is measured
      // against a height virtua has only estimated, so it aims at a bottom that
      // is not there yet; `scrollToIndex` goes through virtua's measurement
      // instead, which is the thing that knows the estimate is wrong. The raw
      // write still follows, for whatever renders after the last group.
      const last = groups.length - 1;
      if (last >= 0) vlist?.scrollToIndex(last, { align: 'end' });
      pinToLatest();
      const height = scroller.scrollHeight;
      // Stop early once two frames agree the layout has stopped growing.
      if (height === lastHeight && performance.now() > until - SETTLE_MS + 200) return;
      lastHeight = height;
      atBottom = true;
      unseen = false;
      if (performance.now() < until) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /**
   * The same hold, aimed at where the reader left off instead of at the end.
   *
   * Two things move the offset out from under a single write. The column is
   * shorter than the target for the first frames, so the browser clamps it —
   * and virtua, which caches measured heights *by index*, is holding the sizes
   * of whichever session was on screen last: as it corrects them it also shifts
   * the offset to keep what it is rendering still. Measured on a 6,200px
   * transcript, letting go at the first stable frame landed 279px — one
   * message — above where the reader left. So the offset is held until the
   * column has stopped growing and stopped being corrected under it.
   */
  const STEADY_FRAMES = 8;
  function settleAt(top: number) {
    const until = performance.now() + SETTLE_MS;
    const token = ++settling;
    let lastHeight = -1;
    let want = -1;
    let steady = 0;
    const step = () => {
      if (token !== settling || !scroller || grabbed) return;
      const shifted = want >= 0 && scroller.scrollTop !== want;
      const reachable = scroller.scrollHeight - scroller.clientHeight;
      want = Math.min(top, Math.max(reachable, 0));
      scroller.scrollTop = want;
      const height = scroller.scrollHeight;
      steady = !shifted && want === top && height === lastHeight ? steady + 1 : 0;
      lastHeight = height;
      if (steady < STEADY_FRAMES && performance.now() < until) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // A transcript that has just arrived opens at its newest turn. Keyed on the
  // session and on the transcript being present, so it runs once per opened
  // session rather than on every message that lands afterwards.
  /** The session whose opening settle has already run, so it runs once. */
  let settledFor = $state<string | null>(null);
  $effect(() => {
    const id = viewId;
    const ready = (session?.messages.length ?? 0) > 0 && !(session?.loading ?? false);
    if (!id || !ready) return;
    untrack(() => {
      // Every later message is the live-follow path's job, not this one's.
      if (settledFor === id) return;
      settledFor = id;
      grabbed = false;
      // Read now, not in the callback: the scroller is shared, and the next
      // scroll event it fires is already attributed to the session arriving.
      const left = scrollMemory.get(id);
      if (left && !left.atBottom) {
        // Said before the first frame is drawn, or the follow pin the session
        // being left behind armed would drag this one to the bottom first.
        atBottom = false;
        void tick().then(() => settleAt(left.top));
      } else {
        void tick().then(settleAtBottom);
      }
    });
  });

  // Following is driven by content size, not message events: any growth —
  // streamed tokens, a card expanding, an image landing — keeps the live edge
  // pinned frame by frame, and never fights an in-flight height animation.
  $effect(() => {
    if (!scroller) return;
    const node = scroller;
    const column = node.firstElementChild;
    if (!column) return;
    const follow = new ResizeObserver(() => {
      if (!scroller) return;
      if (performance.now() < followHold) return;
      if (atBottom) pinToLatest();
    });
    const noteToggle = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest('[data-slot="collapsible-trigger"], [aria-expanded]')) return;
      followHold = performance.now() + 400; // grid animation is 250ms; slack for layout
      // Where the toggle left the reader decides whether following resumes:
      // a small panel keeps them at the edge, a tall one parks them on it.
      setTimeout(trackScroll, 420);
    };
    follow.observe(column);
    // And the container itself. On a phone the viewport is the thing that moves
    // — the URL bar collapses, the keyboard opens, `h-dvh` resolves to a new
    // number — and the content does not change at all, so watching only the
    // column means the live edge silently slides out of view with nothing
    // firing. This is the same growth from the reader's side of the glass.
    follow.observe(node);

    // `visualViewport` is the only thing that reports the keyboard, which
    // resizes nothing else on iOS.
    const viewport = window.visualViewport;
    const onViewport = () => {
      if (performance.now() < followHold) return;
      if (atBottom) pinToLatest();
    };
    viewport?.addEventListener('resize', onViewport);

    // A gesture, not a scroll event: only these mean the reader moved the
    // transcript themselves. Everything else that scrolls it is us.
    const grab = () => (grabbed = true);
    const grabKey = (event: KeyboardEvent) => {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) {
        grabbed = true;
      }
    };
    node.addEventListener('wheel', grab, { passive: true });
    node.addEventListener('touchstart', grab, { passive: true });
    node.addEventListener('keydown', grabKey);

    node.addEventListener('click', noteToggle, true);
    return () => {
      follow.disconnect();
      viewport?.removeEventListener('resize', onViewport);
      node.removeEventListener('wheel', grab);
      node.removeEventListener('touchstart', grab);
      node.removeEventListener('keydown', grabKey);
      node.removeEventListener('click', noteToggle, true);
    };
  });

  // Chasing the bottom while the user is reading further up yanks the transcript
  // out from under them — so growth behind their scroll position is flagged instead.
  //
  // This also pins. The ResizeObserver above is the smooth path, frame by frame,
  // but its delivery rides the rendering lifecycle and simply stops in a
  // throttled or backgrounded tab — measured: the column grew 240px and the
  // observer fired zero times, so the transcript stopped following. Content
  // changes are a signal that always arrives, so they pin too; both write the
  // same value, which makes the duplication harmless.
  $effect(() => {
    const count = session?.messages.length ?? 0;
    const streaming = session?.streaming ?? '';
    if (!count && !streaming) return;
    if (!untrack(() => atBottom)) {
      unseen = true;
      return;
    }
    if (performance.now() < followHold) return;
    void tick().then(pinToLatest);
  });

  const isTool = (message: Message) => message.type === 'tool.use' || message.type === 'tool.result';

  const subagents = $derived(session?.subagents ?? {});

  /** The branch a Task tool.use opened, if this session has one for it. */
  const branchOf = (message: Message): SubagentState | undefined => {
    const toolId = message.metadata?.toolId;
    return toolId ? subagents[toolId] : undefined;
  };

  /**
   * What the session itself said. The error notices the frames deliver are the
   * same death the registry row records, so they are not the session speaking —
   * counting them would let the tab that watched a session die end up with a
   * bare error line where the tab that opened afterwards gets the card.
   */
  const said = $derived((session?.messages ?? []).filter((message) => message.type !== 'ui.error'));

  /**
   * Only where there is genuinely nothing to show. A session the store already
   * holds renders out of it on the frame it is switched to, and a read running
   * behind that is not a reason to take its transcript off the screen.
   */
  const reading = $derived((session?.loading ?? false) && (session?.messages.length ?? 0) === 0);

  // The row behind a session with nothing to show for itself. It is what
  // explains one, live or long afterwards — and which kind of end it came to
  // decides whether the transcript carries a failure or an offer.
  const settled = $derived.by((): InstanceRow | null => {
    if (browsing || said.length > 0) return null;
    const row = cockpit.instances.find((instance) => instance.id === viewId);
    return row && (row.status === 'error' || row.status === 'stopped') ? row : null;
  });

  /** Its process is gone, its conversation is not: opening it is what brings it back. */
  const sleeping = $derived(Boolean(settled && isResumable(settled)));

  // A session merely stopped before it said anything has nothing to explain —
  // only one that died of something does.
  const failure = $derived.by((): Message | null =>
    settled && !sleeping && settled.lastError
      ? sessionFailedMessage(viewId, settled.lastError)
      : null
  );

  // Consecutive tool calls collapse into one ToolGroup, as MessageList does; a
  // Task call becomes its branch card instead, so the subagent it spawned reads
  // as one line until the user opens it.
  const groups = $derived.by((): TranscriptGroup[] => {
    // The card carries the same reason the error notices do, so it stands in
    // for them rather than sitting under a repeat of itself.
    if (failure) return [{ kind: 'single', message: failure, index: 0 }];
    const messages = session?.messages ?? [];
    const result: TranscriptGroup[] = [];
    let i = 0;
    while (i < messages.length) {
      const branch = branchOf(messages[i]);
      if (branch) {
        result.push({ kind: 'subagent', branch, spawn: messages[i], index: i });
        i++;
        continue;
      }
      if (!isTool(messages[i])) {
        result.push({ kind: 'single', message: messages[i], index: i });
        i++;
        continue;
      }
      const start = i;
      const tools: Message[] = [];
      while (i < messages.length && isTool(messages[i]) && !branchOf(messages[i])) {
        tools.push(messages[i]);
        i++;
      }
      result.push({ kind: 'tools', messages: tools, index: start });
    }
    return result;
  });

  // Keyed by what a group holds rather than where it sits: hydrating a long
  // transcript prepends older turns to the front, and a key that moved with the
  // index would remount every group below it and lose its measured height.
  const groupKey = (group: TranscriptGroup): string => {
    if (group.kind === 'single') return group.message.id ?? `single-${group.index}`;
    if (group.kind === 'subagent') return `subagent-${group.branch.toolUseId}`;
    return `tools-${group.messages[0].id ?? group.index}`;
  };

  // A transcript opens on its last line. Virtua revises its estimated heights
  // over the first few frames, so a single landing can end up thousands of
  // pixels short — hold the end through the settling window with bounded raw
  // writes (always the true bottom of the current layout), stop the moment
  // the reader scrolls away, and let the ResizeObserver own it from there.
  $effect(() => {
    if (anchored || !groups.length) return;
    anchored = true;
    void tick().then(async () => {
      for (const delay of [0, 80, 240, 600]) {
        if (delay) await new Promise((r) => setTimeout(r, delay));
        if (!scroller) return;
        if (delay && !atBottom) return;
        scroller.scrollTop = scroller.scrollHeight;
        trackScroll();
      }
    });
  });

  let view = $state<'chat' | 'flow'>('chat');

  /** The memory dock, beside the chat rather than over it. */
  let memoryOpen = $state(false);

  // Past this width the session has room for three columns, so the rail is
  // docked rather than summoned: the transcript keeps its measure centred in
  // what is left instead of floating in half a screen of nothing. Still the
  // reader's to close — this only sets where each width starts.
  const roomForRail = new MediaQuery('min-width: 1920px');
  $effect(() => void (memoryOpen = roomForRail.current));

  let searchOpen = $state(false);
  let search = $state<ReturnType<typeof TranscriptSearch> | null>(null);
  let dock = $state<HTMLDivElement | null>(null);
  /** The group a search jump landed on, ringed until the reader has found it. */
  let flashKey = $state<string | null>(null);
  let flashTimer: ReturnType<typeof setTimeout>;

  function handleKeydown(event: KeyboardEvent) {
    // Every open conversation has a pane; only the one on screen answers for
    // them. Find and the permission keys are aimed at what the reader is
    // looking at, not at the four transcripts standing behind it.
    if (!active) return;
    // Find belongs to the transcript, so it only takes the key over the chat pane —
    // and unlike Cmd+K it takes it mid-typing too, as the native find would.
    if (event.key === 'f' && (event.metaKey || event.ctrlKey) && view === 'chat') {
      event.preventDefault();
      if (searchOpen) search?.focus();
      else searchOpen = true;
      return;
    }
    answerPending(event);
  }

  /** Which answer a bare key is, for the card that would take it. */
  function answerFor(event: KeyboardEvent, request: PendingPermission): PermissionAnswer | null {
    const key = event.key.toLowerCase();
    if (event.shiftKey) {
      return key === 'y' && request.suggestions?.length ? 'always' : null;
    }
    if (key === 'y' || key === 'a') return 'allow';
    if (key === 'n' || key === 'd') return 'deny';
    return null;
  }

  /**
   * Questions parked by a process that has since died cannot be answered — the
   * reply reaches a daemon with no such session, which is the "no session <id>"
   * the reader used to get for clicking Approve. A dead session shows none.
   */
  const answerable = $derived.by((): PendingPermission[] => {
    const row = cockpit.instances.find((instance) => instance.id === viewId);
    const alive = !row || row.status === 'running' || row.status === 'starting';
    return alive ? (session?.pending ?? []) : [];
  });

  /**
   * The permission the stack shows on top is the one the keyboard answers: the
   * card the eye is on, and the only one that shows the hints.
   */
  function answerPending(event: KeyboardEvent) {
    const request = answerable[0];
    if (!request || event.metaKey || event.ctrlKey || event.altKey || isTyping()) return;
    // A question is answered on its own card, by its own keys: "y" is not a
    // choice it offers, and approving it would run it unanswered.
    if (questionsOf(request.toolName, request.input)) return;
    const answer = answerFor(event, request);
    if (!answer) return;
    event.preventDefault();
    handleResolve(request.requestId, permissionAnswer(request, answer));
  }

  // Matches live wherever the transcript put them, which is usually off screen
  // and behind the live edge: hold the pin off long enough for virtua to settle
  // on the target, or following would snap the reader straight back down.
  function jumpToMatch(groupIndex: number) {
    followHold = performance.now() + 600;
    vlist?.scrollToIndex(groupIndex, { align: 'center' });
    clearTimeout(flashTimer);
    flashKey = groupKey(groups[groupIndex]);
    flashTimer = setTimeout(() => (flashKey = null), 1200);
  }

  function closeSearch() {
    searchOpen = false;
    (dock?.querySelector('textarea') ?? scroller)?.focus();
  }

  // Nothing animates on arrival: the pane slide and the state-word swap are for
  // changes the reader caused or needs to notice, not for the page showing up.
  let painted = $state(false);
  onMount(() => void (painted = true));

  /** The tool in flight, named in the header's live region while it runs. */
  const runningTool = $derived(session?.currentTool ? ` · ${session.currentTool.name}` : '');
  const activity = $derived(cockpit.activityOf(viewId));

  const branches = $derived(new Map(Object.entries(subagents)));
  const totalCostUsd = $derived(
    session?.messages.reduce((cost, message) => message.metadata?.totalCost ?? cost, 0) ?? 0
  );

  /** The draft text restored after a failed send, so the reader does not lose it. */
  let sendError = $state<string | null>(null);
  let restoredDraft = $state<string | null>(null);
  let chatInputRef = $state<ReturnType<typeof ChatInput> | null>(null);

  // The composer is one box shared by every session, so what is in it belongs to
  // whichever one is on screen: it is put away on the way out and handed back on
  // the way in, and a session with nothing typed gets an empty box rather than
  // the last one's sentence.
  $effect(() => {
    const id = viewId;
    untrack(() => void chatInputRef?.setDraft?.(drafts.get(id) ?? ''));
    return () =>
      untrack(() => {
        const text = chatInputRef?.draft?.() ?? '';
        if (text) drafts.set(id, text);
        else drafts.delete(id);
      });
  });

  async function handleSend(text: string, extras: SendExtras) {
    if (!session) return;
    drafts.delete(viewId);
    sendError = null;
    try {
      await sendOrRevive(viewId, session.machineId, text, extras);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      sendError = reason;
      restoredDraft = text;
      chatInputRef?.setDraft?.(text);
      toast.error(`Send failed: ${reason}`);
    }
  }

  function retrySend() {
    if (!restoredDraft) return;
    const text = restoredDraft;
    restoredDraft = null;
    sendError = null;
    handleSend(text, {});
  }

  function handleInterrupt() {
    if (!session) return;
    try {
      interrupt(viewId, session.machineId);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      toast.error(`Interrupt failed: ${reason}`);
    }
  }


  /**
   * The rail links to a branch by hash. The transcript is virtualised, so the
   * browser cannot scroll to an element that is not mounted — the jump has to
   * go through virtua, which is what the search already does. Waits for the
   * transcript, then jumps once per hash so it does not fight the reader.
   */
  let jumped = $state<string | null>(null);
  $effect(() => {
    const hash = page.url.hash;
    const ready = groups.length > 0;
    if (!active || !hash.startsWith('#subagent-') || !ready) return;
    if (untrack(() => jumped) === hash) return;
    const key = hash.slice(1);
    const index = untrack(() => groups).findIndex((group) => groupKey(group) === key);
    if (index === -1) return;
    jumped = hash;
    void tick().then(() => jumpToMatch(index));
  });

  /**
   * A reading for the session on screen. Only a live one can answer, so a dead
   * session keeps whatever the meter last showed rather than being revived just
   * to report a number nobody asked to change.
   */
  function askContext() {
    if (!session?.machineId) return;
    const row = cockpit.instances.find((instance) => instance.id === viewId);
    if (row && row.status !== 'running' && row.status !== 'starting') return;
    void refreshContext(viewId, session.machineId);
  }

  // One reading when a live session comes into view: the window was already
  // filling before this tab opened, and a meter that starts empty is a lie.
  // Keyed on the row's status, not on `initialized` — that only turns true when
  // an init banner arrives, so a session already running when the tab opened
  // would never take a first reading.
  $effect(() => {
    const id = viewId;
    const machineId = session?.machineId;
    const live = cockpit.instances.find((instance) => instance.id === id)?.status;
    // Only the pane on screen: a meter nobody is looking at is a round trip to
    // a daemon for nothing, and there are as many hidden panes as open tabs.
    if (!active || !id || !machineId || (live !== 'running' && live !== 'starting')) return;
    untrack(() => {
      if (!session?.context) askContext();
    });
  });

  /**
   * While a turn runs the window is filling, so a reading taken at the last turn
   * boundary is already wrong. Polled only for the session on screen, and only
   * while it is working — an idle session's number cannot move on its own.
   */
  const CONTEXT_POLL_MS = 5000;
  $effect(() => {
    if (!active || !session?.busy) return;
    const timer = setInterval(() => untrack(askContext), CONTEXT_POLL_MS);
    return () => clearInterval(timer);
  });

  /** This session's own `/` menu — empty until it has taken a turn and said. */
  const commands = $derived(cockpit.commandsOf(viewId));

  /**
   * What each of them does, asked for the first time the reader opens the menu.
   * Only a live session can answer, like the context reading; the names it
   * already listed are the menu either way.
   */
  function askCommands() {
    if (!session?.machineId) return;
    const row = cockpit.instances.find((instance) => instance.id === viewId);
    if (row && row.status !== 'running' && row.status !== 'starting') return;
    void loadCommands(viewId, session.machineId);
  }

  // The header's MCP chips: ask a live session once; an init frame nulls the
  // answer and this asks again.
  $effect(() => {
    if (browsing || !session || !session.machineId || session.mcp !== null) return;
    loadMcpServers(viewId, session.machineId);
  });

  /** Every other live session, named the way the rail names them. */
  const peers = $derived(
    targetsFrom(
      peerTargets(viewId),
      (machineId) =>
        cockpit.machines.find((machine) => machine.machineId === machineId)?.hostname ?? machineId,
      (instanceId) => cockpit.activityOf(instanceId) === 'working'
    )
  );

  /**
   * Hands this session's message to another one. The note is attributed to this
   * session and queued rather than delivered as a turn, so the target finishes
   * what it is doing first — see `sendToPeer`.
   */
  async function handleHandoff(peer: PeerTarget, text: string) {
    if (!text.trim()) return;
    const label = session?.cwd ? (session.cwd.split('/').filter(Boolean).pop() ?? viewId) : viewId;
    try {
      await sendToPeer(
        { instanceId: peer.id, machineId: peer.machineId },
        { instanceId: viewId, label },
        text
      );
      handoffNote = `Handed to ${peer.label}`;
      clearTimeout(handoffTimer);
      handoffTimer = setTimeout(() => (handoffNote = null), 4000);
    } catch (error) {
      handoffNote = error instanceof Error ? error.message : 'That did not reach the session.';
    }
  }

  /** The receipt, until the tracked hand-off status replaces it. */
  let handoffNote = $state<string | null>(null);
  let handoffTimer: ReturnType<typeof setTimeout>;

  /** Every conversation that still exists — the bound on where a swipe may go. */
  const reachable = $derived(cockpit.listedInstances.map((row) => row.id));

  function step(by: number) {
    // Ordered by what the reader has been working between, not by the rail's
    // list: passing four sessions untouched for a week to reach the one you
    // left a minute ago is not switching, it is scrolling.
    const next = workingSet.step(viewId, by, reachable);
    if (!next || next === viewId) return;
    // Tells the view transition which way the page is going, so it leaves the
    // way the finger did rather than always pushing the same direction.
    document.documentElement.dataset.nav = by > 0 ? 'next' : 'prev';
    void goto(`/session/${next}`);
  }

  /**
   * Whether this session's machine can answer at all.
   *
   * Read off the machine's own reported credential state — a typed enum the
   * daemon probes and re-announces — rather than inferred from what a turn
   * happened to say. A sentence about being logged out is not evidence, as a
   * message merely quoting one proved.
   */
  const machine = $derived(
    cockpit.machines.find((row) => row.machineId === session?.machineId) ?? null
  );
  const cannotAnswer = $derived(
    machine !== null && machine.auth !== 'authenticated' && machine.auth !== 'unknown'
  );
  const machineOffline = $derived(
    machine !== null && machine.status !== 'online'
  );
  let loggingIn = $state(false);

  function handleResolve(requestId: string, result: PermissionResult) {
    if (!session) return;
    resolvePermission(viewId, session.machineId, requestId, result);
  }

  /** The store shows the mode optimistically and puts it back if the agent refuses. */
  async function handlePermissionMode(mode: PermissionMode) {
    if (!session) return;
    error = null;
    try {
      await setPermissionMode(viewId, session.machineId, mode);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  // Null until an `init` or a spawn has said. Nothing stands in for it: showing
  // the SDK's default would present a guess as this session's own setting.
  const permissionMode = $derived(session?.permissionMode ?? null);

  /**
   * The SDK will not switch a running session into bypass, so choosing it means
   * relaunching on the SDK session this one named. Offering it before there is
   * one is what would surface the SDK's refusal as an error, so it waits.
   */
  const canRelaunch = $derived(Boolean(session?.sessionId));

  // Choosing bypass IS the decision (user's call, 2026-08-01): the relaunch
  // fires at once — the settle keeps the transcript coherent and the
  // continuation message picks the interrupted work back up.
  function chooseMode(value: string) {
    const mode = value as PermissionMode;
    if (mode === permissionMode) return;
    if (mode === 'bypassPermissions') {
      void relaunchInBypass();
      return;
    }
    void handlePermissionMode(mode);
  }

  async function relaunchInBypass() {
    if (!session) return;
    error = null;
    try {
      await relaunchSession(viewId, session.machineId, 'bypassPermissions');
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  /**
   * Wakes a sleeping session now instead of on the next thing asked of it —
   * the same path a message takes, so there is only one way back.
   */
  async function handleRevive() {
    if (!session) return;
    error = null;
    try {
      await ensureAlive(viewId, session.machineId);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  async function handleResume() {
    if (!browsing) return;
    const instanceId = resumeSession({
      machineId: browsing,
      cwd: browsingCwd,
      sessionId: viewId,
      history: session?.messages ?? [],
    });
    await goto(`/session/${instanceId}`);
  }

  /** The SDK session this view can branch from: the stored one, or the live one's. */
  const forkable = $derived(browsing ? viewId : (session?.sessionId ?? null));

  // Resuming and forking seed the new view from what is on screen, so both wait
  // for the whole of it: a transcript still hydrating has only its last turns.
  const wholeTranscript = $derived(!session?.loading && !session?.hydrating);

  async function handleFork() {
    if (!session || !forkable) return;
    const instanceId = forkSession({
      machineId: browsing ?? session.machineId,
      cwd: browsing ? browsingCwd : session.cwd,
      sessionId: forkable,
      history: session.messages,
    });
    await goto(`/session/${instanceId}`);
  }

  /** Discard throws work away, so it asks once before it does. */
  let confirmingDiscard = $state(false);

  async function handleDiscard() {
    if (!session) return;
    error = null;
    confirmingDiscard = false;
    try {
      await discardSession(viewId, session.machineId);
      workingSet.forget(viewId);
      await goto('/session');
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  async function handleKeep() {
    error = null;
    try {
      await keepSession(viewId);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  let error = $state<string | null>(null);

  /** A single toggle group answers with `''` when its active item is clicked again. */
  function chooseView(value: string) {
    if (value === 'chat' || value === 'flow') view = value;
  }

  const currentModel = $derived(session?.model ?? '');

  // `setModel` moves the header first and puts it back if the machine refuses,
  // so the only thing left here is to say what the refusal was.
  async function chooseModel(value: string) {
    if (!session) return;
    error = null;
    try {
      await setModel(viewId, session.machineId, value);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- One shape for every session verb: an icon that survives a narrow header, a
     name that drops out with it, and a tooltip that is the only place the name
     is guaranteed to be. -->
{#snippet verb(opts: {
  label: string;
  tip: string;
  icon: Component;
  onclick: () => void;
  disabled?: boolean;
  variant?: ButtonVariant;
})}
  {@const Icon = opts.icon}
  <Tooltip.Root>
    <Tooltip.Trigger>
      {#snippet child({ props })}
        <Button
          {...props}
          variant={opts.variant === 'destructive' ? 'outline' : (opts.variant ?? 'outline')}
          size="sm"
          class="text-xs {opts.variant === 'destructive'
            ? 'text-destructive hover:bg-destructive/10 hover:text-destructive'
            : ''}"
          disabled={opts.disabled}
          aria-label={opts.label}
          onclick={opts.onclick}
        >
          <Icon />
          <!-- The name is in the tooltip and the aria-label, so the label is the
               first thing to go when the bar runs out of room. -->
          <span class="hidden 2xl:inline">{opts.label}</span>
        </Button>
      {/snippet}
    </Tooltip.Trigger>
    <Tooltip.Content>{opts.tip}</Tooltip.Content>
  </Tooltip.Root>
{/snippet}

<AlertDialog.Root bind:open={confirmingDiscard}>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>Discard this side quest?</AlertDialog.Title>
      <AlertDialog.Description>
        The session stops, and whatever the spawn created for it — its worktree, its transcript —
        goes with it, for good.
      </AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
      <AlertDialog.Action variant="destructive" onclick={handleDiscard}>
        Discard side quest
      </AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>

{#if machine}
  <MachineLogin {machine} bind:open={loggingIn} />
{/if}

<!-- `relative`, so the rail anchors to the session rather than to the window,
     and `overflow-hidden`, so it is clipped while it is slid out. -->
<Sidebar.Provider
  bind:open={memoryOpen}
  style="--sidebar-width: 26rem"
  class="relative h-full min-h-0 flex-1 overflow-hidden"
>
  <div
    class="flex h-full min-w-0 flex-1 flex-col overflow-hidden"
    use:swipeBetween={{
      onNext: () => step(1),
      onPrevious: () => step(-1),
      // Not while a question or a permission is waiting: swiping away from
      // something that is blocked on an answer loses the reader's place in the
      // one situation where the page is asking them for something.
      enabled: () => answerable.length === 0,
    }}
  >
    {#if machineOffline && machine}
      <div
        role="status"
        class="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-warning/30 bg-warning/10 px-4 py-2 text-sm"
        transition:fly={{ y: -6, duration: 180, easing: quintOut }}
      >
        <span class="font-medium text-warning">{machine.hostname} is offline</span>
        <span class="text-warning/80">
          Messages cannot be delivered until it reconnects.
        </span>
      </div>
    {/if}
    {#if cannotAnswer && machine}
      <div
        role="status"
        class="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-warning/30 bg-warning/10 px-4 py-2 text-sm"
        transition:fly={{ y: -6, duration: 180, easing: quintOut }}
      >
        <span class="font-medium text-warning">{machine.hostname} is not logged in</span>
        <span class="text-warning/80">
          Claude Code there cannot reach its credentials, so this session cannot answer.
        </span>
        <Button size="sm" class="ml-auto" onclick={() => (loggingIn = true)}>Log in</Button>
      </div>
    {/if}

    <!-- The controls are the fixed cost; the path is what gives way. Without
         min-w-0 the flex items refuse to shrink below their content and the
         right-hand group is pushed off the window instead. -->
    <!-- A phone's header is all controls and no room; the session says its name
         on the line above them instead of going unnamed. -->
    <div class="flex min-w-0 items-baseline gap-2 px-4 pt-2 sm:hidden">
      <h1 class="min-w-0 truncate text-sm font-medium" title={heading}>{heading}</h1>
      {#if leaf !== heading}
        <span class="shrink-0 font-mono text-micro text-muted-foreground">{leaf}</span>
      {/if}
    </div>

    <!-- A fixed height, whatever the session puts in it: a stored transcript
         carries none of the pickers a live one does, and a header that measured
         its contents made the transcript below it start at a different line in
         every tab. Everything in here truncates rather than growing. -->
    <header class="flex h-12 min-w-0 shrink-0 items-center gap-3 border-b border-border px-4">
      <a href="/session" class="hidden shrink-0 text-sm text-muted-foreground hover:text-foreground sm:inline"
        >Sessions</a
      >
      <!-- The verbs, the pickers and the state are this bar's fixed cost, and
           under `2xl` what is left cannot hold a title and a path without
           cutting the path's head off — so there the path drops to the title's
           tooltip and the name gets the whole run. Where both fit, the path
           takes the width it needs, up to 60% of the run, and the title gives
           up the rest: a half-path is a wrong answer to "which checkout", a
           half-sentence is still the sentence. -->
      <div class="hidden min-w-0 flex-1 items-baseline gap-3 sm:flex">
        <h1
          class="min-w-0 flex-1 truncate text-sm font-medium"
          title={[heading, cwdLabel].join('\n')}
        >{heading}</h1>
        <span
          class="hidden max-w-[60%] shrink-0 truncate font-mono text-micro text-muted-foreground [direction:rtl] 2xl:block"
          title={cwdLabel}
        ><bdi>{cwdLabel}</bdi></span>
      </div>
      {#if session?.scratch}
        <span
          class="shrink-0 rounded-sm border border-dashed border-muted-foreground/40 px-1.5 py-0.5 text-xs tracking-wide text-muted-foreground uppercase"
        >
          side quest
        </span>
      {/if}
      <span
        class="ml-auto flex min-h-6 shrink-0 items-center gap-1.5 text-xs text-muted-foreground"
        role="status"
        aria-live="polite"
      >
        {#if !browsing}
          <!-- The state carries a colour of its own, so the dot says it before the
               word is read: pinging red when the session is waiting on you. -->
          <ActivityDot {activity} size={1.5} />
        {/if}
        {#if browsing}
          Transcript · {session?.loading
            ? 'loading'
            : `${session?.messages.length ?? 0} messages`}
        {:else}
          <!-- The word swaps in place; the dot beside the session is the static cue.
               One inline run, so the separator's leading space survives. -->
          <span>
            <span class="inline-grid">
              {#key activity}
                <span
                  class="col-start-1 row-start-1"
                  in:fly={{ y: 5, duration: painted ? 180 : 0, easing: quintOut }}
                  out:fly={{ y: -5, duration: painted ? 140 : 0, easing: quintOut }}
                >{ACTIVITY_LABEL[activity]}</span>
              {/key}
            </span>{runningTool}
          </span>
        {/if}
      </span>

      {#if !browsing && session && session.mcp && session.mcp.length > 0}
        <McpChips servers={session.mcp} instanceId={viewId} machineId={session.machineId} />
      {/if}

      <!-- What this session is running in: its CLAUDE.md files, its MCP servers
           and its own facts, in the rail on the right. -->
      {#if !browsing && session?.machineId && session.cwd}
        <SessionContextButton />
      {/if}

      <ToggleGroup.Root
        type="single"
        variant="outline"
        size="sm"
        value={view}
        onValueChange={chooseView}
        class="shrink-0"
        aria-label="Session view"
      >
        <ToggleGroup.Item value="chat" aria-controls="session-view-panel" aria-label="Chat">
          <IconChat />
          <span class="hidden sm:inline">Chat</span>
        </ToggleGroup.Item>
        <ToggleGroup.Item value="flow" aria-controls="session-view-panel" aria-label="Flow">
          <IconFlow />
          <span class="hidden sm:inline">Flow</span>
        </ToggleGroup.Item>
      </ToggleGroup.Root>

      {#if !browsing}
        <!-- How the session is configured: two pickers, read as one control. -->
        <ButtonGroup.Root class="shrink-0">
          <Select.Root type="single" value={permissionMode ?? ''} onValueChange={chooseMode}>
            <Select.Trigger
              size="sm"
              aria-label={permissionMode ? 'Permission mode' : 'Permission mode, not reported yet'}
              title={permissionMode
                ? 'How this session answers tool permissions'
                : "Read from this session's next turn — it has not said how it answers tool permissions"}
              class="text-xs {permissionMode === 'bypassPermissions'
                ? 'font-medium text-warning'
                : 'text-muted-foreground'}"
            >
              {permissionMode ? permissionModeLabel(permissionMode) : '—'}
            </Select.Trigger>
            <Select.Content>
              {#each PERMISSION_MODES as option (option.value)}
                {@const locked =
                  option.value === 'bypassPermissions' &&
                  option.value !== permissionMode &&
                  !canRelaunch}
                <Select.Item
                  value={option.value}
                  label={option.label}
                  disabled={locked}
                  title={locked
                    ? 'This session has not started yet — try again in a moment'
                    : option.description} class={locked ? 'opacity-40' : ''}
                >
                  <span class="flex flex-col">
                    <span class={option.value === 'bypassPermissions' ? 'text-warning' : ''}>
                      {option.label}
                    </span>
                    <span class="text-xs text-muted-foreground">{option.description}</span>
                  </span>
                </Select.Item>
              {/each}
            </Select.Content>
          </Select.Root>

          <ModelCombobox
            value={currentModel}
            onchoose={chooseModel}
            class="text-xs text-muted-foreground"
          />
        </ButtonGroup.Root>

        <!-- What you can do to the session itself. -->
        <ButtonGroup.Root class="shrink-0">
          {@render verb({
            label: 'Fork',
            tip: 'Branch a side quest off this session',
            icon: IconFork,
            onclick: handleFork,
            disabled: !forkable || !wholeTranscript,
          })}
          {#if session?.scratch}
            {@render verb({
              label: 'Keep',
              tip: 'Promote this side quest to mainline work',
              icon: IconCheck,
              onclick: handleKeep,
            })}
            {@render verb({
              label: 'Discard',
              tip: "Delete this quest's worktree and its transcript, for good",
              icon: IconTrash,
              onclick: () => (confirmingDiscard = true),
              variant: 'destructive',
            })}
          {:else}
            {@render verb({
              label: 'Stop',
              tip: 'End this session',
              icon: IconStop,
              onclick: () => session && stopSession(viewId, session.machineId),
            })}
          {/if}
        </ButtonGroup.Root>
      {/if}
    </header>

    <!-- Two panes of one screen: they slide past each other rather than cutting,
         so the toggle reads as moving sideways instead of reloading. -->
    <!-- Named so the view toggle can point at what it swaps; the toggle is a group
         of two, not a tablist, so the panel does not claim the matching role. -->
    <!-- `min-w-0` so the column really gives way as the rail's gap grows; the
         chat reflows with it rather than being covered by it. -->
    <div class="relative min-h-0 min-w-0 flex-1" id="session-view-panel">
      {#if view === 'flow'}
        <div
          class="absolute inset-0"
          in:fly={{ x: 10, duration: painted ? 200 : 0, easing: quintOut }}
          out:fly={{ x: 10, duration: painted ? 150 : 0, easing: quintOut }}
        >
          <FlowView
            instanceId={viewId}
            messages={session?.messages ?? []}
            subagents={branches}
            streamingToolId={session?.currentTool?.toolId}
            {totalCostUsd}
            onJump={(nodeId) => {
              view = 'chat';
              const messages = session?.messages ?? [];
              const target = messages.find(
                (m) => m.sdkUuid === nodeId || m.id === nodeId || m.metadata?.toolId === nodeId
              );
              if (!target) return;
              const index = groups.findIndex((g) => {
                if (g.kind === 'single') return g.message.id === target.id || g.message.sdkUuid === target.sdkUuid;
                if (g.kind === 'tools') return g.messages.some((m) => m.id === target.id || m.sdkUuid === target.sdkUuid);
                return false;
              });
              if (index >= 0) void tick().then(() => jumpToMatch(index));
            }}
          />
        </div>
      {:else}
        <div
          class="absolute inset-0"
          in:fly={{ x: -10, duration: painted ? 200 : 0, easing: quintOut }}
          out:fly={{ x: -10, duration: painted ? 150 : 0, easing: quintOut }}
        >
          <div
            bind:this={scroller}
            onscroll={trackScroll}
            tabindex="-1"
            class="h-full space-y-4 overflow-y-auto overflow-x-hidden px-4 pt-4 pb-44 [overflow-anchor:none] focus:outline-none"
          >
            <div class="mx-auto max-w-4xl">
              {#if session?.hydrating}
                <div class="sticky top-0 z-10">
                  <div class="h-0.5 w-full overflow-hidden bg-muted">
                    <div class="h-full w-1/3 animate-pulse rounded-full bg-primary/40" style="animation: hydrate-slide 1.2s ease-in-out infinite;"></div>
                  </div>
                  <div
                    class="mx-auto mt-2 w-fit rounded-full bg-card px-3 py-1 text-micro text-muted-foreground shadow-sm"
                    transition:fly={{ y: -6, duration: 180, easing: quintOut }}
                  >
                    Loading earlier turns
                  </div>
                </div>
              {/if}
              <!-- Mounted once the scroller exists: virtua reads scrollRef once, on
                   mount, and silently falls back to its parent element if it is unset. -->
              {#if scroller}
                <Virtualizer
                  bind:this={vlistRaw}
                  data={groups}
                  getKey={groupKey}
                  scrollRef={scroller}
                  itemSize={120}
                  bufferSize={400}
                  shift={session?.hydrating ?? false}
                >
                  {#snippet children(group)}
                    <div class="pb-4 {groupKey(group) === flashKey ? 'transcript-flash' : ''}">
                      {#if group.kind === 'tools'}
                        <div class="flex justify-start gap-3">
                          <div
                            class="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl border border-border bg-secondary"
                          >
                            <IconTools class="size-[18px] text-muted-foreground" />
                          </div>
                          <div class="w-full max-w-[85%] min-w-0">
                            <ToolGroup tools={group.messages} />
                          </div>
                        </div>
                      {:else if group.kind === 'subagent'}
                        <div class="flex justify-start gap-3">
                          <div
                            class="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl border border-border bg-secondary"
                          >
                            <IconSubagent class="size-[18px] text-muted-foreground" />
                          </div>
                          <!-- The rail links straight to a branch; `scroll-margin`
                               keeps the jump clear of the sticky header. -->
                          <div
                            id="subagent-{group.branch.toolUseId}"
                            class="w-full max-w-[85%] min-w-0 scroll-mt-20"
                          >
                            <SubagentBranch branch={group.branch} spawn={group.spawn} />
                          </div>
                        </div>
                      {:else}
                        <ChatMessage message={group.message} instanceId={viewId} />
                      {/if}
                    </div>
                  {/snippet}
                </Virtualizer>
              {/if}

              {#if reading}
                <div class="flex flex-col items-center gap-2 py-8">
                  <IconSpinner class="size-5 animate-spin text-muted-foreground" />
                  <p class="text-caption">Reading transcript…</p>
                </div>
              {:else if sleeping}
                <!-- Not a failure, so nothing here is coloured like one: the work
                     is intact and one message would bring it back on its own. -->
                <div
                  class="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card px-4 py-3"
                >
                  <p class="min-w-0 flex-1 text-sm text-muted-foreground">
                    This session is sleeping — its process ended, but the conversation was kept.
                    Send a message, or pick it back up now.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    class="shrink-0 text-xs"
                    disabled={cockpit.status !== 'connected' || (session?.relaunching ?? false)}
                    onclick={handleRevive}
                  >
                    <IconPlay />
                    Resume
                  </Button>
                </div>
              {:else if groups.length === 0 && !session?.streaming}
                <p class="text-sm text-muted-foreground">
                  {browsing
                    ? 'This session recorded no messages.'
                    : 'Nothing said yet — send a message below to start.'}
                </p>
              {/if}

              {#if session?.streaming}
                <div class="max-w-prose text-body leading-relaxed text-foreground break-words">
                  <Markdown source={stream.text} /><span class="inline-block w-[3px] h-4 rounded-sm bg-primary/60 align-text-bottom animate-pulse"></span>
                </div>
              {/if}
            </div>
          </div>

          {#if searchOpen}
            <TranscriptSearch bind:this={search} {groups} onJump={jumpToMatch} onClose={closeSearch} />
          {/if}

          {#if unseen}
            <div class="absolute inset-x-0 bottom-4 flex justify-center">
              <Button
                variant="outline"
                size="sm"
                class="rounded-full bg-card px-4 text-xs shadow-lg pressable"
                onclick={jumpToLatest}
              >
                <IconArrowDown />
                Jump to latest
              </Button>
            </div>
          {/if}
        </div>
      {/if}

      <!-- Content blurs and dissolves as it slides under the floating dock -->
      <div class="pointer-events-none absolute inset-x-0 bottom-0 h-32">
        <div
          class="absolute inset-0 backdrop-blur-sm"
          style="mask-image: linear-gradient(to bottom, transparent, black 70%); -webkit-mask-image: linear-gradient(to bottom, transparent, black 70%);"
        ></div>
        <div class="absolute inset-0 bg-linear-to-t from-background/80 via-background/25 to-transparent"></div>
      </div>

      <div class="pointer-events-none absolute inset-x-0 bottom-0 px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div bind:this={dock} class="pointer-events-auto mx-auto flex max-w-4xl flex-col gap-2">
        {#if sendError}
          <div
            class="flex items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive"
            role="alert"
            transition:fly={{ y: 4, duration: 180, easing: quintOut }}
          >
            <span class="min-w-0 flex-1">Send failed: {sendError}</span>
            <button
              type="button"
              class="shrink-0 rounded-md bg-destructive/10 px-2 py-1 font-medium text-destructive hover:bg-destructive/20 transition-colors"
              onclick={retrySend}
            >
              Retry
            </button>
            <button
              type="button"
              class="shrink-0 text-destructive/60 hover:text-destructive transition-colors"
              onclick={() => { sendError = null; restoredDraft = null; }}
              aria-label="Dismiss"
            >
              &times;
            </button>
          </div>
        {/if}
        {#if error}
          {#key error}
            <p class="animate-shake text-xs text-error motion-reduce:animate-none" role="alert">
              {error}
            </p>
          {/key}
        {/if}
        {#if browsing}
          <div class="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-lg">
            <span class="text-sm text-muted-foreground">
              Read-only transcript of a stored session.
            </span>
            <!-- The two ways on from a stored transcript, in the order they read:
                 branch it, or pick it back up. -->
            <ButtonGroup.Root class="ml-auto">
              <Button
                variant="outline"
                disabled={!wholeTranscript || cockpit.status !== 'connected'}
                onclick={handleFork}
              >
                <IconFork />
                Fork
              </Button>
              <Button
                disabled={!wholeTranscript || cockpit.status !== 'connected'}
                onclick={handleResume}
              >
                <IconPlay />
                Resume session
              </Button>
            </ButtonGroup.Root>
          </div>
        {:else}
          {#if session?.relaunching}
            <!-- Covers both ways the process is replaced: a mode only a new one
                 can take, and a sleeping session being woken. -->
            <p class="text-xs text-muted-foreground">Picking this session back up…</p>
          {/if}
          {#if session?.scratch}
            <p class="text-xs text-muted-foreground">
              Side quest — hidden from your history. Discard deletes it for good.
            </p>
          {/if}
          <ChatInput
            bind:this={chatInputRef}
            onSend={handleSend}
            onInterrupt={handleInterrupt}
            streaming={session?.busy ?? false}
            disabled={cockpit.status !== 'connected' || (session?.relaunching ?? false) || machineOffline}
            attachmentOpen={answerable.length > 0}
            {commands}
            onCommandsNeeded={askCommands}
            {peers}
            onHandoff={handleHandoff}
          >
            {#snippet meter()}
              {#if handoffNote}
                <span
                  class="mr-1 shrink-0 rounded-md bg-primary/10 px-2 py-1 text-xs text-primary"
                  transition:fly={{ y: 4, duration: 150, easing: quintOut }}
                >
                  {handoffNote}
                </span>
              {/if}
              <ContextMeter
                usage={session?.context ?? null}
                status={session?.sdkStatus ?? null}
                compaction={session?.lastCompaction ?? null}
                onrefresh={askContext}
              />
            {/snippet}
            {#snippet attachment()}
              <PermissionStack requests={answerable} onResolve={handleResolve} />
            {/snippet}
          </ChatInput>
        {/if}
        </div>
      </div>
    </div>
  </div>

  <!-- Always mounted: the kit slides the rail in and animates the gap the
       chat shrinks into, which a panel mounted on demand cannot do. -->
  {#if !browsing && session?.machineId && session.cwd}
    <SessionContext
      instanceId={viewId}
      machineId={session.machineId}
      cwd={session.cwd}
      servers={session.mcp ?? null}
      {commands}
      model={session.model}
      permissionMode={session.permissionMode}
      sessionId={session.sessionId}
      hostname={machine?.hostname ?? null}
      {totalCostUsd}
      lastActivityAt={session.lastActivityAt}
      branches={[...branches.values()]}
    />
  {/if}
</Sidebar.Provider>
