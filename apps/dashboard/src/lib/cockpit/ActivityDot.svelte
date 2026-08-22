<script lang="ts">
  /** One session's state, in the one glance the fleet view is built around. */
  import { ACTIVITY_LABEL, type Activity } from './activity';

  interface Props {
    activity: Activity;
    /** `1.5` for the sidebar's denser rows. */
    size?: 1.5 | 2;
  }

  let { activity, size = 2 }: Props = $props();

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
</script>

<span class="relative shrink-0 {size === 2 ? 'size-2' : 'size-1.5'}" title={ACTIVITY_LABEL[activity]}>
  <!-- Blocked is the only state waiting on a human, so it is the loudest one. -->
  {#if activity === 'blocked'}
    <span
      class="absolute inset-0 rounded-full bg-warning opacity-75 animate-ping motion-reduce:animate-none"
    ></span>
  {/if}
  <span class="absolute inset-0 rounded-full {tone}"></span>
</span>
