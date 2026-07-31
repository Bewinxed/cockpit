<script lang="ts">
  /** One live session, as the session index and a project home both list it. */
  import ActivityDot from './ActivityDot.svelte';
  import { cockpit, type InstanceRow } from './client.svelte';

  let { instance }: { instance: InstanceRow } = $props();

  const activity = $derived(cockpit.activityOf(instance.id));
  const tool = $derived(cockpit.currentToolOf(instance.id));
</script>

<a
  href="/session/{instance.id}"
  class="flex flex-col gap-0.5 rounded-lg border border-border bg-card px-3 py-2 text-sm transition-colors hover:bg-accent
    {instance.kind === 'scratch' ? 'border-dashed' : ''}"
>
  <span class="flex items-center gap-3">
    <ActivityDot {activity} />
    <span class="truncate font-mono">{instance.cwd || '—'}</span>
    {#if instance.kind === 'scratch'}
      <span class="shrink-0 rounded-sm bg-accent px-1 text-[10px] tracking-wide">scratch</span>
    {/if}
    <span class="ml-auto shrink-0 text-xs text-muted-foreground">{activity}</span>
  </span>
  {#if activity === 'working' && tool}
    <span class="flex items-baseline gap-2 pl-5 text-xs text-muted-foreground">
      <span class="shrink-0">{tool.name}</span>
      <span class="truncate font-mono opacity-70">{tool.glance}</span>
    </span>
  {/if}
</a>
