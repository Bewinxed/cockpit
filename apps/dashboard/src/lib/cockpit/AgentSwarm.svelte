<script module lang="ts">
  /** One agent in the strip, flattened from a branch or a delegate alike. */
  export type SwarmMark = {
    key: string;
    state: 'working' | 'idle' | 'blocked' | 'failed' | 'sleeping';
    model: string | null;
    label: string;
  };
</script>

<script lang="ts">
  /**
   * The sub-work a session has out, as a strip of live marks rather than a
   * sentence. "5 subagents · 2 running" is a number you have to read and then
   * translate; a row of rings is the same fact already in the shape of an
   * answer — how many are out, which labs they are, and which of them are
   * still moving. The marks are the row's disclosure control too, so the count
   * and the way in are one target rather than two.
   *
   * What makes it read as live is not the rings alone but what the strip does
   * around them: a spawn scales in where it lands, a landing fades its mark
   * back so the eye keeps going to whatever is still turning, and the order
   * only ever shifts under `flip`, never by jumping.
   */
  import { flip } from 'svelte/animate';
  import { scale } from 'svelte/transition';
  import ModelIndicator from './ModelIndicator.svelte';
  import { IconChevronRight } from '$lib/icons';

  let {
    marks,
    open,
    onToggle,
    class: className = '',
  }: {
    marks: SwarmMark[];
    open: boolean;
    onToggle: () => void;
    class?: string;
  } = $props();

  /** How many marks the strip draws before the remainder becomes a count. */
  const CAP = 8;

  /** The two states that are still going, and so the two that hold a slot. */
  const live = (mark: SwarmMark): boolean => mark.state === 'working' || mark.state === 'blocked';

  /*
   * Live work takes the visible slots: a session with thirty landed branches
   * and two still running has to show the two. Spawn order is kept inside each
   * group, so a branch finishing re-sorts one mark rather than reshuffling the
   * strip under the reader's eye.
   */
  const ordered = $derived([...marks.filter(live), ...marks.filter((mark) => !live(mark))]);
  const shown = $derived(ordered.slice(0, CAP));
  const rest = $derived(ordered.length - shown.length);
  const running = $derived(marks.filter(live).length);

  /* The strip says this by being looked at; a screen reader gets it in words. */
  const spoken = $derived(
    `${marks.length} subagent${marks.length === 1 ? '' : 's'}` +
      (running > 0 ? `, ${running} running` : '') +
      (open ? ' — hide details' : ' — show details')
  );
</script>

<button
  type="button"
  class="flex h-7 w-full items-center gap-1.5 rounded-[var(--radius-control)] pr-2 pl-8
         transition-colors duration-150
         hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring
         focus-visible:outline-none {className}"
  aria-expanded={open}
  aria-label={spoken}
  onclick={onToggle}
>
  <IconChevronRight
    class="size-3 shrink-0 text-muted-foreground transition-transform duration-240 ease-[var(--e-in)]
           {open ? 'rotate-90' : ''}"
  />
  <span class="flex min-w-0 items-center gap-1">
    {#each shown as mark, i (mark.key)}
      <!-- The stagger is capped: a burst of twenty spawning at once should
           cascade, not queue up behind three quarters of a second of delay. -->
      <span
        class="mark shrink-0 {live(mark) ? '' : 'opacity-55'}"
        animate:flip={{ duration: 260 }}
        in:scale={{ start: 0.4, opacity: 0, duration: 260, delay: Math.min(i, 6) * 40 }}
        out:scale={{ start: 0.4, opacity: 0, duration: 160 }}
      >
        <ModelIndicator model={mark.model} state={mark.state} label={mark.label} />
      </span>
    {/each}
    {#if rest > 0}
      <span class="shrink-0 text-micro text-faint" data-tabular>+{rest}</span>
    {/if}
  </span>
</button>

<style>
  /* Landing is a fade, not a cut: the mark that just went quiet should be seen
     going quiet, because that is the moment the reader is being told about. */
  .mark {
    transition: opacity 240ms ease;
  }

  @media (prefers-reduced-motion: reduce) {
    .mark {
      transition: none;
    }
  }
</style>
