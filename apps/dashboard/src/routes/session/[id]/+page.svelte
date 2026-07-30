<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import type { PermissionResult } from '@cockpit/core';
  import { ChatInput, ChatMessage, ToolGroup } from '$lib/components/features';
  import PermissionCard from '$lib/cockpit/PermissionCard.svelte';
  import {
    cockpit,
    ensureConnected,
    interrupt,
    openSession,
    resolvePermission,
    sendText,
    stopSession,
  } from '$lib/cockpit/client.svelte';
  import type { Message } from '$lib/stores/types';

  const instanceId = $derived(page.params.id ?? '');

  // Opening writes to the store, so it stays in an effect; the read is derived.
  $effect(() => {
    openSession(instanceId);
  });
  const session = $derived(cockpit.session(instanceId));

  onMount(ensureConnected);

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
    sendText(instanceId, session.machineId, text);
  }

  function handleInterrupt() {
    if (!session) return;
    interrupt(instanceId, session.machineId);
  }

  function handleResolve(requestId: string, result: PermissionResult) {
    if (!session) return;
    resolvePermission(instanceId, session.machineId, requestId, result);
  }
</script>

<div class="flex h-full flex-1 flex-col overflow-hidden">
  <header class="flex items-center gap-3 border-b border-border px-4 py-2">
    <a href="/session" class="text-sm text-muted-foreground hover:text-foreground">Sessions</a>
    <span class="font-mono text-sm">{session?.cwd || instanceId}</span>
    <span class="ml-auto text-xs text-muted-foreground">
      {session?.busy ? 'working' : 'idle'} · hub {cockpit.status}
    </span>
    <button
      type="button"
      class="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      onclick={() => session && stopSession(instanceId, session.machineId)}
    >
      Stop
    </button>
  </header>

  <div bind:this={scroller} class="flex-1 space-y-4 overflow-y-auto px-4 py-4">
    <div class="mx-auto flex max-w-3xl flex-col gap-4">
      {#each groups as group (group.kind === 'tools' ? `tools-${group.index}` : group.message.id)}
        {#if group.kind === 'tools'}
          <ToolGroup tools={group.messages} />
        {:else}
          <ChatMessage message={group.message} {instanceId} />
        {/if}
      {/each}

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
    </div>
  </div>
</div>
