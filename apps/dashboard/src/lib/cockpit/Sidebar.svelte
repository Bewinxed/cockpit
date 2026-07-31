<script module lang="ts">
  import { browser } from '$app/environment';

  const STORAGE_KEY = 'cockpit-sidebar';

  function readCollapsed(): Record<string, boolean> {
    if (!browser) return {};
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, boolean>;
    } catch {
      return {};
    }
  }

  // Module scope, so the drawer copy of the rail and the desktop one fold alike.
  const collapsed = $state<Record<string, boolean>>(readCollapsed());

  function toggleMachine(machineId: string): void {
    collapsed[machineId] = !collapsed[machineId];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(collapsed));
  }
</script>

<script lang="ts">
  /**
   * Machines → sessions, the peer model (NEW.md §1): a machine's live instances
   * and its stored sessions read the same whether it is this box or another one.
   */
  import { page } from '$app/state';
  import { slide } from 'svelte/transition';
  import { quintOut } from 'svelte/easing';
  import { ChevronRight, Folder, History, Server } from '@lucide/svelte';
  import type { SDKSessionInfo } from '@cockpit/core';
  import { formatDistanceToNow } from '$lib/utils/time';
  import { ACTIVITY_LABEL } from './activity';
  import ActivityDot from './ActivityDot.svelte';
  import { cockpit, loadCatalog } from './client.svelte';
  import { sessionTitle, transcriptHref } from './links';

  /** Enough of a machine's catalog to recognise it by; the rest is behind a click. */
  const RECENT = 6;

  const machines = $derived(
    [...cockpit.machines].sort((a, b) => a.hostname.localeCompare(b.hostname))
  );
  // One list for the whole fleet: a side quest is a thing in flight, not a thing
  // that belongs to a machine, and it is the rail's most perishable content.
  const sideQuests = $derived(cockpit.scratchInstances);

  /** Machines whose catalog is shown past `RECENT` — a glance, not a preference. */
  let showAll = $state<Record<string, boolean>>({});

  const isCurrent = (href: string) => page.url.pathname + page.url.search === href;
  const leaf = (cwd: string) => cwd.split('/').pop() || cwd;
</script>

