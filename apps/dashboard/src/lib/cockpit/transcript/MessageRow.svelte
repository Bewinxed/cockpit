<script lang="ts">
  /** Dispatches one stand-alone transcript message to its renderer by type. */
  import type { Message } from '../types';
  import Who from './Who.svelte';
  import MessageBody from './MessageBody.svelte';
  import Thinking from './Thinking.svelte';
  import Peer from './Peer.svelte';
  import SystemLine from './SystemLine.svelte';

  let { message, agentName }: { message: Message; agentName: string } = $props();

  const kind = $derived(message.type);
  const hidden = $derived(
    kind === 'result.success' || (kind === 'assistant' && !message.content.trim())
  );
</script>

{#if hidden}
  <!-- A successful result has no line; an empty assistant frame carried only a tool call. -->
{:else if kind === 'user'}
  <section class="turn">
    <Who you name="You" />
    <MessageBody source={message.content} />
    {#if message.metadata?.attachments?.length || message.metadata?.images?.length}
      <div class="chips">
        {#each message.metadata.attachments ?? [] as att}
          <span class="chip">{att.name} · {att.chars} chars</span>
        {/each}
        {#each message.metadata.images ?? [] as _img}
          <span class="chip">image</span>
        {/each}
      </div>
    {/if}
  </section>
{:else if kind === 'assistant'}
  <section class="turn">
    <Who name={agentName} />
    <MessageBody source={message.content} />
  </section>
{:else if kind === 'thinking'}
  {#if message.content.trim()}
    <Thinking text={message.content} />
  {/if}
{:else if kind === 'user.peer'}
  <Peer {message} />
{:else}
  <SystemLine {message} />
{/if}

<style>
  .turn {
    margin-top: 14px;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 6px;
  }
  .chip {
    font-size: var(--text-xs);
    color: var(--ink-muted);
    background: var(--surface-sunken);
    border-radius: var(--radius-mark);
    padding: 2px 7px;
  }
</style>
