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

  /**
   * Which sessions are showing the subagents they have out. Not persisted:
   * subagents are the shortest-lived thing the rail draws, and an expansion
   * restored onto work that finished hours ago is noise, not memory.
   */
  const unfolded = $state<Record<string, boolean>>({});

  const toggleSubagents = (instanceId: string): void => {
    unfolded[instanceId] = !unfolded[instanceId];
  };

  /** How a branch's state reads as a colour, worst-first so trouble is visible. */
  const BRANCH_DOT: Record<string, string> = {
    error: 'bg-destructive',
    running: 'bg-success',
    starting: 'bg-warning',
    complete: 'bg-muted-foreground/40',
  };
</script>

<script lang="ts">
  /**
   * Machines → sessions, the peer model (NEW.md §1): a machine's live instances
   * and its stored sessions read the same whether it is this box or another one.
   * Above all of it sits whatever the reader pinned, in the order they put it.
   */
  import { page } from '$app/state';
  import { flip } from 'svelte/animate';
  import { slide } from 'svelte/transition';
  import { quintOut } from 'svelte/easing';
  import { dndzone, type DndEvent } from 'svelte-dnd-action';

  /**
   * How long a finger has to stay down before it is rearranging rather than
   * tapping. Long enough that opening a session never picks it up, short enough
   * that deliberately reordering does not feel stuck — iOS uses ~500ms for its
   * own long press. Well past the 500ms that opens a context menu — measured: a
   * drag starting while the menu is up tears the row out from under it and the
   * menu dies with it. At 1.2s only a deliberate keep-holding is a rearrange.
   */
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
    IconPlus,
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

  /** Enough of a machine's catalog to recognise it by; the rest is behind a click. */
  const RECENT = 6;

  /** One row's geometry — dense, one line, nothing wraps. */
  const ROW = 'min-h-7 gap-2 px-1.5 py-1 text-[13px]';
  /** The two-line variant: a name over the path it lives at. */
  const STACK = 'h-auto items-start gap-2 px-1.5 py-1';
  /** The name line, and the path line under it. */
  const NAME = 'truncate text-[13px] leading-5';
  const PATH = 'truncate font-mono text-xs leading-4 opacity-70';
  /** A row's outer list item; rounded so a keyboard drag's focus ring fits it. */
  const ITEM = 'rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none';

  /**
   * A pin resolved back to the thing it points at, ready for the rail to draw.
   * `id` is what the drag library keys on, so it spells out the kind: two rows
   * of different kinds may well share a uuid.
   */
  type RailItem = { id: string; pin: Pin } & (
    | { kind: 'machine'; machine: Machine }
    | { kind: 'project'; project: ProjectRow }
    | { kind: 'session'; instance: InstanceRow }
    | { kind: 'stored'; machineId: string; info: SDKSessionInfo }
  );

  /** A machine as the machines zone drags it around. */
  type MachineItem = { id: string; machine: Machine };

  /** A pin nobody can resolve any more is simply not drawn. */
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

  // While a drag is in flight the library owns the order; these hold what it is
  // proposing, and go back to null once it has said where the item landed.
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
    // A machine hidden from this zone because it is pinned still has a place in
    // the order, waiting for the day it is unpinned.
    const hidden = rail.machineOrder.filter((id) => !shown.includes(id));
    rail.setMachineOrder([...shown, ...hidden]);
  }

  /**
   * The side quests started from a session, which is the session working in the
   * same directory on the same machine. They belong under it: a quest is a
   * detour from a piece of work, and listing it somewhere else makes the reader
   * hold the connection in their head.
   */
  /**
   * The session a quest belongs under, or `null` when that cannot be told.
   *
   * Grouping is by directory, and a directory does not name one session: two
   * sessions in the same repository are normal. Nesting a quest under every
   * candidate draws it once per parent — the same quest appearing twice in the
   * rail — and picking one arbitrarily files it under a session it may have
   * nothing to do with. So it nests only when exactly one session could own it,
   * and otherwise keeps a place of its own where it can at least be found.
   */
  const parentOf = (quest: InstanceRow): InstanceRow | null => {
    const candidates = cockpit.listedInstances.filter(
      (row) =>
        row.kind !== 'scratch' && row.machineId === quest.machineId && row.cwd === quest.cwd
    );
    return candidates.length === 1 ? candidates[0] : null;
  };

  const questsUnder = (instance: InstanceRow): InstanceRow[] =>
    // A quest never nests under a quest: it shares its parent's directory, so it
    // matches itself, and the row snippet renders children by calling itself.
    instance.kind === 'scratch'
      ? []
      : cockpit.scratchInstances.filter((quest) => parentOf(quest)?.id === instance.id);

  /** A quest whose parent is not on the rail has nowhere to nest, so it keeps the old section. */
  /**
   * A quest with nowhere unambiguous to nest keeps the section of its own —
   * the exact complement of {@link parentOf}, so every quest is drawn once and
   * only once, whether that is under a parent or here.
   */
  const orphanQuest = (quest: InstanceRow): boolean => parentOf(quest) === null;

  /** The machine whose login dialog is open from a tap; null when closed. */
  let loginTarget = $state<Machine | null>(null);

  const sideQuests = $derived(cockpit.scratchInstances.filter(unpinned).filter(orphanQuest));
  const projects = $derived(
    cockpit.projects.filter((project) => !rail.isPinned('project', project.id))
  );

  /** Machines whose catalog is shown past `RECENT` — a glance, not a preference. */
  let showAll = $state<Record<string, boolean>>({});

  // Row transitions animate live comings and goings, not the initial WS backfill:
  // data lands right after mount, and a rail that assembles itself on every page
  // load reads as noise. Zero-duration until the first snapshot has painted.
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

  /**
   * What a grouped row is called once the directory name has moved up to the
   * group header: the stored catalog's title for the same session, when the
   * catalog has it. Null keeps the directory leaf, which at least never lies.
   */
  const titleOf = (instance: InstanceRow): string | null => {
    if (!instance.sessionId) return null;
    const info = cockpit
      .catalogOf(instance.machineId)
      .find((row) => row.sessionId === instance.sessionId);
    return info ? sessionTitle(info) : null;
  };
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
      <a {...props} href="/project/{project.id}" aria-current={current ? 'page' : undefined}>
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
          in:slide={rowIn}
          out:slide={rowOut}
        >
          <IconHistoryDuo class="mt-0.5 size-4 shrink-0 opacity-70" />
          <span class="flex min-w-0 flex-1 flex-col">
            <span class="flex items-baseline gap-2">
              <span class={NAME}>{sessionTitle(info)}</span>
              <span class="ml-auto shrink-0 text-xs opacity-60 tabular-nums">
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

