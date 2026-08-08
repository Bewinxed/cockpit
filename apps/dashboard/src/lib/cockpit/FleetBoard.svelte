<script lang="ts">
  /**
   * The fleet board — what every machine and project is running, and what needs
   * a human. Kept alive by `session/+layout.svelte` alongside the conversation
   * panes rather than mounted by a route of its own: Fleet is the first tab in
   * the strip, so leaving it is switching tabs, and coming back should find the
   * board where it was left rather than rebuilt and re-animated.
   */
  import {
    IconChevronRight,
    IconPlus,
  } from '$lib/icons';
  import { onMount, untrack, type Snippet } from 'svelte';
  import { fly } from 'svelte/transition';
  import { quintOut } from 'svelte/easing';
  import { MediaQuery } from 'svelte/reactivity';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import type { SDKSessionInfo } from '@cockpit/core';
  import {
    cockpit,
    type InstanceRow,
    type ProjectRow,
  } from '$lib/cockpit/client.svelte';
  import FolderMenu from '$lib/cockpit/FolderMenu.svelte';
  import LiveSessionRow from '$lib/cockpit/LiveSessionRow.svelte';
  import MachineMenu from '$lib/cockpit/MachineMenu.svelte';
  import OsMark from '$lib/cockpit/OsMark.svelte';
  import StoredSessionRow from '$lib/cockpit/StoredSessionRow.svelte';
  import AttentionQueue from '$lib/cockpit/AttentionQueue.svelte';
  import PeekPane, { type PeekTarget } from '$lib/cockpit/PeekPane.svelte';
  import SpawnPanel from '$lib/cockpit/SpawnPanel.svelte';
  import { folderPrefs, identityVar } from '$lib/cockpit/folder-prefs.svelte';
  import { transcriptHref } from '$lib/cockpit/links';
  import { refreshTasks } from '$lib/cockpit/tasks.svelte';
  import { machineLabel, machineOs } from '$lib/cockpit/machine';
  import { isTyping } from '$lib/utils/typing';
  import { Button } from '$lib/components/ui/button';
  import * as Collapsible from '$lib/components/ui/collapsible';

  interface Props {
    /** Whether the board is the tab on screen. The keyboard belongs to that
     *  one; hidden, it only keeps its place. */
    active: boolean;
  }

  let { active }: Props = $props();

  /** Groups the fleet board shows: a project, or a machine with ungrouped sessions. */
  type BoardGroup =
    | { kind: 'project'; project: ProjectRow; live: InstanceRow[]; stored: SDKSessionInfo[] }
    | { kind: 'machine'; machineId: string; hostname: string; os: string; live: InstanceRow[]; stored: SDKSessionInfo[] };

  const groups = $derived.by((): BoardGroup[] => {
    const result: BoardGroup[] = [];
    const claimed = new Set<string>();

    for (const project of cockpit.projects) {
      const live = cockpit.liveIn(project);
      const stored = cockpit.storedIn(project);
      if (live.length === 0 && stored.length === 0) continue;
      for (const row of live) claimed.add(row.id);
      result.push({ kind: 'project', project, live, stored });
    }

    for (const machine of cockpit.machines) {
      const allLive = cockpit.listedOn(machine.machineId);
      const live = allLive.filter((row) => !claimed.has(row.id));
      const stored = cockpit.catalogOf(machine.machineId);
      if (live.length === 0 && stored.length === 0) continue;
      result.push({
        kind: 'machine',
        machineId: machine.machineId,
        hostname: machine.hostname,
        os: machine.os,
        live,
        stored,
      });
    }

    return result;
  });

  const stale = $derived(cockpit.staleInstances);
  let showStale = $state(false);

  let entering = $state(true);
  onMount(() => {
    const timer = setTimeout(() => (entering = false), 800);
    return () => clearTimeout(timer);
  });

  /**
   * One sweep of the fleet's task ledgers, so the rows can draw their rings —
   * the board asks, not the rows, or a card of thirty sessions is thirty round
   * trips in the same frame. Each session is asked once and the `Task*` frames
   * keep it current from there; the registry arrives after the board mounts and
   * grows as sessions start, so this re-arms on the list rather than on mount.
   */
  const swept = new Set<string>();
  $effect(() => {
    const live = cockpit.runningInstances;
    untrack(() => {
      let delay = 0;
      for (const instance of live) {
        if (swept.has(instance.id)) continue;
        swept.add(instance.id);
        setTimeout(() => refreshTasks(instance.id), delay);
        delay += 100;
      }
    });
  });

  let spawnOpen = $state(false);
  let spawnPrefill = $state<{ machineId?: string; cwd?: string; projectId?: string } | undefined>(undefined);

  function openSpawn(prefill?: typeof spawnPrefill) {
    spawnPrefill = prefill;
    spawnOpen = true;
  }

  /**
   * "New session on this machine", wherever it is asked from — the rail's machine
   * menu, the jump palette — is a link to `/session?machine=<id>`, and the board
   * is where that lands, so the board is what has to answer it. The params are
   * consumed once and then swapped out of the URL: left there, a refresh or a
   * return to this tab re-opens a panel the reader already dismissed. The board
   * is kept alive across tab switches, so this reacts to the URL rather than to
   * mounting, and the latch is what keeps one arrival from being read twice.
   */
  let consumed = $state.raw<string | null>(null);
  $effect(() => {
    if (!active || page.params.id) return;
    const url = page.url.href;
    const machineId = page.url.searchParams.get('machine');
    const cwd = page.url.searchParams.get('cwd');
    untrack(() => {
      if (!machineId || consumed === url) return;
      consumed = url;
      openSpawn({ machineId, cwd: cwd ?? undefined });
      void goto('/session', { replaceState: true, keepFocus: true, noScroll: true });
    });
  });

  const machineCount = $derived(cockpit.machines.length);
  const onlineCount = $derived(cockpit.onlineMachines.length);

  /**
   * Past this width the board has room to keep a session open beside it, so a
   * click stops being a navigation: one click peeks, Enter or a double-click
   * dives. Below it there is nowhere to peek into, so a row is only a link.
   */
  const roomForPeek = new MediaQuery('min-width: 1920px');

  let peeked = $state<PeekTarget | null>(null);
  $effect(() => {
    if (!roomForPeek.current) peeked = null;
  });

  const liveTarget = (instance: InstanceRow): PeekTarget => ({
    viewId: instance.id,
    href: `/session/${instance.id}`,
  });

  const storedTarget = (machineId: string, info: SDKSessionInfo): PeekTarget => ({
    viewId: info.sessionId,
    href: transcriptHref(machineId, info),
    browsing: { machineId, cwd: info.cwd ?? '' },
  });

  /** A modified click is the reader asking their browser for a tab, not a peek. */
  function peek(event: MouseEvent, target: PeekTarget): void {
    if (!roomForPeek.current || event.metaKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    peeked = target;
  }

  function dive(target: PeekTarget): void {
    if (!roomForPeek.current) return;
    peeked = target;
    void goto(target.href);
  }

  function onKeydown(event: KeyboardEvent): void {
    // The board is one of several tabs kept mounted at once; only the one on
    // screen answers for the keyboard.
    if (!active || !peeked || isTyping()) return;
    if (event.key === 'Escape') {
      peeked = null;
      return;
    }
    // A row that has the focus is a link and opens itself; this is for a peek
    // made with the pointer, where nothing on the board holds the key.
    if (event.key === 'Enter' && !(document.activeElement instanceof HTMLAnchorElement)) {
      event.preventDefault();
      void goto(peeked.href);
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

<!-- A board row stays the link it always was; where there is a pane to peek
     into, the wrapper takes the click off it and marks the one being shown.
     Selection is a pill so it is not mistaken for the hover band under it. -->
{#snippet peekable(target: PeekTarget, row: Snippet)}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="transition-colors duration-150 ease-out {peeked?.viewId === target.viewId
      ? 'overflow-hidden rounded-full bg-accent font-medium text-accent-foreground'
      : 'rounded-lg'}"
    onclick={(event) => peek(event, target)}
    ondblclick={() => dive(target)}
  >
    {@render row()}
  </div>
{/snippet}

<div class="flex min-h-0 flex-1">
  <div class="min-w-0 flex-1 overflow-y-auto p-4 sm:p-6">
    <div class="mx-auto flex max-w-5xl flex-col gap-5 2xl:max-w-none">
      <!-- Page header -->
      <header class="flex items-center gap-3">
        <h1 class="text-title">Fleet</h1>
        {#if cockpit.status !== 'connected'}
          <span class="text-caption">hub {cockpit.status}</span>
        {/if}
        <!-- Machines, and only machines: the board's cards are projects too, so a
             bare "2/2" over three of them read as a count of what is on screen. -->
        <span class="text-micro text-muted-foreground">
          {onlineCount} of {machineCount} machine{machineCount === 1 ? '' : 's'} online
        </span>
        <!-- The thumb bar owns this verb on a phone; two of it on one 390pt
             screen is the same duplication the rail's pill was. -->
        <div class="ml-auto hidden sm:block">
          <Button size="sm" class="pressable" onclick={() => openSpawn()}>
            <IconPlus />
            New session
          </Button>
        </div>
      </header>

      <!-- Attention queue -->
      <AttentionQueue />

      <!-- Session board: groups -->
      {#if groups.length > 0}
        <!-- `auto-fit`, not `auto-fill`: an ultrawide fills with empty tracks under
             `auto-fill` and pins three cards to 480px against a bare half-screen.
             Collapsed instead, the cards take the width they are given. -->
        <div
          class="grid grid-cols-1 gap-4 md:grid-cols-[repeat(auto-fit,minmax(480px,1fr))]
                 2xl:grid-cols-[repeat(auto-fit,minmax(620px,1fr))]"
        >
          {#each groups as group, index (group.kind === 'project' ? `p-${group.project.id}` : `m-${group.machineId}`)}
            {@const live = group.live}
            {@const stored = group.stored}
            {@const groupCwd = group.kind === 'project' ? group.project.cwd : undefined}
            {@const storedPreview = stored.slice(0, 5)}
            {@const hasMore = stored.length > 5}
            <section
              class="flex flex-col rounded-xl bg-card shadow-md"
              in:fly={{
                y: 6,
                duration: entering ? 240 : 0,
                delay: entering ? index * 60 : 0,
                easing: quintOut,
              }}
            >
              <!-- Group header. A project card reads like a machine card — icon
                   slot, name, one meta line — so the board has one header to
                   learn rather than two. -->
              {#if group.kind === 'project'}
                {@const count = live.length + stored.length}
                <!-- Header shares the rows' max-w-3xl measure: one right edge
                     per card at ultrawide, not two (finish-review finding). -->
                {@const Mark = folderPrefs.mark(group.project.cwd)}
                <FolderMenu
                  name={group.project.name}
                  cwd={group.project.cwd}
                  project={group.project}
                  onnew={() => openSpawn({ machineId: group.project.machineId, cwd: group.project.cwd, projectId: group.project.id })}
                >
                  <div class="flex max-w-3xl items-center gap-3 px-4 py-3">
                    <!-- The project's own hue and mark, the same ones its folder
                         wears in the rail: the card is recognisable before it is
                         read. -->
                    <Mark
                      class="identity-ink size-5 shrink-0"
                      style={identityVar(group.project.cwd)}
                    />
                    <div class="min-w-0 flex-1">
                      <span class="text-sm font-semibold">{group.project.name}</span>
                      <span class="block truncate font-mono text-micro text-muted-foreground">{group.project.cwd}</span>
                    </div>
                    <span
                      class="identity-tint shrink-0 rounded-full px-2 py-0.5 text-micro text-muted-foreground tabular-nums"
                      style={identityVar(group.project.cwd)}
                      data-tabular
                    >
                      {count} session{count === 1 ? '' : 's'}
                    </span>
                    <button
                      type="button"
                      class="flex size-8 items-center justify-center rounded-lg text-muted-foreground
                        transition-colors hover:bg-accent hover:text-foreground"
                      title="New session in {group.project.name}"
                      onclick={() => openSpawn({ machineId: group.project.machineId, cwd: group.project.cwd, projectId: group.project.id })}
                    >
                      <IconPlus class="size-4" />
                    </button>
                  </div>
                </FolderMenu>
              {:else}
                {@const osInfo = machineOs(group.os)}
                {@const machine = cockpit.machines.find((m) => m.machineId === group.machineId)}
                {@const count = live.length + stored.length}
                {#if machine}
                  <!-- The whole header answers the right button, not just the
                       name in it: a menu you have to hit a 20px glyph for is
                       one nobody finds. -->
                  <MachineMenu {machine}>
                    <div class="flex max-w-3xl items-center gap-3 px-4 py-3">
                      <OsMark os={group.os} class="size-5 shrink-0 text-muted-foreground" />
                      <div class="min-w-0 flex-1">
                        <span class="text-sm font-semibold">{machineLabel(group.hostname)}</span>
                        <span class="block text-micro text-muted-foreground">{osInfo.label}{osInfo.arch ? ` ${osInfo.arch}` : ''}</span>
                      </div>
                      <span class="shrink-0 text-micro text-muted-foreground tabular-nums" data-tabular>
                        {count} session{count === 1 ? '' : 's'}
                      </span>
                      <button
                        type="button"
                        class="flex size-8 items-center justify-center rounded-lg text-muted-foreground
                          transition-colors hover:bg-accent hover:text-foreground"
                        title="New session on {machineLabel(group.hostname)}"
                        onclick={() => openSpawn({ machineId: group.machineId })}
                      >
                        <IconPlus class="size-4" />
                      </button>
                    </div>
                  </MachineMenu>
                {/if}
              {/if}

              <!-- Live sessions -->
              <div class="flex flex-col">
                {#each live as instance (instance.id)}
                  {#snippet liveRow()}
                    <LiveSessionRow {instance} {groupCwd} />
                  {/snippet}
                  {@render peekable(liveTarget(instance), liveRow)}
                {:else}
                  {#if stored.length === 0}
                    <p class="px-4 pb-3 text-caption">
                      No sessions yet.
                      <button
                        type="button"
                        class="text-primary hover:underline"
                        onclick={() => {
                          if (group.kind === 'project') openSpawn({ machineId: group.project.machineId, cwd: group.project.cwd, projectId: group.project.id });
                          else openSpawn({ machineId: group.machineId });
                        }}
                      >Start one.</button>
                    </p>
                  {/if}
                {/each}
              </div>

              <!-- Stored sessions -->
              {#if storedPreview.length > 0}
                <div class="flex flex-col border-t border-border/50">
                  {#each storedPreview as info (info.sessionId)}
                    {@const machineId = group.kind === 'project' ? group.project.machineId : group.machineId}
                    {#snippet storedRow()}
                      <StoredSessionRow {machineId} {info} {groupCwd} />
                    {/snippet}
                    {@render peekable(storedTarget(machineId, info), storedRow)}
                  {/each}
                  {#if hasMore}
                    <Collapsible.Root class="flex flex-col">
                      <Collapsible.Trigger
                        class="flex h-8 items-center gap-1.5 px-3 text-micro text-muted-foreground transition-colors hover:text-foreground"
                      >
                        Show all ({stored.length})
                      </Collapsible.Trigger>
                      <Collapsible.Content>
                        {#each stored.slice(5) as info (info.sessionId)}
                          {@const machineId = group.kind === 'project' ? group.project.machineId : group.machineId}
                          {#snippet restRow()}
                            <StoredSessionRow {machineId} {info} {groupCwd} />
                          {/snippet}
                          {@render peekable(storedTarget(machineId, info), restRow)}
                        {/each}
                      </Collapsible.Content>
                    </Collapsible.Root>
                  {/if}
                </div>
              {/if}
            </section>
          {/each}
        </div>
      {:else if cockpit.machines.length === 0}
        <!-- No machines onboarding -->
        <section class="rounded-xl bg-card p-6 shadow-md">
          <h2 class="text-sm font-semibold">No machines yet</h2>
          <p class="mt-2 text-caption">
            Outpost runs Claude Code on your own hardware and watches it from here. Start the agent
            daemon on a machine, pointed at this hub, and it shows up in the rail.
          </p>
          <pre
            class="mt-3 overflow-x-auto rounded-lg bg-secondary px-3.5 py-2.5 font-mono text-micro text-foreground">COCKPIT_HUB_URL=ws://&lt;this-host&gt;:3456/ws bun run agent</pre>
        </section>
      {:else}
        <!-- Machines exist but no sessions -->
        <section class="rounded-xl bg-card p-6 shadow-md">
          <p class="text-caption">
            {cockpit.onlineMachines.length} machine{cockpit.onlineMachines.length === 1 ? '' : 's'} online, no sessions running.
          </p>
          <Button size="sm" class="pressable mt-3" onclick={() => openSpawn()}>
            <IconPlus />
            Start a session
          </Button>
        </section>
      {/if}

      <!-- Stale sessions -->
      {#if stale.length > 0}
        <section>
          <Collapsible.Root
            open={showStale}
            onOpenChange={() => (showStale = !showStale)}
            class="flex flex-col gap-2"
          >
            <Collapsible.Trigger
              class="flex min-h-6 items-center gap-2 text-left text-micro font-medium text-muted-foreground
                transition-colors hover:text-foreground"
            >
              <IconChevronRight class="size-3 transition-transform {showStale ? 'rotate-90' : ''}" />
              Stale
              <span class="font-mono tabular-nums" data-tabular>{stale.length}</span>
            </Collapsible.Trigger>
            <Collapsible.Content>
              <div class="flex flex-col gap-1">
                <p class="text-micro text-muted-foreground">
                  The daemon running these went away. They may still be alive on their machine — the
                  hub cannot tell, so it stops counting them as live.
                </p>
                {#each stale as instance (instance.id)}
                  <span
                    class="flex items-baseline gap-3 rounded-lg px-3 py-2 text-micro text-muted-foreground"
                  >
                    <span class="truncate font-mono">{instance.cwd || '—'}</span>
                    <span class="ml-auto shrink-0 font-mono">{instance.machineId}</span>
                  </span>
                {/each}
              </div>
            </Collapsible.Content>
          </Collapsible.Root>
        </section>
      {/if}
    </div>
  </div>

  <!-- The board's own right padding is the gap, so the pane sits one column
       over rather than in a second gutter. -->
  {#if roomForPeek.current}
    <aside class="flex w-[520px] shrink-0 flex-col py-4 pr-4 sm:py-6 sm:pr-6" aria-label="Session detail">
      <PeekPane target={peeked} onclose={() => (peeked = null)} />
    </aside>
  {/if}
</div>

<SpawnPanel open={spawnOpen} prefill={spawnPrefill} onclose={() => (spawnOpen = false)} />
