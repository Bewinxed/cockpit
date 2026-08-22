<script lang="ts">
  /** Dispatches one stand-alone transcript message to its renderer by type. */
  import type { Message } from '../types';
  import Who from './Who.svelte';
  import MessageBody from './MessageBody.svelte';
  import Thinking from './Thinking.svelte';
  import Peer from './Peer.svelte';
  import SystemLine from './SystemLine.svelte';
  import { Badge } from '$lib/components/ui/badge';

  /** A token-dressed micro count badge — shadcn Badge, off the stock 4/8/12
   *  ladder and onto the DESIGN.md scale so it never reads as stock shadcn. */
  const chipClass =
    'h-auto rounded-[var(--radius-mark)] border-transparent bg-[var(--surface-sunken)] ' +
    'px-[var(--space-2)] py-px text-[length:var(--text-xs)] font-[var(--weight-body)] ' +
    'text-[color:var(--ink-muted)]';

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
          <Badge variant="secondary" class={chipClass}>{att.name} · {att.chars} chars</Badge>
        {/each}
        {#each message.metadata.images ?? [] as _img}
          <Badge variant="secondary" class={chipClass}>image</Badge>
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
    margin-top: var(--space-4);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-top: var(--space-2);
  }
</style>
