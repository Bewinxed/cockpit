<script lang="ts">
  import { IconAgent, IconSubagent, IconTools } from '$lib/icons';
  import { onMount, tick, untrack } from 'svelte';
  import { fly } from 'svelte/transition';
  import { quintOut } from 'svelte/easing';
  import { Virtualizer } from 'virtua/svelte';
  import type { VirtualizerHandle } from 'virtua/svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import type { PermissionResult } from '@cockpit/core';
  import { ChatInput, ChatMessage, SubagentBranch, ToolGroup } from '$lib/components/features';
  import { FlowView } from '$lib/components/features/flow';
  import PermissionCard from '$lib/cockpit/PermissionCard.svelte';
  import { ACTIVITY_LABEL } from '$lib/cockpit/activity';
  import {
    backfillSession,
    cockpit,
    discardSession,
    forkSession,
    interrupt,
    keepSession,
    openSession,
    openTranscript,
    resolvePermission,
    resumeSession,
    sendText,
    stopSession,
  } from '$lib/cockpit/client.svelte';
  import type { Message } from '$lib/cockpit/types';
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
  let vlist = $state<VirtualizerHandle | null>(null);
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

  type Group =
    | { kind: 'single'; message: Message; index: number }
    | { kind: 'tools'; messages: Message[]; index: number }
    | { kind: 'subagent'; branch: SubagentState; spawn: Message; index: number };

  const isTool = (message: Message) => message.type === 'tool.use' || message.type === 'tool.result';

  const subagents = $derived(session?.subagents ?? {});

  /** The branch a Task tool.use opened, if this session has one for it. */
  const branchOf = (message: Message): SubagentState | undefined => {
    const toolId = message.metadata?.toolId;
    return toolId ? subagents[toolId] : undefined;
  };

  // Consecutive tool calls collapse into one ToolGroup, as MessageList does; a
  // Task call becomes its branch card instead, so the subagent it spawned reads
  // as one line until the user opens it.
  const groups = $derived.by((): Group[] => {
    const messages = session?.messages ?? [];
    const result: Group[] = [];
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

  // A transcript opens on its last line. The groups arrive after the view
  // mounts and virtua only estimates their heights until they measure, so the
  // anchor waits a tick and then lets scrollToIndex correct itself.
  $effect(() => {
    if (anchored || !groups.length) return;
    anchored = true;
    void tick().then(pinToLatest);
  });

  let view = $state<'chat' | 'flow'>('chat');

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

  function handleSend(text: string) {
    if (!session) return;
    sendText(viewId, session.machineId, text);
  }

  function handleInterrupt() {
    if (!session) return;
    interrupt(viewId, session.machineId);
  }

  function handleResolve(requestId: string, result: PermissionResult) {
    if (!session) return;
    resolvePermission(viewId, session.machineId, requestId, result);
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
</script>

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
      <button
        type="button"
        class={action}
        disabled={!forkable}
        title="Branch a side quest off this session"
        onclick={handleFork}
      >
        Fork
      </button>
      {#if session?.scratch}
        {#if confirmingDiscard}
          <span class="hidden shrink-0 text-xs text-muted-foreground lg:inline">
            Deletes this quest's worktree and closes the session.
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
          class="h-full space-y-4 overflow-y-auto overflow-x-hidden px-4 pt-4 pb-44 [overflow-anchor:none]"
        >
          <div class="mx-auto max-w-4xl">
            <!-- Mounted once the scroller exists: virtua reads scrollRef once, on
                 mount, and silently falls back to its parent element if it is unset. -->
            {#if scroller}
              <Virtualizer
                bind:this={vlist}
                data={groups}
                getKey={(g) =>
                  g.kind === 'single' ? (g.message.id ?? `single-${g.index}`) : `${g.kind}-${g.index}`}
                scrollRef={scroller}
                itemSize={120}
                bufferSize={400}
              >
                {#snippet children(group)}
                  <div class="pb-4">
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
                  class="max-w-[85%] min-w-0 rounded-2xl rounded-bl-sm border border-border bg-card px-4 py-3 text-sm leading-relaxed break-words whitespace-pre-wrap text-card-foreground shadow-sm"
                >
                  {session.streaming}
                </div>
              </div>
            {/if}
          </div>
        </div>

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
      <div class="pointer-events-auto mx-auto flex max-w-4xl flex-col gap-2">
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
            disabled={session?.loading || cockpit.status !== 'connected'}
            onclick={handleFork}
          >
            Fork
          </button>
          <button
            type="button"
            class="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
            disabled={session?.loading || cockpit.status !== 'connected'}
            onclick={handleResume}
          >
            Resume session
          </button>
        </div>
      {:else}
        {#if session?.ephemeral}
          <p class="text-xs text-muted-foreground">
            Session is ephemeral — future turns continue live only, nothing is written to session
            storage.
          </p>
        {/if}
        <ChatInput
          onSend={handleSend}
          onInterrupt={handleInterrupt}
          streaming={session?.busy ?? false}
          disabled={cockpit.status !== 'connected'}
          attachmentOpen={(session?.pending.length ?? 0) > 0}
        >
          {#snippet attachment()}
            {#each session?.pending ?? [] as request (request.requestId)}
              <PermissionCard {request} onResolve={handleResolve} />
            {/each}
          {/snippet}
        </ChatInput>
      {/if}
      </div>
    </div>
  </div>
</div>
