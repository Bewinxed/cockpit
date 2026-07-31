<script lang="ts">
  import { IconAgent, IconSubagent, IconTools } from '$lib/icons';
  import { onMount, tick, untrack } from 'svelte';
  import Markdown from '@humanspeak/svelte-markdown';
import { PROSE } from '$lib/prose';
import { fly } from 'svelte/transition';
  import { quintOut } from 'svelte/easing';
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
  import PermissionStack from '$lib/cockpit/PermissionStack.svelte';
  import { ACTIVITY_LABEL } from '$lib/cockpit/activity';
  import type { PendingPermission, PermissionAnswer } from '$lib/cockpit/client.svelte';
  import {
    backfillSession,
    cockpit,
    discardSession,
    forkSession,
    interrupt,
    keepSession,
    openSession,
    openTranscript,
    permissionAnswer,
    relaunchSession,
    resolvePermission,
    resumeSession,
    sendOrRevive,
    setPermissionMode,
    stopSession,
  } from '$lib/cockpit/client.svelte';
  import { isTyping } from '$lib/utils/typing';
  import type { SendExtras } from '$lib/cockpit/client.svelte';
  import { PERMISSION_MODES, permissionModeLabel } from '$lib/cockpit/permission-modes';
  import * as Select from '$lib/components/ui/select';
  import { sessionFailedMessage } from '$lib/cockpit/frames';
  import type { Message, TranscriptGroup } from '$lib/cockpit/types';
  import type { SubagentState } from '$lib/utils/flow-types';

  const viewId = $derived(page.params.id ?? '');
  /** A `machine` in the query means this id is a stored session, not a live one. */
  const browsing = $derived(page.url.searchParams.get('machine'));
  const browsingCwd = $derived(page.url.searchParams.get('cwd') ?? '');

  // Opening writes to the store, so it stays in an effect; the read is derived.
  // Untracked, or the store reads it makes would re-arm this effect against the
  // very fields it writes — a transcript that comes back empty would reload forever.
  $effect(() => {
    const machineId = browsing;
    const cwd = browsingCwd;
    const id = viewId;
    untrack(() => {
      anchored = false;
      if (machineId) void openTranscript({ viewId: id, machineId, sessionId: id, cwd });
      else openSession(id);
    });
  });
  const session = $derived(cockpit.session(viewId));

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
  }

  // Virtua keeps re-applying scrollToIndex while the items it landed on are
  // still being measured, so it beats a raw write to an estimated scrollHeight.
  // It only knows its own items, though — a streaming reply renders after the
  // list, and the last group's end is not the end of the column.
  function pinToLatest() {
    if (!scroller) return;
    if (vlist && groups.length && !session?.streaming) {
      vlist.scrollToIndex(groups.length - 1, { align: 'end' });
    } else {
      scroller.scrollTop = scroller.scrollHeight;
    }
  }

  function jumpToLatest() {
    pinToLatest();
    unseen = false;
  }

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
    node.addEventListener('click', noteToggle, true);
    return () => {
      follow.disconnect();
      node.removeEventListener('click', noteToggle, true);
    };
  });

  // Chasing the bottom while the user is reading further up yanks the transcript
  // out from under them — so growth behind their scroll position is flagged instead.
  $effect(() => {
    const count = session?.messages.length ?? 0;
    const streaming = session?.streaming ?? '';
    if (!count && !streaming) return;
    if (!untrack(() => atBottom)) unseen = true;
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

  // A session that died with nothing to show for it. The row is what explains
  // it, live or long afterwards. A session merely stopped before it said
  // anything has nothing to explain — only one that died of something does.
  const failure = $derived.by((): Message | null => {
    if (browsing || said.length > 0) return null;
    const row = cockpit.instances.find((instance) => instance.id === viewId);
    if (!row || (row.status !== 'error' && row.status !== 'stopped') || !row.lastError) return null;
    return sessionFailedMessage(viewId, row.lastError);
  });

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

  let searchOpen = $state(false);
  let search = $state<ReturnType<typeof TranscriptSearch> | null>(null);
  let dock = $state<HTMLDivElement | null>(null);
  /** The group a search jump landed on, ringed until the reader has found it. */
  let flashKey = $state<string | null>(null);
  let flashTimer: ReturnType<typeof setTimeout>;

  function handleKeydown(event: KeyboardEvent) {
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
   * The permission the stack shows on top is the one the keyboard answers: the
   * card the eye is on, and the only one that shows the hints.
   */
  function answerPending(event: KeyboardEvent) {
    const request = session?.pending[0];
    if (!request || event.metaKey || event.ctrlKey || event.altKey || isTyping()) return;
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

  function handleSend(text: string, extras: SendExtras) {
    if (!session) return;
    void sendOrRevive(viewId, session.machineId, text, extras);
  }

  function handleInterrupt() {
    if (!session) return;
    interrupt(viewId, session.machineId);
  }

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

  const permissionMode = $derived(session?.permissionMode ?? 'default');

  /**
   * The SDK will not switch a running session into bypass, so choosing it means
   * relaunching on the SDK session this one named. Offering it before there is
   * one is what would surface the SDK's refusal as an error, so it waits.
   */
  const canRelaunch = $derived(Boolean(session?.sessionId));

  /** Bypass throws the current turn away, so it asks once before it does. */
  let confirmingBypass = $state(false);

  function chooseMode(value: string) {
    const mode = value as PermissionMode;
    if (mode === permissionMode) return;
    if (mode === 'bypassPermissions') {
      confirmingBypass = true;
      return;
    }
    void handlePermissionMode(mode);
  }

  async function relaunchInBypass() {
    if (!session) return;
    confirmingBypass = false;
    error = null;
    try {
      await relaunchSession(viewId, session.machineId, 'bypassPermissions');
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

  const action =
    'shrink-0 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40';
  const destructive =
    'shrink-0 rounded-md border border-error bg-error px-2 py-1 text-xs text-error-foreground transition-colors hover:bg-error/90 focus-visible:ring-2 focus-visible:ring-ring';
  const dangerous =
    'shrink-0 rounded-md border border-warning px-2 py-1 text-xs font-medium text-warning transition-colors hover:bg-warning/10 focus-visible:ring-2 focus-visible:ring-ring';
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="flex h-full flex-1 flex-col overflow-hidden">
  <header class="flex items-center gap-3 border-b border-border px-4 py-2">
    <a href="/session" class="text-sm text-muted-foreground hover:text-foreground">Sessions</a>
    <h1 class="truncate font-mono text-sm font-normal">{session?.cwd || viewId}</h1>
    {#if session?.scratch}
      <span
        class="shrink-0 rounded-sm border border-dashed border-muted-foreground/40 px-1.5 py-0.5 text-[10px] tracking-wide text-muted-foreground uppercase"
      >
        side quest
      </span>
    {/if}
    <span
      class="ml-auto flex min-h-6 shrink-0 items-center text-xs text-muted-foreground"
      role="status"
      aria-live="polite"
    >
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
          </span>{runningTool} · hub {cockpit.status}
        </span>
      {/if}
    </span>

    <div
      class="flex shrink-0 items-center gap-0.5 rounded-md border border-border p-0.5"
      role="tablist"
      aria-label="Session view"
    >
      {#each ['chat', 'flow'] as const as mode (mode)}
        <button
          type="button"
          role="tab"
          aria-selected={view === mode}
          aria-controls="session-view-panel"
          class="rounded-[10px] px-2 py-0.5 text-xs capitalize transition-colors focus-visible:ring-2 focus-visible:ring-ring {view ===
          mode
            ? 'bg-accent text-foreground'
            : 'text-muted-foreground hover:text-foreground'}"
          onclick={() => (view = mode)}
        >
          {mode}
        </button>
      {/each}
    </div>

    {#if !browsing}
      {#if confirmingBypass}
        <span class="hidden shrink-0 text-xs text-muted-foreground lg:inline">
          Relaunches the session with all permissions granted. The current turn stops.
        </span>
        <button type="button" class={action} onclick={() => (confirmingBypass = false)}>
          Cancel
        </button>
        <button type="button" class={dangerous} onclick={relaunchInBypass}>
          Relaunch in bypass
        </button>
      {:else}
        <Select.Root type="single" value={permissionMode} onValueChange={chooseMode}>
          <Select.Trigger
            aria-label="Permission mode"
            title="How this session answers tool permissions"
            class="min-h-7 w-auto shrink-0 gap-1 px-2 py-0 text-xs {permissionMode ===
            'bypassPermissions'
              ? 'font-medium text-warning'
              : 'text-muted-foreground'}"
          >
            {permissionModeLabel(permissionMode)}
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
                  : option.description}
                class="text-foreground {locked ? 'opacity-40' : ''}"
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
      {/if}
      <button
        type="button"
        class={action}
        disabled={!forkable || !wholeTranscript}
        title="Branch a side quest off this session"
        onclick={handleFork}
      >
        Fork
      </button>
      {#if session?.scratch}
        {#if confirmingDiscard}
          <span class="hidden shrink-0 text-xs text-muted-foreground lg:inline">
            Deletes this quest's worktree and its transcript, for good.
          </span>
          <button type="button" class={action} onclick={() => (confirmingDiscard = false)}>
            Cancel
          </button>
          <button type="button" class={destructive} onclick={handleDiscard}>
            Discard side quest
          </button>
        {:else}
          <button type="button" class={action} onclick={handleKeep}>Keep</button>
          <button type="button" class={action} onclick={() => (confirmingDiscard = true)}>
            Discard…
          </button>
        {/if}
      {:else}
        <button
          type="button"
          class={action}
          onclick={() => session && stopSession(viewId, session.machineId)}
        >
          Stop
        </button>
      {/if}
    {/if}
  </header>

  <!-- Two panes of one screen: they slide past each other rather than cutting,
       so the toggle reads as moving sideways instead of reloading. -->
  <div class="relative min-h-0 flex-1" id="session-view-panel" role="tabpanel">
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
          onJump={() => (view = 'chat')}
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
                        <div class="w-full max-w-[85%] min-w-0">
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

            {#if session?.loading}
              <p class="text-sm text-muted-foreground">Reading transcript…</p>
            {:else if groups.length === 0 && !session?.streaming}
              <p class="text-sm text-muted-foreground">
                {browsing
                  ? 'This session recorded no messages.'
                  : 'Nothing said yet — send a message below to start.'}
              </p>
            {/if}

            {#if session?.streaming}
              <div class="flex justify-start gap-3">
                <div
                  class="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl border border-border bg-secondary"
                >
                  <IconAgent class="size-[18px] text-muted-foreground" />
                </div>
                <div
                  class="max-w-[85%] min-w-0 rounded-2xl rounded-bl-sm border border-border bg-card px-4 py-3 text-sm leading-relaxed break-words text-card-foreground shadow-sm"
                >
                  <!-- The stream renders as markdown too — raw asterisks mid-turn
                       read as a bug, and long resumed turns stream for minutes. -->
                  <div class={PROSE}>
                    <Markdown source={session.streaming} options={{ breaks: true }} />
                  </div>
                </div>
              </div>
            {/if}
          </div>
        </div>

        {#if searchOpen}
          <TranscriptSearch bind:this={search} {groups} onJump={jumpToMatch} onClose={closeSearch} />
        {/if}

        {#if unseen}
          <button
            type="button"
            class="absolute right-4 bottom-4 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-foreground shadow-md transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
            onclick={jumpToLatest}
          >
            Jump to latest
          </button>
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
      {#if error}
        <!-- Keyed so a second failure shakes again instead of sitting there. -->
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
          <button
            type="button"
            class="ml-auto {action}"
            disabled={!wholeTranscript || cockpit.status !== 'connected'}
            onclick={handleFork}
          >
            Fork
          </button>
          <button
            type="button"
            class="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
            disabled={!wholeTranscript || cockpit.status !== 'connected'}
            onclick={handleResume}
          >
            Resume session
          </button>
        </div>
      {:else}
        {#if session?.relaunching}
          <p class="text-xs text-muted-foreground">Relaunching with new permissions…</p>
        {/if}
        {#if session?.scratch}
          <p class="text-xs text-muted-foreground">
            Side quest — hidden from your history. Discard deletes it for good.
          </p>
        {/if}
        <ChatInput
          onSend={handleSend}
          onInterrupt={handleInterrupt}
          streaming={session?.busy ?? false}
          disabled={cockpit.status !== 'connected' || (session?.relaunching ?? false)}
          attachmentOpen={(session?.pending.length ?? 0) > 0}
        >
          {#snippet attachment()}
            <PermissionStack requests={session?.pending ?? []} onResolve={handleResolve} />
          {/snippet}
        </ChatInput>
      {/if}
      </div>
    </div>
  </div>
</div>