{#snippet storedRow(machineId: string, info: SDKSessionInfo)}
  {@const href = transcriptHref(machineId, info)}
  <a
    {href}
    aria-current={isCurrent(href) ? 'page' : undefined}
    class="flex items-start gap-1.5 rounded-md px-1.5 py-1 transition-colors hover:bg-accent
      {isCurrent(href) ? 'bg-accent' : ''}"
  >
    <History size={12} class="mt-0.5 shrink-0 text-muted-foreground" />
    <span class="flex min-w-0 flex-1 flex-col">
      <span class="flex items-baseline gap-2">
        <span class="truncate text-xs text-foreground/80">{sessionTitle(info)}</span>
        <span class="ml-auto shrink-0 text-[11px] text-muted-foreground">
          {formatDistanceToNow(new Date(info.lastModified))}
        </span>
      </span>
      {#if info.cwd}
        <span class="truncate font-mono text-[11px] text-muted-foreground" title={info.cwd}>
          {leaf(info.cwd)}
        </span>
      {/if}
    </span>
  </a>
{/snippet}

<nav
  class="flex w-64 shrink-0 flex-col overflow-y-auto border-r border-border bg-sidebar px-2"
  aria-label="Machines and sessions"
>
  <div class="flex items-center justify-end py-2">
    <a
      href="/session"
      class="rounded px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      + New session
    </a>
  </div>

  {#if cockpit.projects.length > 0}
    <section class="flex flex-col gap-1 pb-2">
      <span class="px-2 text-xs font-medium tracking-wider text-muted-foreground uppercase">
        Projects
      </span>
      {#each cockpit.projects as project (project.id)}
        <a
          href="/project/{project.id}"
          aria-current={isCurrent(`/project/${project.id}`) ? 'page' : undefined}
          class="flex items-start gap-1.5 rounded-md px-2 py-1 transition-colors hover:bg-accent
            {isCurrent(`/project/${project.id}`) ? 'bg-accent' : ''}"
        >
          <Folder size={12} class="mt-0.5 shrink-0 text-muted-foreground" />
          <span class="flex min-w-0 flex-1 flex-col">
            <span class="truncate text-xs text-foreground/80">{project.name}</span>
            <span class="truncate font-mono text-[11px] text-muted-foreground">{project.cwd}</span>
          </span>
        </a>
      {/each}
    </section>
  {/if}

  {#if sideQuests.length > 0}
    <section class="flex flex-col gap-1 pb-2">
      <span class="px-2 text-xs font-medium tracking-wider text-muted-foreground uppercase">
        Side quests
      </span>
      {#each sideQuests as instance (instance.id)}
        {@const activity = cockpit.activityOf(instance.id)}
        <a
          href="/session/{instance.id}"
          aria-current={isCurrent(`/session/${instance.id}`) ? 'page' : undefined}
          class="flex items-center gap-2 rounded-md border border-dashed border-muted-foreground/30 px-2 py-1 text-xs transition-colors hover:bg-accent
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

  {#if machines.length > 0}
    <span class="px-2 pb-1 text-xs font-medium tracking-wider text-muted-foreground uppercase">
      Machines
    </span>
  {/if}

  {#each machines as machine (machine.machineId)}
    {@const running = cockpit.runningOn(machine.machineId)}
    {@const stored = cockpit.catalogOf(machine.machineId)}
    {@const open = !collapsed[machine.machineId]}
    {@const expanded = !!showAll[machine.machineId]}
    <section class="flex flex-col pb-2">
      <header class="flex items-center">
        <button
          type="button"
          class="flex min-h-6 flex-1 items-center gap-1.5 rounded-md px-2 py-1 text-left transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
          aria-expanded={open}
          aria-controls="machine-{machine.machineId}"
          onclick={() => toggleMachine(machine.machineId)}
        >
          <ChevronRight
            size={12}
            class="shrink-0 text-muted-foreground transition-transform {open ? 'rotate-90' : ''}"
          />
          <Server size={12} class="shrink-0 text-muted-foreground" />
          <span class="truncate text-xs font-medium">{machine.hostname}</span>
          <span
            class="size-1.5 shrink-0 rounded-full {machine.status === 'online'
              ? 'bg-success'
              : 'bg-muted-foreground'}"
            title={machine.status === 'online' ? 'Online' : 'Offline'}
          ></span>
        </button>
        <button
          type="button"
          class="min-h-6 rounded px-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          onclick={() => loadCatalog(machine.machineId)}
          title="Reload sessions"
        >
          {machine.os}
        </button>
      </header>

      {#if open}
        <div
          id="machine-{machine.machineId}"
          class="ml-4 flex flex-col border-l border-border/60 pl-1"
        >
          {#if running.length > 0}
            <span class="px-1.5 py-1 text-xs tracking-wide text-muted-foreground uppercase">
              Live
            </span>
            {#each running as instance (instance.id)}
              {@const activity = cockpit.activityOf(instance.id)}
              <a
                href="/session/{instance.id}"
                aria-current={isCurrent(`/session/${instance.id}`) ? 'page' : undefined}
                class="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs transition-colors hover:bg-accent
                  {isCurrent(`/session/${instance.id}`)
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground'}"
              >
                <ActivityDot {activity} size={1.5} />
                <span class="truncate font-mono">{leaf(instance.cwd)}</span>
                <span
                  class="ml-auto shrink-0 text-[11px] {activity === 'blocked' ? 'text-warning' : ''}"
                >
                  {ACTIVITY_LABEL[activity]}
                </span>
              </a>
            {/each}
          {/if}

          {#if stored.length > 0}
            <span
              class="px-1.5 py-1 text-xs tracking-wide text-muted-foreground uppercase"
              title="Claude Code sessions stored on this machine — any directory"
            >
              Recent sessions
            </span>
            {#each stored.slice(0, RECENT) as info (info.sessionId)}
              {@render storedRow(machine.machineId, info)}
            {/each}

            {#if stored.length > RECENT}
              {#if expanded}
                <div
                  id="stored-{machine.machineId}"
                  class="flex flex-col"
                  in:slide={{ duration: 250, easing: quintOut }}
                  out:slide={{ duration: 180, easing: quintOut }}
                >
                  {#each stored.slice(RECENT) as info (info.sessionId)}
                    {@render storedRow(machine.machineId, info)}
                  {/each}
                </div>
              {/if}
              <button
                type="button"
                class="flex min-h-6 items-center px-1.5 py-1 text-left text-[11px] text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                aria-expanded={expanded}
                aria-controls="stored-{machine.machineId}"
                onclick={() => (showAll[machine.machineId] = !expanded)}
              >
                {expanded ? 'Show fewer' : `Show all ${stored.length}`}
              </button>
            {/if}
          {/if}

          {#if running.length === 0 && stored.length === 0}
            <p class="px-1.5 py-1 text-[11px] text-muted-foreground">No sessions.</p>
          {/if}
        </div>
      {/if}
    </section>
  {:else}
    <p class="px-2 py-2 text-xs text-muted-foreground">
      No machines connected.
      <a href="/session" class="underline transition-colors hover:text-foreground">
        How to connect one
      </a>
    </p>
  {/each}
</nav>