<!-- A live session and a side quest are the same row; the quest says so itself,
     with the dashed edge it is kept apart by and a mark of its own. -->
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
      class="{ROW} {quest ? 'border border-dashed border-muted-foreground/30' : ''} {!current && warn
        ? 'bg-warning/10 text-warning'
        : ''}"
    >
      {#snippet child({ props })}
        <a
          {...props}
          href="/session/{instance.id}"
          aria-current={current ? 'page' : undefined}
          title={sleeping ? SLEEPING_HINT : undefined}
          in:slide={rowIn}
          out:slide={rowOut}
        >
          {#if failed}
            <span class="size-1.5 shrink-0 rounded-full bg-warning"></span>
          {:else if sleeping}
            <span class="size-1.5 shrink-0 rounded-full bg-muted-foreground/40"></span>
          {:else}
            <ActivityDot {activity} size={1.5} />
          {/if}
          {#if quest}
            <IconSparklesDuo class="size-3.5 shrink-0" />
          {/if}
          {#if title}
            <span class="truncate">{title}</span>
          {:else}
            <span class="truncate font-mono">{leaf(instance.cwd)}</span>
          {/if}
          {#if handed}
            <!-- Handed work it has not answered yet. A hand-off is queued
                 deliberately — it does not interrupt — so without this the rail
                 shows an idle session that is in fact carrying something, and
                 the sender has no way to know it arrived without opening it. -->
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
            <!-- Not the status word's job: "Working" says the session is busy,
                 this says how much of that is happening somewhere else. -->
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
              : 'opacity-70'}"
          >
            {failed ? 'Failed' : sleeping ? SLEEPING_LABEL : ACTIVITY_LABEL[activity]}
          </span>
        </a>
      {/snippet}
    </Sidebar.MenuButton>
  </LiveSessionMenu>
  {@render pinToggle('session', instance.id, leaf(instance.cwd))}

  {#each questsUnder(instance) as quest (quest.id)}
    <!-- Indented under its parent rather than filed elsewhere: the quest and
         the session it came from are one piece of work with a detour in it. -->
    <div class="pl-4">
      {@render sessionBody(quest)}
    </div>
  {/each}

  {#if branches.length > 0}
    {@const showing = unfolded[instance.id] ?? false}
    <button
      type="button"
      class="flex w-full items-center gap-1 rounded-md py-0.5 pr-1.5 pl-6 text-xs
             text-muted-foreground transition-colors duration-150 ease-out
             hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      aria-expanded={showing}
      onclick={() => toggleSubagents(instance.id)}
    >
      <IconChevronRight
        class="size-3 shrink-0 transition-transform duration-200 ease-out {showing
          ? 'rotate-90'
          : ''}"
      />
      <span>
        {branches.length} subagent{branches.length === 1 ? '' : 's'}
      </span>
    </button>

    {#if showing}
      <ul class="flex flex-col gap-0.5 pl-6" transition:slide={rowIn}>
        {#each branches as branch (branch.toolUseId)}
          <li>
            <!-- The rail says which and how they are doing; the transcript is
                 read in the session, where a subagent's turns have room. -->
            <a
              href="/session/{instance.id}#subagent-{branch.toolUseId}"
              class="flex items-start gap-1.5 rounded-md px-1.5 py-1 text-xs
                     text-muted-foreground transition-colors duration-150 ease-out
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
                  <span class="block truncate opacity-70">{branch.summary}</span>
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
    <Sidebar.GroupLabel class="h-auto px-1.5 pt-2 pb-0.5">{heading}</Sidebar.GroupLabel>
    <Sidebar.Menu>
      {#each groupByCwd(instances) as entry (isCwdGroup(entry) ? `dir:${entry.cwd}` : entry.id)}
        {#if isCwdGroup(entry)}
          <!-- Same directory, several sessions: the directory is said once,
               and each row gets to say what it is instead. -->
          <Sidebar.GroupLabel class="h-auto gap-1.5 px-1.5 pt-1.5 pb-0.5" title={entry.cwd}>
            <IconFolderDuo class="size-3.5 shrink-0" />
            <span class="truncate font-mono text-xs font-medium">
              {leaf(entry.cwd)}
            </span>
            <span class="shrink-0 text-xs tabular-nums opacity-70">
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
                <os.Icon class="size-4 shrink-0 text-muted-foreground" />
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
          <!-- A tap target, not only a context-menu item: the menu needs a
               right-click, and a phone has none — which left login unreachable
               on the device most likely to be away from the machine. -->
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
        <div class="ml-4 border-l border-border/60 pl-1">
          {@render sessionList(shownLive, 'Live')}
          {@render sessionList(shownStopped, 'Not running')}

          {#if stored.length > 0}
            <Sidebar.GroupLabel
              class="h-auto px-1.5 pt-2 pb-0.5"
              title="Claude Code sessions stored on this machine — any directory"
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
                  class="flex min-h-6 items-center px-1.5 py-1 text-left text-xs font-medium text-muted-foreground transition-colors  focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {expanded ? 'Show fewer' : `Show all ${stored.length}`}
                </Collapsible.Trigger>
              </Collapsible.Root>
            {/if}
          {/if}

          {#if shownLive.length === 0 && shownStopped.length === 0 && stored.length === 0}
            <p class="px-1.5 py-1 text-xs opacity-70">No sessions.</p>
          {/if}
        </div>
      </Collapsible.Content>
    </Collapsible.Root>
  </Sidebar.Group>
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
    <Sidebar.Menu>
      <Sidebar.MenuItem class={ITEM}>
        <!-- By path alone: the tools page carries its tab in a search param,
             and every tab of it is still this entry. -->
        {@const current = page.url.pathname === '/tools'}
        <Sidebar.MenuButton isActive={current} class={ROW}>
          {#snippet child({ props })}
            <a {...props} href="/tools" aria-current={current ? 'page' : undefined}>
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
        <Sidebar.GroupLabel class="gap-1.5 px-2">
          <IconPinList class="size-3.5" />
          Pinned
        </Sidebar.GroupLabel>
        <!-- Order here is the reader's own statement of priority, so it is the
             one list in the rail they get to arrange. -->
        <ul
          class="flex w-full min-w-0 flex-col gap-1"
          aria-label="Pinned"
          use:dndzone={{
            items: pinned,
            type: 'rail-pinned',
            flipDurationMs: rail.flipDurationMs,
            dropTargetStyle: {},
            // Without this a tap *is* a drag: the library's default starts one
            // on touchstart, so opening a session on a phone picks the row up
            // instead. A press has to outlast a tap before it becomes a drag.
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
        <Sidebar.GroupLabel class="px-2">Projects</Sidebar.GroupLabel>
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
        <Sidebar.GroupLabel class="px-2">Side quests</Sidebar.GroupLabel>
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
      <Sidebar.GroupLabel class="px-4">Machines</Sidebar.GroupLabel>
      <div
        class="flex w-full min-w-0 flex-col gap-2"
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
          <div class="rounded-md" animate:flip={{ duration: rail.flipDurationMs }}>
            {@render machineGroup(item.machine)}
          </div>
        {/each}
      </div>
    {/if}

    {#if cockpit.machines.length === 0}
      <p class="px-4 py-2 text-[13px] text-muted-foreground">
        No machines connected.
        <a href="/session" class="underline transition-colors "> How to connect one </a>
      </p>
    {/if}
  </Sidebar.Content>
</Sidebar.Root>

{#if loginTarget}
  <MachineLogin
    machine={loginTarget}
    bind:open={() => loginTarget !== null, (next) => { if (!next) loginTarget = null; }}
  />
{/if}
