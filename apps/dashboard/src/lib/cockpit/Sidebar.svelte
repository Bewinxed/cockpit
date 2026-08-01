<script module lang="ts">
  import { IconChevronRight, IconFolder, IconHistory, IconPlus, IconRefresh } from '$lib/icons';
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
  import { Button } from '$lib/components/ui/button';
  import * as Collapsible from '$lib/components/ui/collapsible';
  import * as Sidebar from '$lib/components/ui/sidebar';
  import type { SDKSessionInfo } from '@cockpit/core';
  import { formatDistanceToNow } from '$lib/utils/time';
  import { ACTIVITY_LABEL } from './activity';
  import ActivityDot from './ActivityDot.svelte';
  import { cockpit, loadCatalog } from './client.svelte';
  import LiveSessionMenu from './LiveSessionMenu.svelte';
  import MachineMenu from './MachineMenu.svelte';
  import StoredSessionMenu from './StoredSessionMenu.svelte';
  import { sessionTitle, transcriptHref } from './links';
  import { machineLabel, machineOs, signInWarning } from './machine';

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
  <Sidebar.MenuItem>
    <StoredSessionMenu {machineId} {info}>
      <Sidebar.MenuButton isActive={current} class="h-auto items-start px-1.5 py-1">
        {#snippet child({ props })}
          <a
            {...props}
            {href}
            aria-current={current ? 'page' : undefined}
            in:slide={rowIn}
            out:slide={rowOut}
          >
            <IconHistory class="mt-0.5 shrink-0 opacity-70" />
            <span class="flex min-w-0 flex-1 flex-col">
              <span class="flex items-baseline gap-2">
                <span class="truncate text-[13px] leading-5">{sessionTitle(info)}</span>
                <span class="ml-auto shrink-0 text-xs opacity-60 tabular-nums">
                  {formatDistanceToNow(new Date(info.lastModified))}
                </span>
              </span>
              {#if info.cwd}
                <span class="truncate font-mono text-xs leading-4 opacity-70" title={info.cwd}>
                  {leaf(info.cwd)}
                </span>
              {/if}
            </span>
          </a>
        {/snippet}
      </Sidebar.MenuButton>
    </StoredSessionMenu>
  </Sidebar.MenuItem>
{/snippet}

<Sidebar.Root
  collapsible="none"
  role="navigation"
  aria-label="Machines and sessions"
  class="h-full border-r border-border"
>
  <Sidebar.Header>
    <Button href="/session" size="sm" class="justify-start">
      <IconPlus class="shrink-0" />
      New session
    </Button>
  </Sidebar.Header>

  <Sidebar.Content>
    {#if cockpit.projects.length > 0}
      <Sidebar.Group class="py-0">
        <Sidebar.GroupLabel class="px-2">Projects</Sidebar.GroupLabel>
        <Sidebar.Menu>
          {#each cockpit.projects as project (project.id)}
            {@const current = isCurrent(`/project/${project.id}`)}
            <Sidebar.MenuItem>
              <Sidebar.MenuButton isActive={current} class="h-auto items-start px-2 py-1">
                {#snippet child({ props })}
                  <a
                    {...props}
                    href="/project/{project.id}"
                    aria-current={current ? 'page' : undefined}
                  >
                    <IconFolder class="mt-0.5 shrink-0 text-muted-foreground" />
                    <span class="flex min-w-0 flex-1 flex-col">
                      <span class="truncate text-[13px] leading-5">{project.name}</span>
                      <span
                        class="truncate font-mono text-xs leading-4 opacity-70"
                      >
                        {project.cwd}
                      </span>
                    </span>
                  </a>
                {/snippet}
              </Sidebar.MenuButton>
            </Sidebar.MenuItem>
          {/each}
        </Sidebar.Menu>
      </Sidebar.Group>
    {/if}

    {#if sideQuests.length > 0}
      <Sidebar.Group class="py-0">
        <Sidebar.GroupLabel class="px-2">Side quests</Sidebar.GroupLabel>
        <Sidebar.Menu>
          {#each sideQuests as instance (instance.id)}
            {@const activity = cockpit.activityOf(instance.id)}
            {@const failed = instance.status === 'error'}
            {@const current = isCurrent(`/session/${instance.id}`)}
            <Sidebar.MenuItem>
              <LiveSessionMenu {instance}>
                <Sidebar.MenuButton
                  isActive={current}
                  class="min-h-7 gap-2 border border-dashed border-muted-foreground/30 px-2 py-1 text-[13px]
                    {current ? '' : failed ? 'bg-warning/10' : ''}"
                >
                  {#snippet child({ props })}
                    <a
                      {...props}
                      href="/session/{instance.id}"
                      aria-current={current ? 'page' : undefined}
                      in:slide={rowIn}
                      out:slide={rowOut}
                    >
                      {#if failed}
                        <span class="size-1.5 shrink-0 rounded-full bg-warning"></span>
                      {:else}
                        <ActivityDot {activity} size={1.5} />
                      {/if}
                      <span class="truncate font-mono">{leaf(instance.cwd)}</span>
                      <span
                        class="ml-auto shrink-0 rounded-sm bg-accent px-1 py-px text-xs tracking-wide text-accent-foreground"
                      >
                        scratch
                      </span>
                      {#if failed}
                        <span class="shrink-0 text-xs font-medium text-warning">Failed</span>
                      {/if}
                    </a>
                  {/snippet}
                </Sidebar.MenuButton>
              </LiveSessionMenu>
            </Sidebar.MenuItem>
          {/each}
        </Sidebar.Menu>
      </Sidebar.Group>
    {/if}

    {#if machines.length > 0}
      <Sidebar.GroupLabel class="px-4">Machines</Sidebar.GroupLabel>
    {/if}

    {#each machines as machine (machine.machineId)}
      {@const running = cockpit.runningOn(machine.machineId)}
      <!-- A session that died while parked keeps its permission in view state; nobody
           can answer it any more, so it is not something this machine needs you for. -->
      {@const blockedCount = running.filter(
        (i) => i.status !== 'error' && cockpit.activityOf(i.id) === 'blocked'
      ).length}
      {@const stored = cockpit.catalogOf(machine.machineId)}
      {@const open = !collapsed[machine.machineId]}
      {@const expanded = !!showAll[machine.machineId]}
      {@const os = machineOs(machine.os)}
      {@const needsSignIn = signInWarning(machine)}
      <Sidebar.Group class="py-0">
        <Collapsible.Root {open} onOpenChange={() => toggleMachine(machine.machineId)}>
          <MachineMenu {machine}>
            <header class="flex items-center">
              <Sidebar.GroupLabel
                class="h-auto min-w-0 flex-1 gap-1.5 px-2 py-1 text-sidebar-foreground hover:bg-sidebar-accent"
              >
                {#snippet child({ props })}
                  <Collapsible.Trigger {...props} title="{machine.hostname} · {machine.os}">
                    <IconChevronRight
                      class="size-3 shrink-0 text-muted-foreground transition-transform duration-200 ease-out {open
                        ? 'rotate-90'
                        : ''}"
                    />
                    <os.Icon class="size-3.5 shrink-0 text-muted-foreground" />
                    <span class="min-w-0 truncate text-[13px] font-medium">
                      {machineLabel(machine.hostname)}
                    </span>
                    <!-- A machine that cannot start a session is not ready, however
                         connected it is, so it never gets to wear the green dot. -->
                    <span
                      class="size-1.5 shrink-0 rounded-full {machine.status !== 'online'
                        ? 'bg-muted-foreground'
                        : needsSignIn
                          ? 'bg-warning'
                          : 'bg-success'}"
                      title={machine.status !== 'online'
                        ? 'Offline'
                        : needsSignIn
                          ? 'Online, but not signed in'
                          : 'Online'}
                    ></span>
                    <span class="shrink-0 text-xs opacity-60">{os.label}</span>
                  </Collapsible.Trigger>
                {/snippet}
              </Sidebar.GroupLabel>
              <!-- Outside the content, so folding a machine away cannot hide what it is waiting on. -->
              {#if needsSignIn}
                <span class="shrink-0 text-xs font-medium text-warning" title={needsSignIn}>
                  Needs sign-in
                </span>
              {/if}
              {#if blockedCount > 0}
                <span
                  class="shrink-0 rounded-full bg-warning/15 px-1.5 text-xs font-medium text-warning tabular-nums"
                >
                  {blockedCount} needs you
                </span>
              {/if}
              <Button
                variant="ghost"
                size="icon-xs"
                class="shrink-0 opacity-60 hover:opacity-100"
                onclick={() => loadCatalog(machine.machineId)}
                title="Reload sessions"
                aria-label="Reload sessions on {machineLabel(machine.hostname)}"
              >
                <IconRefresh />
              </Button>
            </header>
          </MachineMenu>

          <Collapsible.Content>
            <div class="ml-4 border-l border-border/60 pl-1">
              {#if running.length > 0}
                <Sidebar.GroupLabel class="h-auto px-1.5 pt-2 pb-0.5">
                  Live
                </Sidebar.GroupLabel>
                <Sidebar.Menu>
                  {#each running as instance (instance.id)}
                    {@const activity = cockpit.activityOf(instance.id)}
                    {@const failed = instance.status === 'error'}
                    {@const current = isCurrent(`/session/${instance.id}`)}
                    <Sidebar.MenuItem>
                      <LiveSessionMenu {instance}>
                        <Sidebar.MenuButton
                          isActive={current}
                          class="min-h-7 gap-2 px-1.5 py-1 text-[13px]
                            {!current && (failed || activity === 'blocked') ? 'bg-warning/10' : ''}"
                        >
                          {#snippet child({ props })}
                            <a
                              {...props}
                              href="/session/{instance.id}"
                              aria-current={current ? 'page' : undefined}
                              in:slide={rowIn}
                              out:slide={rowOut}
                            >
                              {#if failed}
                                <span class="size-1.5 shrink-0 rounded-full bg-warning"></span>
                              {:else}
                                <ActivityDot {activity} size={1.5} />
                              {/if}
                              <span class="truncate font-mono">
                                {leaf(instance.cwd)}
                              </span>
                              <span
                                class="ml-auto shrink-0 text-xs tabular-nums {failed ||
                                activity === 'blocked'
                                  ? 'font-medium text-warning'
                                  : 'opacity-70'}"
                              >
                                {failed ? 'Failed' : ACTIVITY_LABEL[activity]}
                              </span>
                            </a>
                          {/snippet}
                        </Sidebar.MenuButton>
                      </LiveSessionMenu>
                    </Sidebar.MenuItem>
                  {/each}
                </Sidebar.Menu>
              {/if}

              {#if stored.length > 0}
                <Sidebar.GroupLabel
                  class="h-auto px-1.5 pt-2 pb-0.5"
                  title="Claude Code sessions stored on this machine — any directory"
                >
                  Recent sessions
                </Sidebar.GroupLabel>
                <Sidebar.Menu>
                  {#each stored.slice(0, RECENT) as info (info.sessionId)}
                    {@render storedRow(machine.machineId, info)}
                  {/each}
                </Sidebar.Menu>

                {#if stored.length > RECENT}
                  <Collapsible.Root
                    open={expanded}
                    onOpenChange={() => (showAll[machine.machineId] = !expanded)}
                  >
                    <Collapsible.Content>
                      <Sidebar.Menu>
                        {#each stored.slice(RECENT) as info (info.sessionId)}
                          {@render storedRow(machine.machineId, info)}
                        {/each}
                      </Sidebar.Menu>
                    </Collapsible.Content>
                    <Collapsible.Trigger
                      class="flex min-h-6 items-center px-1.5 py-1 text-left text-xs font-medium text-muted-foreground transition-colors  focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {expanded ? 'Show fewer' : `Show all ${stored.length}`}
                    </Collapsible.Trigger>
                  </Collapsible.Root>
                {/if}
              {/if}

              {#if running.length === 0 && stored.length === 0}
                <p class="px-1.5 py-1 text-xs opacity-70">No sessions.</p>
              {/if}
            </div>
          </Collapsible.Content>
        </Collapsible.Root>
      </Sidebar.Group>
    {:else}
      <p class="px-4 py-2 text-[13px] text-muted-foreground">
        No machines connected.
        <a href="/session" class="underline transition-colors ">
          How to connect one
        </a>
      </p>
    {/each}
  </Sidebar.Content>
</Sidebar.Root>
