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

  const collapsed = $state<Record<string, boolean>>(readCollapsed());

  function toggleMachine(machineId: string): void {
    collapsed[machineId] = !collapsed[machineId];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(collapsed));
  }

  /**
   * Which sessions are showing the subagents they have out. Not persisted:
   * subagents are the shortest-lived thing the rail draws, and an expansion
   * restored onto work that finished hours ago is noise, not memory.
   */
  const unfolded = $state<Record<string, boolean>>({});

  const toggleSubagents = (instanceId: string): void => {
    unfolded[instanceId] = !unfolded[instanceId];
  };

  const BRANCH_DOT: Record<string, string> = {
    error: 'bg-destructive',
    running: 'bg-success',
    starting: 'bg-warning',
    complete: 'bg-muted-foreground/40',
  };
</script>

<script lang="ts">
  /**
   * Machines -> sessions, the peer model (NEW.md S1): a machine's live instances
   * and its stored sessions read the same whether it is this box or another one.
   * Above all of it sits whatever the reader pinned, in the order they put it.
   */
  import { page } from '$app/state';
  import { flip } from 'svelte/animate';
  import { slide } from 'svelte/transition';
  import { quintOut } from 'svelte/easing';
  import { dndzone, type DndEvent } from 'svelte-dnd-action';

  const TOUCH_DRAG_DELAY_MS = 1200;
  import { Button } from '$lib/components/ui/button';
  import * as Collapsible from '$lib/components/ui/collapsible';
  import * as Sidebar from '$lib/components/ui/sidebar';
  import type { SDKSessionInfo } from '@cockpit/core';
  import {
    IconChevronRight,
    IconFolderDuo,
    IconHistoryDuo,
    IconPin,
    IconPinFilled,
    IconPinList,
    IconRefresh,
    IconKey,
    IconSparklesDuo,
    IconSubagentsDuo,
    IconTools,
  } from '$lib/icons';
  import { formatDistanceToNow } from '$lib/utils/time';
  import { ACTIVITY_LABEL, SLEEPING_HINT, SLEEPING_LABEL } from './activity';
  import ActivityDot from './ActivityDot.svelte';
  import {
    cockpit,
    isFailed,
    isResumable,
    loadCatalog,
    type InstanceRow,
    type Machine,
    type ProjectRow,
  } from './client.svelte';
  import { groupByCwd, isCwdGroup } from './grouping';
  import LiveSessionMenu from './LiveSessionMenu.svelte';
  import MachineMenu from './MachineMenu.svelte';
  import MachineLogin from './MachineLogin.svelte';
  import StoredSessionMenu from './StoredSessionMenu.svelte';
  import { sessionTitle, transcriptHref } from './links';
  import { machineLabel, machineOs, signInWarning } from './machine';
  import { orderMachines, rail, type Pin, type PinKind } from './rail.svelte';

  const RECENT = 6;

  /** 32px row, 8px radius, one-line, consistent slots. */
  const ROW = 'h-8 gap-2 rounded-lg px-2 text-[13px]';
  const STACK = 'h-auto items-start gap-2 rounded-lg px-2 py-1.5';
  const NAME = 'truncate text-[13px] leading-5';
  const PATH = 'truncate font-mono text-xs leading-4 text-muted-foreground';
  const ITEM = 'rounded-lg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none';

  type RailItem = { id: string; pin: Pin } & (
    | { kind: 'machine'; machine: Machine }
    | { kind: 'project'; project: ProjectRow }
    | { kind: 'session'; instance: InstanceRow }
    | { kind: 'stored'; machineId: string; info: SDKSessionInfo }
  );

  type MachineItem = { id: string; machine: Machine };

  function resolve(pin: Pin): RailItem | null {
    const id = `${pin.kind}:${pin.id}`;
    switch (pin.kind) {
      case 'machine': {
        const machine = cockpit.machines.find((row) => row.machineId === pin.id);
        return machine ? { id, pin, kind: 'machine', machine } : null;
      }
      case 'project': {
        const project = cockpit.project(pin.id);
        return project ? { id, pin, kind: 'project', project } : null;
      }
      case 'session': {
        const instance = cockpit.listedInstances.find((row) => row.id === pin.id);
        return instance ? { id, pin, kind: 'session', instance } : null;
      }
      case 'stored': {
        for (const machine of cockpit.machines) {
          const info = cockpit
            .catalogOf(machine.machineId)
            .find((entry) => entry.sessionId === pin.id);
          if (info) return { id, pin, kind: 'stored', machineId: machine.machineId, info };
        }
        return null;
      }
    }
  }

  const unpinned = (instance: InstanceRow) => !rail.isPinned('session', instance.id);

  const pinnedItems = $derived(
    rail.pins.map(resolve).filter((item): item is RailItem => item !== null)
  );
  const machineItems = $derived(
    orderMachines(cockpit.machines)
      .filter((machine) => !rail.isPinned('machine', machine.machineId))
      .map((machine) => ({ id: machine.machineId, machine }))
  );

  let pinnedDrag = $state<RailItem[] | null>(null);
  let machineDrag = $state<MachineItem[] | null>(null);
  const pinned = $derived(pinnedDrag ?? pinnedItems);
  const machines = $derived(machineDrag ?? machineItems);

  function considerPins(event: CustomEvent<DndEvent<RailItem>>): void {
    pinnedDrag = event.detail.items;
  }

  function finalizePins(event: CustomEvent<DndEvent<RailItem>>): void {
    pinnedDrag = null;
    rail.setPins(event.detail.items.map((item) => item.pin));
  }

  function considerMachines(event: CustomEvent<DndEvent<MachineItem>>): void {
    machineDrag = event.detail.items;
  }

  function finalizeMachines(event: CustomEvent<DndEvent<MachineItem>>): void {
    machineDrag = null;
    const shown = event.detail.items.map((item) => item.machine.machineId);
    const hidden = rail.machineOrder.filter((id) => !shown.includes(id));
    rail.setMachineOrder([...shown, ...hidden]);
  }

  const parentOf = (quest: InstanceRow): InstanceRow | null => {
    const candidates = cockpit.listedInstances.filter(
      (row) =>
        row.kind !== 'scratch' && row.machineId === quest.machineId && row.cwd === quest.cwd
    );
    return candidates.length === 1 ? candidates[0] : null;
  };

  const questsUnder = (instance: InstanceRow): InstanceRow[] =>
    instance.kind === 'scratch'
      ? []
      : cockpit.scratchInstances.filter((quest) => parentOf(quest)?.id === instance.id);

  const orphanQuest = (quest: InstanceRow): boolean => parentOf(quest) === null;

  let loginTarget = $state<Machine | null>(null);

  const sideQuests = $derived(cockpit.scratchInstances.filter(unpinned).filter(orphanQuest));
  const projects = $derived(
    cockpit.projects.filter((project) => !rail.isPinned('project', project.id))
  );

  let showAll = $state<Record<string, boolean>>({});

  let settled = $state(false);
  $effect(() => {
    if (cockpit.machines.length > 0 && !settled) {
      requestAnimationFrame(() => (settled = true));
    }
  });
  const rowIn = $derived({ duration: settled ? 250 : 0, easing: quintOut });
  const rowOut = $derived({ duration: settled ? 180 : 0, easing: quintOut });

  const isCurrent = (href: string) => page.url.pathname + page.url.search === href;
  const leaf = (cwd: string) => cwd.split('/').pop() || cwd;

  const titleOf = (instance: InstanceRow): string | null => {
    if (!instance.sessionId) return null;
    const info = cockpit
      .catalogOf(instance.machineId)
      .find((row) => row.sessionId === instance.sessionId);
    return info ? sessionTitle(info) : null;
  };

  /* ---- Roving tabindex ---- */
  let railEl: HTMLElement | null = $state(null);

  function rovingKeydown(event: KeyboardEvent) {
    if (!railEl) return;
    const rows = [...railEl.querySelectorAll<HTMLElement>('[data-rail-row]')];
    if (rows.length === 0) return;

    const focused = document.activeElement as HTMLElement;
    const at = rows.indexOf(focused);

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const next = at < rows.length - 1 ? at + 1 : 0;
      rows[next]?.focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      const next = at > 0 ? at - 1 : rows.length - 1;
      rows[next]?.focus();
    } else if (event.key === 'ArrowRight') {
      const trigger = focused.querySelector<HTMLElement>('[data-collapse-trigger]');
      if (trigger && !trigger.getAttribute('data-state')?.includes('open')) trigger.click();
    } else if (event.key === 'ArrowLeft') {
      const trigger = focused.querySelector<HTMLElement>('[data-collapse-trigger]');
      if (trigger && trigger.getAttribute('data-state')?.includes('open')) trigger.click();
    }
  }
