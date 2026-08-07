<script lang="ts">
  /** One live session, as the session index and a project home both list it. */
  import { onMount } from 'svelte';
  import { fly } from 'svelte/transition';
  import { quintOut } from 'svelte/easing';
  import { IconSparklesDuo } from '$lib/icons';
  import { Badge } from '$lib/components/ui/badge';
  import { ACTIVITY_LABEL, SLEEPING_HINT, SLEEPING_LABEL } from './activity';
  import ActivityDot from './ActivityDot.svelte';
  import { cockpit, isFailed, isResumable, type InstanceRow } from './client.svelte';
  import { sessionTitle } from './links';
  import LiveSessionMenu from './LiveSessionMenu.svelte';

  interface Props {
    instance: InstanceRow;
    /** The card's own path, where it has one: a row in it repeating that path
     *  says nothing, so the row keeps quiet and the card speaks for it. */
    groupCwd?: string;
  }

  let { instance, groupCwd }: Props = $props();

  const showCwd = $derived(Boolean(instance.cwd) && instance.cwd !== groupCwd);

  const activity = $derived(cockpit.activityOf(instance.id));
  const tool = $derived(cockpit.currentToolOf(instance.id));
  const sleeping = $derived(isResumable(instance));
  const failed = $derived(isFailed(instance));
  const quest = $derived(instance.kind === 'scratch');
  const label = $derived(
    failed ? 'Failed' : sleeping ? SLEEPING_LABEL : ACTIVITY_LABEL[activity]
  );

  // What the session is about, not where it runs: the SDK's own title for the
  // transcript this instance is writing. A quest is tagged out of the catalog,
  // and a session that has not spoken yet is not in it either, so both land on
  // the fallback with the path beside them to say the rest.
  const title = $derived.by(() => {
    const info = instance.sessionId
      ? cockpit.catalogOf(instance.machineId).find((row) => row.sessionId === instance.sessionId)
      : undefined;
    return info ? sessionTitle(info) : 'untitled session';
  });

  // The label swaps only when the session's state actually changes — a row that
  // simply appears with the page has nothing to announce.
  let painted = $state(false);
  onMount(() => void (painted = true));
</script>

<LiveSessionMenu {instance}>
  <a
    href="/session/{instance.id}"
    title={sleeping ? SLEEPING_HINT : undefined}
    class="group flex min-h-9 flex-col justify-center gap-0.5 rounded-lg px-3 py-1.5
      transition-colors duration-150 ease-out hover:bg-accent hover:text-accent-foreground
      {failed || activity === 'blocked' ? 'bg-error/10' : ''}"
  >
    <span class="flex items-center gap-2.5">
      {#if failed}
        <span class="size-2 shrink-0 rounded-full bg-error"></span>
      {:else if sleeping}
        <span class="size-2 shrink-0 rounded-full bg-muted-foreground/40"></span>
      {:else}
        <ActivityDot {activity} />
      {/if}
      {#if quest}
        <IconSparklesDuo class="size-4 shrink-0 text-muted-foreground" />
      {/if}
      <span class="min-w-0 flex-[3_1_0] truncate text-[13px]">{title}</span>
      {#if quest}
        <Badge variant="secondary" class="shrink-0 text-micro font-normal">side quest</Badge>
      {/if}
      <!-- Where it runs, second: the path answers "which checkout", never
           "which session", so it gives up room to the title first, and what it
           does keep it gives up from the left — the leaf is what tells two
           checkouts apart. -->
      {#if showCwd}
        <span
          class="hidden min-w-0 flex-[2_1_0] truncate font-mono text-micro text-muted-foreground [direction:rtl] sm:block"
          title={instance.cwd}
        ><bdi>{instance.cwd}</bdi></span>
      {/if}
      <!-- The state word keeps its colour until the row goes dark under the
           pointer, where only the surface's own foreground stays legible. -->
      <span
        class="inline-grid shrink-0 justify-items-end text-micro tabular-nums group-hover:text-accent-foreground {failed ||
        activity === 'blocked'
          ? 'font-medium text-error'
          : 'text-muted-foreground'}"
        data-tabular
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
      <span class="flex items-baseline gap-2 pl-[18px] text-micro text-muted-foreground">
        <span class="shrink-0">{tool.name}</span>
        <span class="truncate font-mono">{tool.glance}</span>
      </span>
    {/if}
  </a>
</LiveSessionMenu>
