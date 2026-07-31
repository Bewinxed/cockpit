<script lang="ts">
  /** One live session, as the session index and a project home both list it. */
  import { onMount } from 'svelte';
  import { fly } from 'svelte/transition';
  import { quintOut } from 'svelte/easing';
  import { ACTIVITY_LABEL } from './activity';
  import ActivityDot from './ActivityDot.svelte';
  import { cockpit, type InstanceRow } from './client.svelte';

  let { instance }: { instance: InstanceRow } = $props();

  const activity = $derived(cockpit.activityOf(instance.id));
  const tool = $derived(cockpit.currentToolOf(instance.id));

  // The label swaps only when the session's state actually changes — a row that
  // simply appears with the page has nothing to announce.
  let painted = $state(false);
  onMount(() => void (painted = true));
</script>

<a
  href="/session/{instance.id}"
  class="flex flex-col gap-0.5 rounded-lg border bg-card px-3 py-2 text-sm
    transition-[background-color,box-shadow,translate] duration-150 ease-out
    hover:-translate-y-px hover:bg-accent hover:shadow-md motion-reduce:hover:translate-y-0
    {instance.kind === 'scratch' ? 'border-dashed border-muted-foreground/30' : 'border-border'}"
>
  <span class="flex items-center gap-3">
    <ActivityDot {activity} />
    <span class="truncate font-mono">{instance.cwd || '—'}</span>
    {#if instance.kind === 'scratch'}
      <span class="shrink-0 rounded-sm bg-accent px-1 text-[10px] tracking-wide">scratch</span>
    {/if}
    <span class="ml-auto inline-grid shrink-0 justify-items-end text-xs text-muted-foreground">
      {#key activity}
        <span
          class="col-start-1 row-start-1"
          in:fly={{ y: 5, duration: painted ? 180 : 0, easing: quintOut }}
          out:fly={{ y: -5, duration: painted ? 140 : 0, easing: quintOut }}
        >{ACTIVITY_LABEL[activity]}</span>
      {/key}
    </span>
  </span>
  {#if activity === 'working' && tool}
    <span class="flex items-baseline gap-2 pl-5 text-xs text-muted-foreground">
      <span class="shrink-0">{tool.name}</span>
      <span class="truncate font-mono opacity-70">{tool.glance}</span>
    </span>
  {/if}
</a>