</script>

{#snippet pinToggle(kind: PinKind, id: string, what: string)}
  {@const on = rail.isPinned(kind, id)}
  <Sidebar.MenuAction
    showOnHover={!on}
    aria-pressed={on}
    aria-label={on ? `Unpin ${what}` : `Pin ${what}`}
    title={on ? `Unpin ${what}` : `Pin ${what}`}
    onclick={() => rail.togglePin(kind, id)}
  >
    {#if on}
      <IconPinFilled />
    {:else}
      <IconPin />
    {/if}
  </Sidebar.MenuAction>
{/snippet}

{#snippet projectBody(project: ProjectRow)}
  {@const current = isCurrent(`/project/${project.id}`)}
  <Sidebar.MenuButton isActive={current} class={STACK}>
    {#snippet child({ props })}
      <a
        {...props}
        href="/project/{project.id}"
        aria-current={current ? 'page' : undefined}
        data-rail-row
      >
        <IconFolderDuo class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <span class="flex min-w-0 flex-1 flex-col">
          <span class={NAME}>{project.name}</span>
          <span class={PATH}>{project.cwd}</span>
        </span>
      </a>
    {/snippet}
  </Sidebar.MenuButton>
  {@render pinToggle('project', project.id, project.name)}
{/snippet}

{#snippet storedBody(machineId: string, info: SDKSessionInfo)}
  {@const href = transcriptHref(machineId, info)}
  {@const current = isCurrent(href)}
  <StoredSessionMenu {machineId} {info}>
    <Sidebar.MenuButton isActive={current} class={STACK}>
      {#snippet child({ props })}
        <a
          {...props}
          {href}
          aria-current={current ? 'page' : undefined}
          data-rail-row
          in:slide={rowIn}
          out:slide={rowOut}
        >
          <IconHistoryDuo class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <span class="flex min-w-0 flex-1 flex-col">
            <span class="flex items-baseline gap-2">
              <span class={NAME}>{sessionTitle(info)}</span>
              <span class="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
                {formatDistanceToNow(new Date(info.lastModified))}
              </span>
            </span>
            {#if info.cwd}
              <span class={PATH} title={info.cwd}>{leaf(info.cwd)}</span>
            {/if}
          </span>
        </a>
      {/snippet}
    </Sidebar.MenuButton>
  </StoredSessionMenu>
  {@render pinToggle('stored', info.sessionId, sessionTitle(info))}
{/snippet}

{#snippet sessionBody(instance: InstanceRow, grouped: boolean = false)}
  {@const title = grouped ? titleOf(instance) : null}
  {@const activity = cockpit.activityOf(instance.id)}
  {@const branches = cockpit.subagentsOf(instance.id)}
  {@const delegated = cockpit.runningSubagentsOf(instance.id)}
  {@const handoff = cockpit.handoffFor(instance.id)}
  {@const handed = handoff !== null}
  {@const handedFrom = handoff
    ? (cockpit.instances.find((row) => row.id === handoff.from)?.cwd.split('/').filter(Boolean).pop() ??
      'another session')
    : ''}
  {@const sleeping = isResumable(instance)}
  {@const failed = isFailed(instance)}
  {@const quest = instance.kind === 'scratch'}
  {@const warn = failed || activity === 'blocked'}
  {@const current = isCurrent(`/session/${instance.id}`)}
  <LiveSessionMenu {instance}>
    <Sidebar.MenuButton
      isActive={current}
      class="{ROW} {!current && warn ? 'bg-error/10 text-error' : ''}"
    >
      {#snippet child({ props })}
        <a
          {...props}
          href="/session/{instance.id}"
          aria-current={current ? 'page' : undefined}
          title={sleeping ? SLEEPING_HINT : undefined}
          data-rail-row
          in:slide={rowIn}
          out:slide={rowOut}
        >
          {#if failed}
            <span class="size-1.5 shrink-0 rounded-full bg-error"></span>
          {:else if sleeping}
            <span class="size-1.5 shrink-0 rounded-full bg-muted-foreground/40"></span>
          {:else}
            <ActivityDot {activity} size={1.5} />
          {/if}
          {#if quest}
            <IconSparklesDuo class="size-4 shrink-0" />
          {/if}
          {#if title}
            <span class="truncate">{title}</span>
          {:else}
            <span class="truncate font-mono">{leaf(instance.cwd)}</span>
          {/if}
          {#if handed}
            <span
              class="ml-auto flex shrink-0 items-center gap-1 rounded-full bg-primary/15 px-1.5
                     py-0.5 text-xs font-medium text-primary"
              title="Handed work from {handedFrom} — waiting for this session's next turn"
            >
              <IconSubagentsDuo class="size-3" />
              handed
            </span>
          {/if}
          {#if delegated > 0}
            <span
              class="ml-auto flex shrink-0 items-center gap-0.5 rounded-full bg-success/15 px-1.5
                     py-0.5 text-xs font-medium tabular-nums text-success"
              title="{delegated} subagent{delegated === 1 ? '' : 's'} running"
            >
              <IconSubagentsDuo class="size-3" />
              {delegated}
            </span>
          {/if}
          <span
            class="shrink-0 text-xs tabular-nums {delegated > 0 ? '' : 'ml-auto'} {warn
              ? 'font-medium'
              : 'text-muted-foreground'}"
          >
            {failed ? 'Failed' : sleeping ? SLEEPING_LABEL : ACTIVITY_LABEL[activity]}
          </span>
        </a>
      {/snippet}
    </Sidebar.MenuButton>
  </LiveSessionMenu>
  {@render pinToggle('session', instance.id, leaf(instance.cwd))}

  {#each questsUnder(instance) as quest (quest.id)}
    <div class="pl-4">
      {@render sessionBody(quest)}
    </div>
  {/each}

  {#if branches.length > 0}
    {@const showing = unfolded[instance.id] ?? false}
    <button
      type="button"
      class="flex h-7 w-full items-center gap-1.5 rounded-lg py-0.5 pr-2 pl-7 text-xs
             text-muted-foreground transition-colors duration-150
             hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      aria-expanded={showing}
      onclick={() => toggleSubagents(instance.id)}
    >
      <IconChevronRight
        class="size-3 shrink-0 transition-transform duration-240 {showing ? 'rotate-90' : ''}"
        style="transition-timing-function: var(--ease-out-expo)"
      />
      <span>
        {branches.length} subagent{branches.length === 1 ? '' : 's'}
      </span>
    </button>

    {#if showing}
      <ul class="flex flex-col gap-0.5 pl-7" transition:slide={rowIn}>
        {#each branches as branch (branch.toolUseId)}
          <li>
            <a
              href="/session/{instance.id}#subagent-{branch.toolUseId}"
              class="flex items-start gap-1.5 rounded-lg px-2 py-1 text-xs
                     text-muted-foreground transition-colors duration-150
                     hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              title={branch.description ?? branch.subagentType}
            >
              <span
                class="mt-1 size-1.5 shrink-0 rounded-full {BRANCH_DOT[branch.status] ??
                  'bg-muted-foreground/40'} {branch.status === 'running' ? 'animate-pulse' : ''}"
              ></span>
              <span class="min-w-0 flex-1">
                <span class="block truncate">{branch.description ?? branch.subagentType}</span>
                {#if branch.summary && branch.status === 'running'}
                  <span class="block truncate text-muted-foreground">{branch.summary}</span>
                {/if}
              </span>
            </a>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
{/snippet}

{#snippet sessionList(instances: InstanceRow[], heading: string)}
  {#if instances.length > 0}
    <Sidebar.GroupLabel class="h-auto px-2 pt-3 pb-1 text-[13px] font-medium text-muted-foreground">
      {heading}
    </Sidebar.GroupLabel>
    <Sidebar.Menu>
      {#each groupByCwd(instances) as entry (isCwdGroup(entry) ? `dir:${entry.cwd}` : entry.id)}
        {#if isCwdGroup(entry)}
          <Sidebar.GroupLabel class="h-auto gap-1.5 px-2 pt-2 pb-1" title={entry.cwd}>
            <IconFolderDuo class="size-3.5 shrink-0" />
            <span class="truncate font-mono text-xs font-medium">
              {leaf(entry.cwd)}
            </span>
            <span class="shrink-0 text-xs tabular-nums text-muted-foreground">
              {entry.rows.length}
            </span>
          </Sidebar.GroupLabel>
          {#each entry.rows as instance (instance.id)}
            <Sidebar.MenuItem class={ITEM}>
              <div class="pl-4">
                {@render sessionBody(instance, true)}
              </div>
            </Sidebar.MenuItem>
          {/each}
        {:else}
          <Sidebar.MenuItem class={ITEM}>
            {@render sessionBody(entry)}
          </Sidebar.MenuItem>
        {/if}
      {/each}
    </Sidebar.Menu>
  {/if}
{/snippet}

{#snippet machineGroup(machine: Machine)}
  {@const live = cockpit.liveOn(machine.machineId)}
  {@const blockedCount = live.filter((i) => cockpit.activityOf(i.id) === 'blocked').length}
  {@const shownLive = live.filter(unpinned)}
  {@const shownStopped = cockpit.notRunningOn(machine.machineId).filter(unpinned)}
  {@const stored = cockpit
    .catalogOf(machine.machineId)
    .filter((info) => !rail.isPinned('stored', info.sessionId))}
  {@const open = !collapsed[machine.machineId]}
  {@const expanded = !!showAll[machine.machineId]}
  {@const os = machineOs(machine.os)}
  {@const needsSignIn = signInWarning(machine)}
  {@const isPinned = rail.isPinned('machine', machine.machineId)}
  <Sidebar.Group class="py-0">
    <Collapsible.Root {open} onOpenChange={() => toggleMachine(machine.machineId)}>
      <MachineMenu {machine}>
        <header class="flex items-center" data-rail-row tabindex="-1">
          <Sidebar.GroupLabel
            class="h-8 min-w-0 flex-1 gap-1.5 rounded-lg px-2 text-sidebar-foreground hover:bg-sidebar-accent"
          >
            {#snippet child({ props })}
              <Collapsible.Trigger {...props} title="{machine.hostname} · {machine.os}" data-collapse-trigger>
                <IconChevronRight
                  class="size-3 shrink-0 text-muted-foreground transition-transform duration-240"
                  style="transition-timing-function: var(--ease-out-expo); {open ? 'transform: rotate(90deg)' : ''}"
                />
                <os.Icon class="size-4 shrink-0 text-muted-foreground" />
                <span class="min-w-0 truncate text-[13px] font-medium">
                  {machineLabel(machine.hostname)}
                </span>
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
                <span class="shrink-0 text-xs text-muted-foreground">{os.label}</span>
              </Collapsible.Trigger>
            {/snippet}
          </Sidebar.GroupLabel>
          {#if needsSignIn}
            <span class="shrink-0 text-xs font-medium text-warning" title={needsSignIn}>
              Needs sign-in
            </span>
          {/if}
          {#if blockedCount > 0}
            <span
              class="shrink-0 rounded-full bg-error/15 px-1.5 text-xs font-medium text-error tabular-nums"
            >
              {blockedCount} needs you
            </span>
          {/if}
          <Button
            variant="ghost"
            size="icon-xs"
            class="shrink-0 {isPinned ? '' : 'opacity-60'} hover:opacity-100"
            aria-pressed={isPinned}
            onclick={() => rail.togglePin('machine', machine.machineId)}
            title={isPinned ? 'Unpin machine' : 'Pin machine'}
            aria-label="{isPinned ? 'Unpin' : 'Pin'} {machineLabel(machine.hostname)}"
          >
            {#if isPinned}
              <IconPinFilled />
            {:else}
              <IconPin />
            {/if}
          </Button>
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
          <Button
            variant="ghost"
            size="icon-xs"
            class="shrink-0 opacity-60 hover:opacity-100"
            onclick={() => (loginTarget = machine)}
            title="Log in this machine"
            aria-label="Log in {machineLabel(machine.hostname)}"
          >
            <IconKey />
          </Button>
        </header>
      </MachineMenu>

      <Collapsible.Content>
        <div class="ml-4 pl-1">
          {@render sessionList(shownLive, 'Live')}
          {@render sessionList(shownStopped, 'Not running')}

          {#if stored.length > 0}
            <Sidebar.GroupLabel
              class="h-auto px-2 pt-3 pb-1 text-[13px] font-medium text-muted-foreground"
              title="Sessions stored on this machine"
            >
              Recent sessions
            </Sidebar.GroupLabel>
            <Sidebar.Menu>
              {#each stored.slice(0, RECENT) as info (info.sessionId)}
                <Sidebar.MenuItem class={ITEM}>
                  {@render storedBody(machine.machineId, info)}
                </Sidebar.MenuItem>
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
                      <Sidebar.MenuItem class={ITEM}>
                        {@render storedBody(machine.machineId, info)}
                      </Sidebar.MenuItem>
                    {/each}
                  </Sidebar.Menu>
                </Collapsible.Content>
                <Collapsible.Trigger
                  class="flex h-7 items-center rounded-lg px-2 py-1 text-left text-xs font-medium
                         text-muted-foreground transition-colors hover:bg-sidebar-accent
                         focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {expanded ? 'Show fewer' : `Show all ${stored.length}`}
                </Collapsible.Trigger>
              </Collapsible.Root>
            {/if}
          {/if}

          {#if shownLive.length === 0 && shownStopped.length === 0 && stored.length === 0}
            <p class="px-2 py-1.5 text-[13px] text-muted-foreground">No sessions.</p>
          {/if}
        </div>
      </Collapsible.Content>
    </Collapsible.Root>
  </Sidebar.Group>
{/snippet}

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<Sidebar.Root
  collapsible="none"
  role="navigation"
  aria-label="Machines and sessions"
  class="h-full"
  bind:ref={railEl}
  onkeydown={rovingKeydown}
>
  <!-- No spawn button here: the board's header owns the primary one and every
       group card has its own "+". A second pill in the rail was the same verb
       said twice. -->
  <Sidebar.Header class="p-3">
    <Sidebar.Menu>
      <Sidebar.MenuItem class={ITEM}>
        {@const current = page.url.pathname === '/tools'}
        <Sidebar.MenuButton isActive={current} class={ROW}>
          {#snippet child({ props })}
            <a {...props} href="/tools" aria-current={current ? 'page' : undefined} data-rail-row>
              <IconTools class="size-4 shrink-0 text-muted-foreground" />
              <span>Tools</span>
            </a>
          {/snippet}
        </Sidebar.MenuButton>
      </Sidebar.MenuItem>
    </Sidebar.Menu>
  </Sidebar.Header>

  <Sidebar.Content>
    {#if pinned.length > 0}
      <Sidebar.Group class="py-0">
        <Sidebar.GroupLabel class="gap-1.5 px-2 text-[13px] font-medium text-muted-foreground">
          <IconPinList class="size-3.5" />
          Pinned
        </Sidebar.GroupLabel>
        <ul
          class="flex w-full min-w-0 flex-col gap-0.5"
          aria-label="Pinned"
          use:dndzone={{
            items: pinned,
            type: 'rail-pinned',
            flipDurationMs: rail.flipDurationMs,
            dropTargetStyle: {},
            delayTouchStart: TOUCH_DRAG_DELAY_MS,
          }}
          onconsider={considerPins}
          onfinalize={finalizePins}
        >
          {#each pinned as item (item.id)}
            <li
              class="group/menu-item relative {ITEM}"
              animate:flip={{ duration: rail.flipDurationMs }}
            >
              {#if item.kind === 'machine'}
                {@render machineGroup(item.machine)}
              {:else if item.kind === 'project'}
                {@render projectBody(item.project)}
              {:else if item.kind === 'session'}
                {@render sessionBody(item.instance)}
              {:else}
                {@render storedBody(item.machineId, item.info)}
              {/if}
            </li>
          {/each}
        </ul>
      </Sidebar.Group>
    {/if}

    {#if projects.length > 0}
      <Sidebar.Group class="py-0">
        <Sidebar.GroupLabel class="px-2 text-[13px] font-medium text-muted-foreground">
          Projects
        </Sidebar.GroupLabel>
        <Sidebar.Menu>
          {#each projects as project (project.id)}
            <Sidebar.MenuItem class={ITEM}>
              {@render projectBody(project)}
            </Sidebar.MenuItem>
          {/each}
        </Sidebar.Menu>
      </Sidebar.Group>
    {/if}

    {#if sideQuests.length > 0}
      <Sidebar.Group class="py-0">
        <Sidebar.GroupLabel class="gap-1.5 px-2 text-[13px] font-medium text-muted-foreground">
          <IconSparklesDuo class="size-3.5" />
          Side quests
        </Sidebar.GroupLabel>
        <Sidebar.Menu>
          {#each sideQuests as instance (instance.id)}
            <Sidebar.MenuItem class={ITEM}>
              {@render sessionBody(instance)}
            </Sidebar.MenuItem>
          {/each}
        </Sidebar.Menu>
      </Sidebar.Group>
    {/if}

    {#if machines.length > 0}
      <Sidebar.GroupLabel class="px-2 text-[13px] font-medium text-muted-foreground">
        Machines
      </Sidebar.GroupLabel>
      <div
        class="flex w-full min-w-0 flex-col gap-1"
        aria-label="Machines"
        use:dndzone={{
          items: machines,
          type: 'rail-machines',
          flipDurationMs: rail.flipDurationMs,
          dropTargetStyle: {},
          delayTouchStart: TOUCH_DRAG_DELAY_MS,
        }}
        onconsider={considerMachines}
        onfinalize={finalizeMachines}
      >
        {#each machines as item (item.id)}
          <div class="rounded-lg" animate:flip={{ duration: rail.flipDurationMs }}>
            {@render machineGroup(item.machine)}
          </div>
        {/each}
      </div>
    {/if}

    {#if cockpit.machines.length === 0}
      <div class="px-4 py-6 text-center">
        <p class="text-[14px] text-muted-foreground">
          No machines connected yet.
        </p>
        <a href="/session" class="mt-1 inline-block text-[13px] text-primary hover:underline">
          How to connect one
        </a>
      </div>
    {/if}
  </Sidebar.Content>
</Sidebar.Root>

{#if loginTarget}
  <MachineLogin
    machine={loginTarget}
    bind:open={() => loginTarget !== null, (next) => { if (!next) loginTarget = null; }}
  />
{/if}
