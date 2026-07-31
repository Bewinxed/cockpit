<script lang="ts">
  import { untrack } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import type { PermissionResult } from '@cockpit/core';
  import { ChatInput, ChatMessage, SubagentBranch, ToolGroup } from '$lib/components/features';
  import { FlowView } from '$lib/components/features/flow';
  import PermissionCard from '$lib/cockpit/PermissionCard.svelte';
  import {
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

  let scroller = $state<HTMLDivElement | null>(null);

  $effect(() => {
    const count = session?.messages.length ?? 0;
    const streaming = session?.streaming ?? '';
    if (scroller && (count || streaming)) scroller.scrollTop = scroller.scrollHeight;
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

  async function handleDiscard() {
    if (!session) return;
    error = null;
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
    'shrink-0 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40';
</script>

<div class="flex h-full flex-1 flex-col overflow-hidden">
  <header class="flex items-center gap-3 border-b border-border px-4 py-2">
    <a href="/session" class="text-sm text-muted-foreground hover:text-foreground">Sessions</a>
    <span class="truncate font-mono text-sm">{session?.cwd || viewId}</span>
    {#if session?.scratch}
      <span
        class="shrink-0 rounded-sm border border-dashed border-border px-1.5 py-0.5 text-[10px] tracking-wide text-muted-foreground uppercase"
      >
        side quest
      </span>
    {/if}
    <span class="ml-auto shrink-0 text-xs text-muted-foreground">
      {#if browsing}
        transcript · {session?.loading ? 'loading' : `${session?.messages.length ?? 0} messages`}
      {:else}
        {cockpit.activityOf(viewId)} · hub {cockpit.status}
      {/if}
    </span>

    <div class="flex shrink-0 items-center gap-0.5 rounded-md border border-border p-0.5">
      {#each ['chat', 'flow'] as const as mode (mode)}
        <button
          type="button"
          class="rounded px-2 py-0.5 text-xs capitalize transition-colors {view === mode
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
        <button type="button" class={action} onclick={handleKeep}>Keep</button>
        <button type="button" class={action} onclick={handleDiscard}>Discard</button>
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
    <div class="min-h-0 flex-1">
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
    <div bind:this={scroller} class="flex-1 space-y-4 overflow-y-auto px-4 py-4">
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
  {/if}

  <div class="border-t border-border px-4 py-3">
    <div class="mx-auto flex max-w-3xl flex-col gap-2">
      {#if error}
        <p class="text-xs text-error">{error}</p>
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
