<script module lang="ts">
  import { IconChevronRight, IconFolder, IconHistory, IconPlus, IconServer } from '$lib/icons';
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
  import * as Collapsible from '$lib/components/ui/collapsible';
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

  // Row transitions animate live comings and goings, not the initial WS backfill:
  // data lands right after mount, and a rail that assembles itself on every page
  // load reads as noise. Zero-duration until the first snapshot has painted.
  let settled = $state(false);
  $effect(() => {
    if (machines.length > 0 && !settled) {
      requestAnimationFrame(() => (settled = true));
    }
  });
  const rowIn = $derived({ duration: settled ? 250 : 0, easing: quintOut });
  const rowOut = $derived({ duration: settled ? 180 : 0, easing: quintOut });

  const isCurrent = (href: string) => page.url.pathname + page.url.search === href;
  const leaf = (cwd: string) => cwd.split('/').pop() || cwd;
</script>

{#snippet storedRow(machineId: string, info: SDKSessionInfo)}
  {@const href = transcriptHref(machineId, info)}
  {@const current = isCurrent(href)}
  <a
    {href}
    aria-current={current ? 'page' : undefined}
    class="flex items-start gap-2 rounded-md px-1.5 py-1 transition-colors hover:bg-accent
      {current ? 'bg-accent' : ''}"
    in:slide={rowIn}
    out:slide={rowOut}
  >
    <IconHistory class="size-3.5 mt-0.5 shrink-0 text-muted-foreground/70" />
    <span class="flex min-w-0 flex-1 flex-col">
      <span class="flex items-baseline gap-2">
        <span class="truncate text-[13px] leading-5 text-foreground {current ? 'font-medium' : ''}">
          {sessionTitle(info)}
        </span>
        <span class="ml-auto shrink-0 text-[10px] text-muted-foreground/60 tabular-nums">
          {formatDistanceToNow(new Date(info.lastModified))}
        </span>
      </span>
      {#if info.cwd}
        <span
          class="truncate font-mono text-[11px] leading-4 text-muted-foreground/70"
          title={info.cwd}
        >
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
  <div class="py-2">
    <a
      href="/session"
      class="flex min-h-7 items-center gap-1.5 rounded-md bg-primary px-2 text-[13px] font-medium text-primary-foreground shadow-sm transition-[background-color,scale] duration-150 ease-out hover:bg-primary/90 active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-ring"
    >
      <IconPlus class="size-3.5 shrink-0" />
      New session
    </a>
  </div>

  {#if cockpit.projects.length > 0}
    <section class="flex flex-col gap-1 pb-3">
      <span
        class="px-2 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground/70 uppercase"
      >
        Projects
      </span>
      {#each cockpit.projects as project (project.id)}
        {@const current = isCurrent(`/project/${project.id}`)}
        <a
          href="/project/{project.id}"
          aria-current={current ? 'page' : undefined}
          class="flex items-start gap-2 rounded-md px-2 py-1 transition-colors hover:bg-accent
            {current ? 'bg-accent' : ''}"
        >
          <IconFolder class="size-3.5 mt-0.5 shrink-0 text-muted-foreground" />
          <span class="flex min-w-0 flex-1 flex-col">
            <span
              class="truncate text-[13px] leading-5 text-foreground {current ? 'font-medium' : ''}"
            >
              {project.name}
            </span>
            <span class="truncate font-mono text-[11px] leading-4 text-muted-foreground/70">
              {project.cwd}
            </span>
          </span>
        </a>
      {/each}
    </section>
  {/if}

  {#if sideQuests.length > 0}
    <section class="flex flex-col gap-1 pb-3">
      <span
        class="px-2 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground/70 uppercase"
      >
        Side quests
      </span>
      {#each sideQuests as instance (instance.id)}
        {@const activity = cockpit.activityOf(instance.id)}
        <a
          href="/session/{instance.id}"
          aria-current={isCurrent(`/session/${instance.id}`) ? 'page' : undefined}
          class="flex min-h-7 items-center gap-2 rounded-md border border-dashed border-muted-foreground/30 px-2 py-1 text-[13px] transition-colors hover:bg-accent
            {isCurrent(`/session/${instance.id}`)
            ? 'bg-accent text-foreground'
            : 'text-muted-foreground'}"
          in:slide={rowIn}
          out:slide={rowOut}
        >
          <ActivityDot {activity} size={1.5} />
          <span class="truncate font-mono">{leaf(instance.cwd)}</span>
          <span
            class="ml-auto shrink-0 rounded-sm bg-accent px-1 py-px text-[10px] tracking-wide text-muted-foreground"
          >
            scratch
          </span>
        </a>
      {/each}
    </section>
  {/if}

  {#if machines.length > 0}
    <span
      class="px-2 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground/70 uppercase"
    >
      Machines
    </span>
  {/if}

  {#each machines as machine (machine.machineId)}
    {@const running = cockpit.runningOn(machine.machineId)}
    {@const blockedCount = running.filter((i) => cockpit.activityOf(i.id) === 'blocked').length}
    {@const stored = cockpit.catalogOf(machine.machineId)}
    {@const open = !collapsed[machine.machineId]}
    {@const expanded = !!showAll[machine.machineId]}
    <section class="flex flex-col pb-2">
      <Collapsible.Root {open} onOpenChange={() => toggleMachine(machine.machineId)}>
        <header class="flex items-center">
          <Collapsible.Trigger
            class="flex min-h-7 flex-1 items-center gap-1.5 rounded-md px-2 py-1 text-left transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
          >
            <IconChevronRight
              class="size-3 shrink-0 text-muted-foreground transition-transform duration-200 ease-out {open
                ? 'rotate-90'
                : ''}"
            />
            <IconServer class="size-3.5 shrink-0 text-muted-foreground" />
            <span class="truncate text-[13px] font-medium text-foreground">{machine.hostname}</span>
            <span
              class="size-1.5 shrink-0 rounded-full {machine.status === 'online'
                ? 'bg-success'
                : 'bg-muted-foreground'}"
              title={machine.status === 'online' ? 'Online' : 'Offline'}
            ></span>
          </Collapsible.Trigger>
          <!-- Outside the content, so folding a machine away cannot hide what it is waiting on. -->
          {#if blockedCount > 0}
            <span
              class="shrink-0 rounded-full bg-warning/15 px-1.5 text-[10px] font-medium text-warning tabular-nums"
            >
              {blockedCount} needs you
            </span>
          {/if}
          <button
            type="button"
            class="min-h-7 rounded px-1.5 font-mono text-[10px] text-muted-foreground/60 uppercase transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            onclick={() => loadCatalog(machine.machineId)}
            title="Reload sessions"
          >
            {machine.os}
          </button>
        </header>

        <Collapsible.Content>
          <div class="ml-4 flex flex-col border-l border-border/60 pl-1">
            {#if running.length > 0}
              <span
                class="px-1.5 pt-2 pb-0.5 text-[10px] font-medium tracking-wider text-muted-foreground/60 uppercase"
              >
                Live
              </span>
              {#each running as instance (instance.id)}
                {@const activity = cockpit.activityOf(instance.id)}
                {@const current = isCurrent(`/session/${instance.id}`)}
                <a
                  href="/session/{instance.id}"
                  aria-current={current ? 'page' : undefined}
                  class="flex min-h-7 items-center gap-2 rounded-md px-1.5 py-1 text-[13px] transition-colors hover:bg-accent
                    {current ? 'bg-accent' : activity === 'blocked' ? 'bg-warning/10' : ''}"
                  in:slide={rowIn}
                  out:slide={rowOut}
                >
                  <ActivityDot {activity} size={1.5} />
                  <span class="truncate font-mono text-foreground/90 {current ? 'font-medium' : ''}">
                    {leaf(instance.cwd)}
                  </span>
                  <span
                    class="ml-auto shrink-0 text-[10px] tabular-nums {activity === 'blocked'
                      ? 'font-medium text-warning'
                      : 'text-muted-foreground/70'}"
                  >
                    {ACTIVITY_LABEL[activity]}
                  </span>
                </a>
              {/each}
            {/if}

            {#if stored.length > 0}
              <span
                class="px-1.5 pt-2 pb-0.5 text-[10px] font-medium tracking-wider text-muted-foreground/60 uppercase"
                title="Claude Code sessions stored on this machine — any directory"
              >
                Recent sessions
              </span>
              {#each stored.slice(0, RECENT) as info (info.sessionId)}
                {@render storedRow(machine.machineId, info)}
              {/each}

              {#if stored.length > RECENT}
                <Collapsible.Root
                  open={expanded}
                  onOpenChange={() => (showAll[machine.machineId] = !expanded)}
                >
                  <Collapsible.Content>
                    <div class="flex flex-col">
                      {#each stored.slice(RECENT) as info (info.sessionId)}
                        {@render storedRow(machine.machineId, info)}
                      {/each}
                    </div>
                  </Collapsible.Content>
                  <Collapsible.Trigger
                    class="flex min-h-6 items-center px-1.5 py-1 text-left text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {expanded ? 'Show fewer' : `Show all ${stored.length}`}
                  </Collapsible.Trigger>
                </Collapsible.Root>
              {/if}
            {/if}

            {#if running.length === 0 && stored.length === 0}
              <p class="px-1.5 py-1 text-[11px] text-muted-foreground/70">No sessions.</p>
            {/if}
          </div>
        </Collapsible.Content>
      </Collapsible.Root>
    </section>
  {:else}
    <p class="px-2 py-2 text-[13px] text-muted-foreground">
      No machines connected.
      <a href="/session" class="underline transition-colors hover:text-foreground">
        How to connect one
      </a>
    </p>
  {/each}
</nav>
