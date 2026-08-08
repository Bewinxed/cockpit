<script lang="ts">
  /**
   * A `TaskCreate` or `TaskUpdate` in the transcript, as one quiet line.
   *
   * These are the plan being written down, not work being done: a JSON card
   * per status flip buries the conversation under bookkeeping. What the plan
   * now says is the panel's job, read off disk — this only records that it
   * moved, from the call's own input. The result is never read for prose.
   */
  import type { MessageRendererProps } from './types';

  let { message }: MessageRendererProps = $props();

  const input = $derived((message.metadata?.toolInput ?? {}) as Record<string, unknown>);
  const pending = $derived(message.metadata?.toolStatus === 'pending');
  const creating = $derived(message.metadata?.toolName === 'TaskCreate');

  const str = (value: unknown): string | null =>
    typeof value === 'string' && value.length > 0 ? value : null;

  const status = $derived(str(input.status));
  const subject = $derived(str(input.subject));

  /**
   * `TaskCreate` answers in prose today ("Task #3 created successfully: …"),
   * and prose is not a data format — the id is taken only from a structured
   * answer, and otherwise the line simply does not name one.
   */
  const createdId = $derived.by((): string | null => {
    const result = message.metadata?.toolResult;
    if (!result || typeof result !== 'object' || Array.isArray(result)) return null;
    const id = (result as Record<string, unknown>).id;
    return typeof id === 'string' ? id : typeof id === 'number' ? String(id) : null;
  });

  const id = $derived(creating ? createdId : str(input.taskId));

  const verb = $derived.by(() => {
    if (creating) return 'Added';
    if (status === 'completed') return 'Done';
    if (status === 'in_progress') return 'Started';
    if (status === 'deleted') return 'Removed';
    return 'Updated';
  });
</script>

<!-- A log line, so it keeps the transcript's left edge and nothing else: no
     card, no border, nothing to open. -->
<p
  class="flex min-h-9 items-center gap-2 text-caption transition-opacity duration-150
    {pending ? 'opacity-70' : ''}"
>
  <span class="flex w-3 shrink-0 items-center justify-center">
    {#if !creating && status === 'completed'}
      <svg width="12" height="12" viewBox="0 0 12 12" class="text-success" aria-hidden="true">
        <polyline
          points="2.4,6.4 4.6,8.6 9.4,3.6"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    {:else if !creating && status === 'in_progress'}
      <span class="size-1.5 rounded-full bg-warning"></span>
    {:else if !creating && status === 'deleted'}
      <svg width="12" height="12" viewBox="0 0 12 12" class="text-muted-foreground/60" aria-hidden="true">
        <path
          d="M3.4 3.4 L8.6 8.6 M8.6 3.4 L3.4 8.6"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
        />
      </svg>
    {:else}
      <span class="size-1.5 rounded-full border border-muted-foreground/40"></span>
    {/if}
  </span>
  <span class="shrink-0">{verb}</span>
  {#if subject}
    <span class="min-w-0 truncate">{subject}</span>
  {/if}
  {#if id}
    <span class="shrink-0 font-mono text-micro tabular-nums" data-tabular>#{id}</span>
  {/if}
</p>
