<script lang="ts">
  /**
   * Machines → sessions, the peer model (NEW.md §1): a machine's live instances
   * and its stored sessions read the same whether it is this box or another one.
   */
  import { page } from '$app/state';
  import { formatDistanceToNow } from '$lib/utils/time';
  import ActivityDot from './ActivityDot.svelte';
  import { cockpit, loadCatalog } from './client.svelte';
  import { sessionTitle, transcriptHref } from './links';

  const machines = $derived(
    [...cockpit.machines].sort((a, b) => a.hostname.localeCompare(b.hostname))
  );
  // One list for the whole fleet: a side quest is a thing in flight, not a thing
  // that belongs to a machine, and it is the rail's most perishable content.
  const sideQuests = $derived(cockpit.scratchInstances);

  const isCurrent = (href: string) => page.url.pathname + page.url.search === href;
  const leaf = (cwd: string) => cwd.split('/').pop() || cwd;
</script>

<nav class="flex w-64 shrink-0 flex-col overflow-y-auto border-r border-border bg-card/40">
  <div class="flex items-center justify-between px-3 py-2">
    <span class="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
      Machines
    </span>
    <a
      href="/session"
      class="rounded px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      + New
    </a>
  </div>

  {#if sideQuests.length > 0}
    <section class="flex flex-col gap-1 px-2 pb-2">
      <span class="px-1 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
        Side quests
      </span>
      {#each sideQuests as instance (instance.id)}
        {@const activity = cockpit.activityOf(instance.id)}
        <a
          href="/session/{instance.id}"
          class="flex items-center gap-2 rounded-md border border-dashed border-border px-2 py-1 text-xs transition-colors hover:bg-accent
            {isCurrent(`/session/${instance.id}`)
            ? 'bg-accent text-foreground'
            : 'text-muted-foreground'}"
        >
          <ActivityDot {activity} size={1.5} />
          <span class="truncate font-mono">{leaf(instance.cwd)}</span>
          <span class="ml-auto shrink-0 rounded-sm bg-accent px-1 text-[10px] tracking-wide">
            scratch
          </span>
        </a>
      {/each}
    </section>
  {/if}

  {#each machines as machine (machine.machineId)}
    {@const running = cockpit.runningOn(machine.machineId)}
    {@const stored = cockpit.catalogOf(machine.machineId)}
    <section class="flex flex-col pb-2">
      <header class="flex items-center gap-2 px-3 py-1.5">
        <span
          class="size-1.5 shrink-0 rounded-full {machine.status === 'online'
            ? 'bg-success'
            : 'bg-muted-foreground'}"
        ></span>
        <span class="truncate text-xs font-medium">{machine.hostname}</span>
        <button
          type="button"
          class="ml-auto text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          onclick={() => loadCatalog(machine.machineId)}
          title="Reload sessions"
        >
          {machine.os}
        </button>
      </header>

      {#each running as instance (instance.id)}
        {@const activity = cockpit.activityOf(instance.id)}
        <a
          href="/session/{instance.id}"
          class="flex items-center gap-2 px-3 py-1 text-xs transition-colors hover:bg-accent
            {isCurrent(`/session/${instance.id}`)
            ? 'bg-accent text-foreground'
            : 'text-muted-foreground'}"
        >
          <ActivityDot {activity} size={1.5} />
          <span class="truncate font-mono">{leaf(instance.cwd)}</span>
          <span class="ml-auto shrink-0 text-[11px] {activity === 'blocked' ? 'text-warning' : ''}">
            {activity}
          </span>
        </a>
      {/each}

      {#each stored as info (info.sessionId)}
        {@const href = transcriptHref(machine.machineId, info)}
        <a
          {href}
          class="flex flex-col px-3 py-1 transition-colors hover:bg-accent {isCurrent(href)
            ? 'bg-accent'
            : ''}"
        >
          <span class="flex items-baseline gap-2">
            <span class="truncate text-xs text-foreground/80">{sessionTitle(info)}</span>
            <span class="ml-auto shrink-0 text-[11px] text-muted-foreground">
              {formatDistanceToNow(new Date(info.lastModified))}
            </span>
          </span>
          {#if info.cwd}
            <span class="truncate font-mono text-[11px] text-muted-foreground">{info.cwd}</span>
          {/if}
        </a>
      {:else}
        {#if running.length === 0}
          <p class="px-3 py-1 text-[11px] text-muted-foreground">No sessions.</p>
        {/if}
      {/each}
    </section>
  {:else}
    <p class="px-3 py-2 text-xs text-muted-foreground">No machines connected.</p>
  {/each}
</nav>
