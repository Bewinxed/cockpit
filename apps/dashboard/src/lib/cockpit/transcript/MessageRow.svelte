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
    '!text-[color:var(--ink-muted)]';

  let { message, agentName }: { message: Message; agentName: string } = $props();

  const kind = $derived(message.type);
  const hidden = $derived(
    kind === 'result.success' || (kind === 'assistant' && !message.content.trim())
  );
</script>

{#if hidden}
  <!-- A successful result has no line; an empty assistant frame carried only a tool call. -->
{:else if kind === 'user'}
  <!-- The reader's own turn is the one thing worth finding on a fast scroll, so
       it is the one thing that carries a surface: a sunken well. User messages
       are sparse, so filling them makes the operator's own instructions the
       landmarks. The agent's turns stay bare on the field. -->
  <section class="turn you">
    <Who you name="You" timestamp={message.timestamp} />
    <MessageBody source={message.content} />
    {#if message.metadata?.attachments?.length || message.metadata?.images?.length}
      <div class="chips">
        {#each message.metadata.attachments ?? [] as att}
          <Badge variant="secondary" class={chipClass}>{att.name} · {att.chars} chars</Badge>
        {/each}
        {#each message.metadata.images ?? [] as img, i}
          {#if img.dataUri}
            <img class="shot" src={img.dataUri} alt="Image {i + 1} sent with this message" />
          {:else}
            <!-- A stored transcript can name an image it no longer carries. -->
            <Badge variant="secondary" class={chipClass}>Image {i + 1} · {img.mediaType}</Badge>
          {/if}
        {/each}
      </div>
    {/if}
  </section>
{:else if kind === 'assistant'}
  <section class="turn">
    <Who name={agentName} timestamp={message.timestamp} />
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
  /* The well bleeds back out by exactly its own padding, so the reader's words
     sit on the same ledger column as the agent's and only the wash widens.
     --space-4 (14px) fits inside the transcript's gutters (25 left / 21 right)
     with room to spare; the narrow breakpoint clamps it below. */
  .turn.you {
    margin-inline: calc(var(--space-4) * -1);
    padding: var(--space-3) var(--space-4);
    background: var(--surface-sunken);
    border-radius: var(--radius-well);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    margin-top: var(--space-2);
  }
  /* At the narrow breakpoint the transcript's gutters drop to --space-5 (18px),
     where a --space-4 bleed would leave 4px of air. Padding and bleed step down
     together so they stay equal — the columns stay flush and the gutter keeps
     7px. */
  @media (max-width: 900px) {
    .turn.you {
      margin-inline: calc(var(--space-3) * -1);
      padding-inline: var(--space-3);
    }
  }

  /* What was actually sent, not the word "image". */
  .shot {
    width: 48px;
    height: 48px;
    object-fit: cover;
    border-radius: var(--radius-mark);
    border: 1px solid var(--border-hairline);
    display: block;
  }
</style>
