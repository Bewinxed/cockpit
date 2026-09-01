<script lang="ts">
  /** Find in session. The transcript is virtualized, so native find only ever
   *  sees the handful of groups currently mounted — this matches the store's
   *  text instead and asks the page to scroll the hit into view. */
  import { IconChevronDown, IconChevronUp, IconClose, IconSearch } from '$lib/icons';
  import { Input } from '$lib/components/ui/input';
  import { untrack } from 'svelte';
  import { fly } from 'svelte/transition';
  import { quintOut } from 'svelte/easing';
  import type { JsonValue, TranscriptGroup } from '$lib/whiffle/types';

  interface Props {
    groups: TranscriptGroup[];
    onJump: (groupIndex: number) => void;
    onClose: () => void;
  }

  let { groups, onJump, onClose }: Props = $props();

  let input = $state<HTMLInputElement | null>(null);
  let query = $state('');
  /** Position within `matches`, reset by every edit of the query. */
  let current = $state(0);

  $effect(() => {
    input?.focus();
  });

  /** Reopening onto an already-open bar puts the query up for replacement. */
  export function focus() {
    input?.focus();
    input?.select();
  }

  /** Per field, so one enormous tool payload cannot decide what a scan costs. */
  const field = (value: JsonValue | undefined) =>
    value === undefined ? '' : JSON.stringify(value).slice(0, 20_000);

  function groupText(group: TranscriptGroup): string {
    if (group.kind === 'single') return group.message.content;
    if (group.kind === 'subagent') {
      return [group.branch.description ?? '', ...group.branch.messages.map((m) => m.content)].join(
        '\n'
      );
    }
    return group.messages
      .map((m) =>
        [m.metadata?.toolName ?? '', field(m.metadata?.toolInput), field(m.metadata?.toolResult)].join(
          ' '
        )
      )
      .join('\n');
  }

  // Scanning every group on each keystroke is sub-millisecond at transcript
  // sizes, so there is nothing for a debounce to save.
  const matches = $derived.by(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length < 2) return [];
    const hits: number[] = [];
    groups.forEach((group, index) => {
      if (groupText(group).toLowerCase().includes(needle)) hits.push(index);
    });
    return hits;
  });

  // The jump is driven by the index alone, not the match list: a streaming turn
  // recomputes `matches` constantly, and re-jumping on that would drag the
  // reader back off whatever they walked to.
  const target = $derived(matches[current] ?? -1);

  $effect(() => {
    if (target < 0) return;
    untrack(() => onJump(target));
  });

  function step(delta: number) {
    if (!matches.length) return;
    current = (current + delta + matches.length) % matches.length;
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== 'Enter') return;
    event.preventDefault();
    step(event.shiftKey ? -1 : 1);
  }

  const control =
    'flex min-h-6 shrink-0 items-center rounded px-1 transition-colors hover:bg-accent hover:text-accent-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30';
</script>

<div
  class="absolute top-2 right-4 z-10 flex items-center gap-1.5 rounded-[var(--radius-card)] border border-border bg-card px-2 py-1.5 shadow-lg"
  in:fly={{ y: -8, duration: 200, easing: quintOut }}
  out:fly={{ y: -8, duration: 150, easing: quintOut }}
>
  <IconSearch class="size-3.5 shrink-0 text-muted-foreground" />
  <Input
    bind:ref={input}
    bind:value={query}
    class="h-auto w-56 border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-0"
    placeholder="Find in session"
    aria-label="Find in session"
    oninput={() => (current = 0)}
    onkeydown={handleKeydown}
  />
  {#if query.trim()}
    <span class="shrink-0 text-xs text-muted-foreground tabular-nums">
      {matches.length ? current + 1 : 0}/{matches.length}
    </span>
  {/if}
  <button
    type="button"
    class={control}
    disabled={matches.length === 0}
    aria-label="Previous match"
    onclick={() => step(-1)}
  >
    <IconChevronUp class="size-3.5" />
  </button>
  <button
    type="button"
    class={control}
    disabled={matches.length === 0}
    aria-label="Next match"
    onclick={() => step(1)}
  >
    <IconChevronDown class="size-3.5" />
  </button>
  <button type="button" class={control} aria-label="Close search" onclick={onClose}>
    <IconClose class="size-3.5" />
  </button>
</div>
