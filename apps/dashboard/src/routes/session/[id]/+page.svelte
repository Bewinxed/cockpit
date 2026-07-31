<script lang="ts">
  import { untrack } from 'svelte';
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
  /** Whether the reader is parked at the live edge — measured before every growth. */
  let atBottom = $state(true);
  let unseen = $state(false);

  function trackScroll() {
    if (!scroller) return;
    atBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
    if (atBottom) unseen = false;
  }

  function jumpToLatest() {
    if (!scroller) return;
    scroller.scrollTop = scroller.scrollHeight;
    unseen = false;
  }

  // Chasing the bottom while the user is reading further up yanks the transcript
  // out from under them — only follow when they were already at the live edge.
  $effect(() => {
    const count = session?.messages.length ?? 0;
    const streaming = session?.streaming ?? '';
    if (!scroller || (!count && !streaming)) return;
    if (untrack(() => atBottom)) scroller.scrollTop = scroller.scrollHeight;
    else unseen = true;
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

  let view = $state<'chat' | 'flow'>('chat');

  /** The tool in flight, named in the header's live region while it runs. */
  const runningTool = $derived(session?.currentTool ? ` · ${session.currentTool.name}` : '');

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
        {ACTIVITY_LABEL[cockpit.activityOf(viewId)]}{runningTool} · hub {cockpit.status}
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
          class="rounded px-2 py-0.5 text-xs capitalize transition-colors focus-visible:ring-2 focus-visible:ring-ring {view ===
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

  {#if view === 'flow'}
    <div class="min-h-0 flex-1" id="session-view-panel" role="tabpanel">
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
    <div class="relative min-h-0 flex-1" id="session-view-panel" role="tabpanel">
      <div
        bind:this={scroller}
        onscroll={trackScroll}
        class="h-full space-y-4 overflow-y-auto px-4 py-4"
      >
        <div class="mx-auto flex max-w-3xl flex-col gap-4">
          {#each groups as group (group.kind === 'single' ? group.message.id : `${group.kind}-${group.index}`)}
            {#if group.kind === 'tools'}
              <ToolGroup tools={group.messages} />
            {:else if group.kind === 'subagent'}
              <SubagentBranch branch={group.branch} spawn={group.spawn} />
            {:else}
              <ChatMessage message={group.message} instanceId={viewId} />
            {/if}
          {/each}

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
            <div class="flex justify-start">
              <div
                class="max-w-[85%] rounded-2xl rounded-bl-sm border border-border bg-card px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap text-card-foreground shadow-sm"
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

  <div class="border-t border-border px-4 py-3">
    <div class="mx-auto flex max-w-3xl flex-col gap-2">
      {#if error}
        <p class="text-xs text-error" role="alert">{error}</p>
      {/if}
      {#if browsing}
        <div class="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
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
