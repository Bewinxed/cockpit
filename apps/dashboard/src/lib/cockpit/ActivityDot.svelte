<script lang="ts">
  /** One session's state, in the one glance the fleet view is built around. */
  import type { Activity } from './activity';

  interface Props {
    activity: Activity;
    /** `1.5` for the sidebar's denser rows. */
    size?: 1.5 | 2;
  }

  let { activity, size = 2 }: Props = $props();

  const tone = $derived(
    {
      blocked: 'bg-warning',
      working: 'bg-primary animate-pulse',
      idle: 'bg-muted-foreground/40',
    }[activity]
  );
</script>

<span
  class="shrink-0 rounded-full {size === 2 ? 'size-2' : 'size-1.5'} {tone}"
  title={activity}
></span>
