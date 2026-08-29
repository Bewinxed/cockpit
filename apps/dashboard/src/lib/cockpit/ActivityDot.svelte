<script lang="ts">
  /** One session's state, in the one glance the fleet view is built around. */
  import { IconMoonSleepBold } from '$lib/icons';
  import { ACTIVITY_LABEL, SLEEPING_LABEL, UNKNOWN_LABEL, type Activity } from './activity';

  interface Props {
    activity: Activity;
    /** `1.5` for the sidebar's denser rows. */
    size?: 1.5 | 2;
    /**
     * The session's process is gone but its conversation is not — its own
     * glyph rather than a colour, since `idle` already owns the fleet's one
     * neutral dot (leaf Y1: this used to be a second, word-based vocabulary
     * — a "Sleeping" pill — living beside this one). Wins over `activity`.
     */
    sleeping?: boolean;
    /**
     * The hub can't currently reach this row's machine — hollow, not filled:
     * there is no fact here to tint, only the admission that one is missing,
     * same recipe as the Quiet Ledger's outline pill. Wins over `activity`
     * and `sleeping`.
     */
    stale?: boolean;
  }

  let { activity, size = 2, sleeping = false, stale = false }: Props = $props();

  /* The Quiet Ledger status hues: blue-live is a session mid-turn, amber-attn is
     one parked on a human, and a session at rest carries a quiet neutral — idle
     is the absence of a signal, not a colour of its own. (Failed reads red in
     the row itself; the dot never sees it.) */
  const tone = $derived(
    {
      blocked: 'bg-warning',
      working: 'bg-info animate-pulse motion-reduce:animate-none',
      idle: 'bg-muted-foreground/40',
    }[activity]
  );

  const label = $derived(
    stale ? UNKNOWN_LABEL : sleeping ? SLEEPING_LABEL : ACTIVITY_LABEL[activity]
  );
</script>

<span
  class="relative inline-flex shrink-0 items-center justify-center {size === 2
    ? 'size-2'
    : 'size-1.5'}"
  title={label}
  aria-label={label}
  role="img"
>
  {#if stale}
    <!-- Hollow, not filled: distinguishable from every filled state by shape
         alone, not only by colour — the honest rendering of "the hub does
         not know", never flattened into idle's quiet fill. -->
    <span class="absolute inset-0 rounded-full border border-muted-foreground/60"></span>
  {:else if sleeping}
    <!-- A glyph, not a tint: distinguishable from idle's plain dot by shape
         even with colour vision switched off, and named for what it means —
         resumable, not merely quiet. -->
    <IconMoonSleepBold class="absolute inset-0 size-full text-muted-foreground/70" />
  {:else}
    <!-- Blocked is the only state waiting on a human, so it is the loudest one. -->
    {#if activity === 'blocked'}
      <span
        class="absolute inset-0 rounded-full bg-warning opacity-75 animate-ping motion-reduce:animate-none"
      ></span>
    {/if}
    <span class="absolute inset-0 rounded-full {tone}"></span>
  {/if}
</span>
