<script lang="ts">
  import {
    IconChevronRight,
    IconPlus,
  } from '$lib/icons';
  import { onMount } from 'svelte';
  import { fly } from 'svelte/transition';
  import { quintOut } from 'svelte/easing';
  import type { SDKSessionInfo } from '@cockpit/core';
  import {
    cockpit,
    type InstanceRow,
    type ProjectRow,
  } from '$lib/cockpit/client.svelte';
  import LiveSessionRow from '$lib/cockpit/LiveSessionRow.svelte';
  import MachineMenu from '$lib/cockpit/MachineMenu.svelte';
  import StoredSessionRow from '$lib/cockpit/StoredSessionRow.svelte';
  import AttentionQueue from '$lib/cockpit/AttentionQueue.svelte';
  import SpawnPanel from '$lib/cockpit/SpawnPanel.svelte';
  import { machineLabel, machineOs } from '$lib/cockpit/machine';
  import { Button } from '$lib/components/ui/button';
  import * as Collapsible from '$lib/components/ui/collapsible';

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

  let spawnOpen = $state(false);
  let spawnPrefill = $state<{ machineId?: string; cwd?: string; projectId?: string } | undefined>(undefined);

  function openSpawn(prefill?: typeof spawnPrefill) {
    spawnPrefill = prefill;
    spawnOpen = true;
  }

  const machineCount = $derived(cockpit.machines.length);
  const onlineCount = $derived(cockpit.onlineMachines.length);
</script>

<div class="flex-1 overflow-y-auto p-4 sm:p-6">
  <div class="mx-auto flex max-w-5xl flex-col gap-5 2xl:max-w-none">
    <!-- Page header -->
    <header class="flex items-center gap-3">
      <h1 class="text-title">Fleet</h1>
      {#if cockpit.status !== 'connected'}
        <span class="text-caption">hub {cockpit.status}</span>
      {/if}
      <span class="text-micro text-muted-foreground">
        {onlineCount}/{machineCount} machine{machineCount === 1 ? '' : 's'}
      </span>
      <div class="ml-auto">
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
      <div class="grid grid-cols-1 gap-4 md:grid-cols-[repeat(auto-fill,minmax(480px,1fr))]">
        {#each groups as group, index (group.kind === 'project' ? `p-${group.project.id}` : `m-${group.machineId}`)}
          {@const live = group.live}
          {@const stored = group.stored}
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
            <!-- Group header -->
            {#if group.kind === 'project'}
              <div class="flex items-center gap-3 px-4 py-3">
                <div class="min-w-0 flex-1">
                  <span class="text-sm font-semibold">{group.project.name}</span>
                  <span class="block truncate font-mono text-micro text-muted-foreground">{group.project.cwd}</span>
                </div>
                <span class="text-micro text-muted-foreground tabular-nums" data-tabular>
                  {live.length + stored.length}
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
            {:else}
              {@const osInfo = machineOs(group.os)}
              {@const machine = cockpit.machines.find((m) => m.machineId === group.machineId)}
              {#if machine}
                <div class="flex items-center gap-3 px-4 py-3">
                  <MachineMenu {machine}>
                    <div class="flex min-w-0 flex-1 items-center gap-3">
                      {#if osInfo.Icon}
                        {@const OsIcon = osInfo.Icon}
                        <OsIcon class="size-5 shrink-0 text-muted-foreground" />
                      {/if}
                      <div class="min-w-0 flex-1">
                        <span class="text-sm font-semibold">{machineLabel(group.hostname)}</span>
                        <span class="block text-micro text-muted-foreground">{osInfo.label}{osInfo.arch ? ` ${osInfo.arch}` : ''}</span>
                      </div>
                    </div>
                  </MachineMenu>
                  <span class="text-micro text-muted-foreground tabular-nums" data-tabular>
                    {live.length + stored.length}
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
              {/if}
            {/if}

            <!-- Live sessions -->
            <div class="flex flex-col">
              {#each live as instance (instance.id)}
                <LiveSessionRow {instance} />
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
                  <StoredSessionRow
                    machineId={group.kind === 'project' ? group.project.machineId : group.machineId}
                    {info}
                  />
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
                        <StoredSessionRow
                          machineId={group.kind === 'project' ? group.project.machineId : group.machineId}
                          {info}
                        />
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

<SpawnPanel open={spawnOpen} prefill={spawnPrefill} onclose={() => (spawnOpen = false)} />
