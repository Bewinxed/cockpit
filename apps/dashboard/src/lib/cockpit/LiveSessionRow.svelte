<script lang="ts">
  /** One live session, as the session index and a project home both list it. */
  import { onMount } from 'svelte';
  import { fly } from 'svelte/transition';
  import { quintOut } from 'svelte/easing';
  import { ACTIVITY_LABEL } from './activity';
  import ActivityDot from './ActivityDot.svelte';
  import { cockpit, type InstanceRow } from './client.svelte';
  import LiveSessionMenu from './LiveSessionMenu.svelte';

  let { instance }: { instance: InstanceRow } = $props();

  const activity = $derived(cockpit.activityOf(instance.id));
  const tool = $derived(cockpit.currentToolOf(instance.id));
  const failed = $derived(instance.status === 'error');
  const label = $derived(failed ? 'Failed' : ACTIVITY_LABEL[activity]);

  // The label swaps only when the session's state actually changes — a row that
  // simply appears with the page has nothing to announce.
  let painted = $state(false);
  onMount(() => void (painted = true));
</script>

<LiveSessionMenu {instance}>
  <a
    href="/session/{instance.id}"
    class="group flex flex-col gap-0.5 rounded-lg border px-3 py-2 text-sm
      transition-[background-color,box-shadow,translate] duration-150 ease-out
      hover:-translate-y-px hover:bg-accent hover:text-accent-foreground hover:shadow-md motion-reduce:hover:translate-y-0
      {failed || activity === 'blocked' ? 'bg-warning/10' : 'bg-card'}
      {instance.kind === 'scratch' ? 'border-dashed border-muted-foreground/30' : 'border-border'}"
  >
    <span class="flex items-center gap-3">
      {#if failed}
        <span class="size-2 shrink-0 rounded-full bg-warning"></span>
      {:else}
        <ActivityDot {activity} />
      {/if}
      <span class="truncate font-mono">{instance.cwd || '—'}</span>
      {#if instance.kind === 'scratch'}
        <span
          class="shrink-0 rounded-sm bg-accent px-1 text-xs tracking-wide text-accent-foreground"
        >
          scratch
        </span>
      {/if}
      <!-- The state word keeps its colour until the row goes dark under the
           pointer, where only the surface's own foreground stays legible. -->
      <span
        class="ml-auto inline-grid shrink-0 justify-items-end text-xs group-hover:text-accent-foreground {failed ||
        activity === 'blocked'
          ? 'font-medium text-warning'
          : 'opacity-70'}"
      >
        {#key label}
          <span
            class="col-start-1 row-start-1"
            in:fly={{ y: 5, duration: painted ? 180 : 0, easing: quintOut }}
            out:fly={{ y: -5, duration: painted ? 140 : 0, easing: quintOut }}
          >{label}</span>
        {/key}
      </span>
    </span>
    {#if activity === 'working' && tool}
      <span class="flex items-baseline gap-2 pl-5 text-xs opacity-70">
        <span class="shrink-0">{tool.name}</span>
        <span class="truncate font-mono opacity-70">{tool.glance}</span>
      </span>
    {/if}
  </a>
</LiveSessionMenu>
