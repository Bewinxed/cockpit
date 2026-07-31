<script lang="ts">
  import { untrack } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import type { PermissionResult } from '@cockpit/core';
  import { ChatInput, ChatMessage, ToolGroup } from '$lib/components/features';
  import PermissionCard from '$lib/cockpit/PermissionCard.svelte';
  import {
    cockpit,
    interrupt,
    openSession,
    openTranscript,
    resolvePermission,
    resumeSession,
    sendText,
    stopSession,
  } from '$lib/cockpit/client.svelte';
  import type { Message } from '$lib/cockpit/types';

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
    | { kind: 'tools'; messages: Message[]; index: number };

  const isTool = (message: Message) => message.type === 'tool.use' || message.type === 'tool.result';

  // Consecutive tool calls collapse into one ToolGroup, as MessageList does.
  const groups = $derived.by((): Group[] => {
    const messages = session?.messages ?? [];
    const result: Group[] = [];
    let i = 0;
    while (i < messages.length) {
      if (!isTool(messages[i])) {
        result.push({ kind: 'single', message: messages[i], index: i });
        i++;
        continue;
      }
      const start = i;
      const tools: Message[] = [];
      while (i < messages.length && isTool(messages[i])) {
        tools.push(messages[i]);
        i++;
      }
      result.push({ kind: 'tools', messages: tools, index: start });
    }
    return result;
  });

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
</script>

<div class="flex h-full flex-1 flex-col overflow-hidden">
  <header class="flex items-center gap-3 border-b border-border px-4 py-2">
    <a href="/session" class="text-sm text-muted-foreground hover:text-foreground">Sessions</a>
    <span class="truncate font-mono text-sm">{session?.cwd || viewId}</span>
    <span class="ml-auto shrink-0 text-xs text-muted-foreground">
      {#if browsing}
        transcript · {session?.loading ? 'loading' : `${session?.messages.length ?? 0} messages`}
      {:else}
        {session?.busy ? 'working' : 'idle'} · hub {cockpit.status}
      {/if}
    </span>
    {#if !browsing}
      <button
        type="button"
        class="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        onclick={() => session && stopSession(viewId, session.machineId)}
      >
        Stop
      </button>
    {/if}
  </header>

  <div bind:this={scroller} class="flex-1 space-y-4 overflow-y-auto px-4 py-4">
    <div class="mx-auto flex max-w-3xl flex-col gap-4">
      {#each groups as group (group.kind === 'tools' ? `tools-${group.index}` : group.message.id)}
        {#if group.kind === 'tools'}
          <ToolGroup tools={group.messages} />
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

  <div class="border-t border-border px-4 py-3">
    <div class="mx-auto max-w-3xl">
      {#if browsing}
        <div class="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
          <span class="text-sm text-muted-foreground">
            Read-only transcript of a stored session.
          </span>
          <button
            type="button"
            class="ml-auto rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
            disabled={session?.loading || cockpit.status !== 'connected'}
            onclick={handleResume}
          >
            Resume session
          </button>
        </div>
      {:else}
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
