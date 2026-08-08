<script module lang="ts">
  /**
   * Which sessions are showing the subagents they have out. Not persisted:
   * subagents are the shortest-lived thing the rail draws, and an expansion
   * restored onto work that finished hours ago is noise, not memory.
   */
  const unfolded = $state<Record<string, boolean>>({});

  const toggleSubagents = (instanceId: string, open = !unfolded[instanceId]): void => {
    unfolded[instanceId] = open;
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
   * Sessions first; machines are peers (PRODUCT.md §Operating Context). Every
   * session the fleet is running is one flat list, whatever box it runs on, with
   * the machine said on the row rather than drawn as a tree the reader has to
   * walk to reach their work. What is waiting on a human is lifted out of that
   * list and sits above it; the machines themselves are a strip at the foot that
   * says which boxes there are. History is not here at all — ⌘K and the board
   * both answer "what was I doing yesterday", and the rail answers "now".
   */
  import { page } from '$app/state';
  import { flip } from 'svelte/animate';
  import { slide } from 'svelte/transition';
  import { quintOut } from 'svelte/easing';
  import { dndzone, type DndEvent } from 'svelte-dnd-action';

  const TOUCH_DRAG_DELAY_MS = 1200;
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import * as Sidebar from '$lib/components/ui/sidebar';
  import {
    IconChevronRight,
    IconFolderDuo,
    IconPinFilled,
    IconPlus,
    IconSparklesDuo,
    IconSubagentsDuo,
    IconTools,
  } from '$lib/icons';
  import { SLEEPING_HINT, SLEEPING_LABEL } from './activity';
  import ActivityDot from './ActivityDot.svelte';
  import {
    cockpit,
    isFailed,
    isResumable,
    type InstanceRow,
    type Machine,
    type ProjectRow,
  } from './client.svelte';
  import LiveSessionMenu from './LiveSessionMenu.svelte';
  import MachineMenu from './MachineMenu.svelte';
  import SpawnPanel from './SpawnPanel.svelte';
  import { sessionTitle } from './links';
  import { machineLabel, machineOs, signInWarning } from './machine';
  import { orderMachines, rail, type PinKind } from './rail.svelte';

  /** 32px row, one line, the same slots wherever the rail draws one. */
  const ROW = 'h-8 gap-2 rounded-lg px-2 text-[13px]';
  const LABEL = 'h-7 gap-1.5 px-2 text-micro font-medium text-muted-foreground';
  const ITEM = 'rounded-lg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none';
  /**
   * The leading slot every row shares — a 16px glyph, or a 6px dot centred in
   * the same space, so titles line up down the whole rail whatever leads them.
   */
  const LEAD = 'flex w-4 shrink-0 items-center justify-center';
  /** Everything to the right of a title, in one cluster at the far edge. */
  const TAIL = 'ml-auto flex shrink-0 items-center gap-1.5';
  const META = 'shrink-0 text-micro text-muted-foreground';
  /** Sections are separated by a seam, never by a gap or a box. */
  const SECTION = 'border-t border-border/50 px-2 py-2';

  const isCurrent = (href: string) => page.url.pathname === href;
  const leaf = (cwd: string) => cwd.split('/').pop() || cwd;

  /**
   * What a session is about: the SDK's own title for the transcript it is
   * writing. A side quest is tagged out of the catalog and a session that has
   * not spoken yet is not in it either, so both fall back to where they run —
   * and a path is data, so it says so by being set in mono.
   */
  const titleOf = (instance: InstanceRow): { text: string; path: boolean } => {
    const info = instance.sessionId
      ? cockpit.catalogOf(instance.machineId).find((row) => row.sessionId === instance.sessionId)
      : undefined;
    return info
      ? { text: sessionTitle(info), path: false }
      : { text: leaf(instance.cwd), path: true };
  };

  const nameOf = (machineId: string): string => {
    const machine = cockpit.machines.find((row) => row.machineId === machineId);
    return machine ? machineLabel(machine.hostname) : machineId;
  };

  /** With one box the chip says nothing; with two it is what tells rows apart. */
  const manyMachines = $derived(cockpit.machines.length > 1);

  /**
   * A pin no longer owns a section of its own — a heterogeneous bag at the top
   * of the rail was competing with the queue of what actually needs answering.
   * It floats its row to the head of the section it already belongs to instead.
   */
  const pinnedFirst =
    (kind: PinKind) =>
    (a: { id: string }, b: { id: string }): number =>
      Number(rail.isPinned(kind, b.id)) - Number(rail.isPinned(kind, a.id));

  /**
   * Every session in the fleet, in one list. Ordered by machine so a box's work
   * stays together, but never grouped under one: locality is a fact about a
   * session, not a level of the hierarchy.
   */
  const sessions = $derived.by(() => {
    const order = new Map(
      orderMachines(cockpit.machines).map((machine, at) => [machine.machineId, at])
    );
    return [...cockpit.listedInstances]
      .filter((row) => !isFailed(row))
      .sort(
        (a, b) =>
          pinnedFirst('session')(a, b) ||
          (order.get(a.machineId) ?? 0) - (order.get(b.machineId) ?? 0)
      );
  });

  /**
   * The only red in the rail: a session parked on a permission, and one that
   * died of something. One row per session — six requests parked on the same
   * session is still one session to open.
   */
  const needsYou = $derived.by(() => {
    const rows: { instance: InstanceRow; failed: boolean }[] = [];
    const seen = new Set<string>();
    for (const request of cockpit.blocked) {
      const instance = cockpit.instances.find((row) => row.id === request.instanceId);
      if (!instance || seen.has(instance.id)) continue;
      seen.add(instance.id);
      rows.push({ instance, failed: false });
    }
    for (const instance of cockpit.failedInstances) {
      if (seen.has(instance.id)) continue;
      seen.add(instance.id);
      rows.push({ instance, failed: true });
    }
    return rows;
  });

  const projects = $derived([...cockpit.projects].sort(pinnedFirst('project')));

  type MachineItem = { id: string; machine: Machine };

  const machineItems = $derived(
    orderMachines(cockpit.machines).map((machine) => ({ id: machine.machineId, machine }))
  );

  let machineDrag = $state<MachineItem[] | null>(null);
  const machines = $derived(machineDrag ?? machineItems);

  function considerMachines(event: CustomEvent<DndEvent<MachineItem>>): void {
    machineDrag = event.detail.items;
  }

  function finalizeMachines(event: CustomEvent<DndEvent<MachineItem>>): void {
    machineDrag = null;
    const shown = event.detail.items.map((item) => item.machine.machineId);
    const hidden = rail.machineOrder.filter((id) => !shown.includes(id));
    rail.setMachineOrder([...shown, ...hidden]);
  }

  /** "Spawn here" from a project row — the board's own panel, prefilled. */
  let spawnFor = $state<{ machineId: string; cwd: string; projectId: string } | null>(null);

  let settled = $state(false);
  $effect(() => {
    if (cockpit.machines.length > 0 && !settled) {
      requestAnimationFrame(() => (settled = true));
    }
  });
  const rowIn = $derived({ duration: settled ? 240 : 0, easing: quintOut });
  const rowOut = $derived({ duration: settled ? 160 : 0, easing: quintOut });

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
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      // The only thing a row still folds open is the subagents it has out.
      const instanceId = focused?.dataset.subagents;
      if (!instanceId) return;
      event.preventDefault();
      toggleSubagents(instanceId, event.key === 'ArrowRight');
    }
  }
</script>

{#snippet machineChip(machineId: string)}
  {#if manyMachines}
    <!-- One fixed width, so the machines read as a column rather than as a
         ragged edge that moves with every title. The ellipsis has to live on a
         child: a flex box does not truncate its own text, it just clips it. -->
    <Badge
      variant="secondary"
      class="h-5 w-28 shrink-0 justify-start px-1.5 text-micro font-normal"
    >
      <span class="min-w-0 truncate">{nameOf(machineId)}</span>
    </Badge>
  {/if}
{/snippet}

{#snippet alertRow(instance: InstanceRow, failed: boolean)}
  {@const current = isCurrent(`/session/${instance.id}`)}
  {@const name = titleOf(instance)}
  <Sidebar.MenuButton isActive={current} class={ROW}>
    {#snippet child({ props })}
      <a
        {...props}
        href="/session/{instance.id}"
        aria-current={current ? 'page' : undefined}
        title={failed ? (instance.lastError ?? 'Failed') : 'Waiting on you'}
        data-rail-row
        in:slide={rowIn}
        out:slide={rowOut}
      >
        <span class={LEAD}>
          {#if failed}
            <span class="size-1.5 rounded-full bg-error"></span>
          {:else}
            <ActivityDot activity="blocked" size={1.5} />
          {/if}
        </span>
        <span class="min-w-0 truncate {name.path ? 'font-mono' : ''}">{name.text}</span>
        <span class={TAIL}>
          {#if failed}
            <span class="text-micro font-medium text-error">Failed</span>
          {/if}
          {@render machineChip(instance.machineId)}
        </span>
      </a>
    {/snippet}
  </Sidebar.MenuButton>
{/snippet}

{#snippet sessionRow(instance: InstanceRow)}
  {@const activity = cockpit.activityOf(instance.id)}
  {@const branches = cockpit.subagentsOf(instance.id)}
  {@const delegated = cockpit.runningSubagentsOf(instance.id)}
  {@const handoff = cockpit.handoffFor(instance.id)}
  {@const handedFrom = handoff
    ? (cockpit.instances.find((row) => row.id === handoff.from)?.cwd.split('/').filter(Boolean).pop() ??
      'another session')
    : ''}
  {@const sleeping = isResumable(instance)}
  {@const quest = instance.kind === 'scratch'}
  {@const current = isCurrent(`/session/${instance.id}`)}
  {@const showing = unfolded[instance.id] ?? false}
  {@const name = titleOf(instance)}
  <LiveSessionMenu {instance}>
    <Sidebar.MenuButton isActive={current} class={ROW}>
      {#snippet child({ props })}
        <a
          {...props}
          href="/session/{instance.id}"
          aria-current={current ? 'page' : undefined}
          title={sleeping ? SLEEPING_HINT : name.text}
          data-rail-row
          data-subagents={branches.length > 0 ? instance.id : undefined}
          in:slide={rowIn}
          out:slide={rowOut}
        >
          <span class={LEAD}>
            {#if sleeping}
              <span
                class="size-1.5 rounded-full bg-muted-foreground/40"
                title={SLEEPING_LABEL}
              ></span>
            {:else}
              <ActivityDot {activity} size={1.5} />
            {/if}
          </span>
          <span
            class="min-w-0 truncate {name.path ? 'font-mono' : ''} {sleeping
              ? 'text-muted-foreground'
              : ''}"
          >
            {name.text}
          </span>
          <!-- A quest is marked beside its name rather than in front of it: the
               leading slot belongs to state, and the titles stay in one column. -->
          {#if quest}
            <IconSparklesDuo class="size-3.5 shrink-0 text-muted-foreground" />
          {/if}
          <span class={TAIL}>
            {#if handoff}
              <span
                class="flex items-center gap-1 rounded-full bg-primary/15 px-1.5 text-micro
                       font-medium text-primary"
                title="Handed work from {handedFrom} — waiting for this session's next turn"
              >
                <IconSubagentsDuo class="size-3" />
                handed
              </span>
            {/if}
            {#if delegated > 0}
              <span
                class="flex items-center gap-0.5 rounded-full bg-success/15 px-1.5 text-micro
                       font-medium text-success"
                title="{delegated} subagent{delegated === 1 ? '' : 's'} running"
                data-tabular
              >
                <IconSubagentsDuo class="size-3" />
                {delegated}
              </span>
            {/if}
            {#if rail.isPinned('session', instance.id)}
              <IconPinFilled class="size-3 text-muted-foreground/60" />
            {/if}
            {@render machineChip(instance.machineId)}
          </span>
        </a>
      {/snippet}
    </Sidebar.MenuButton>
  </LiveSessionMenu>

  {#if branches.length > 0}
    <button
      type="button"
      class="flex h-7 w-full items-center gap-1.5 rounded-lg pr-2 pl-8 text-micro
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
      <ul class="flex flex-col gap-0.5 pl-8" transition:slide={rowIn}>
        {#each branches as branch (branch.toolUseId)}
          <li>
            <a
              href="/session/{instance.id}#subagent-{branch.toolUseId}"
              class="flex items-start gap-1.5 rounded-lg px-2 py-1 text-micro
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

{#snippet projectRow(project: ProjectRow)}
  {@const current = isCurrent(`/project/${project.id}`)}
  {@const live = cockpit.liveIn(project).length}
  <Sidebar.MenuButton isActive={current} class="{ROW} pr-9">
    {#snippet child({ props })}
      <a
        {...props}
        href="/project/{project.id}"
        aria-current={current ? 'page' : undefined}
        title={project.cwd}
        data-rail-row
      >
        <span class={LEAD}>
          <IconFolderDuo class="size-4 text-muted-foreground" />
        </span>
        <span class="min-w-0 truncate">{project.name}</span>
        <span class={TAIL}>
          {#if rail.isPinned('project', project.id)}
            <IconPinFilled class="size-3 text-muted-foreground/60" />
          {/if}
          {#if live > 0}
            <span class={META} data-tabular>{live}</span>
          {/if}
        </span>
      </a>
    {/snippet}
  </Sidebar.MenuButton>
  <!-- Reserved by `pr-9` above, so nothing shifts when it fades in. A phone has
       no hover to reveal it with, so there it simply stays. -->
  <Button
    variant="ghost"
    size="icon-sm"
    class="absolute top-0 right-0 transition-opacity duration-150 md:opacity-0
           md:group-focus-within/menu-item:opacity-100 md:group-hover/menu-item:opacity-100
           md:focus-visible:opacity-100"
    title="New session in {project.name}"
    aria-label="New session in {project.name}"
    onclick={() =>
      (spawnFor = { machineId: project.machineId, cwd: project.cwd, projectId: project.id })}
  >
    <IconPlus />
  </Button>
{/snippet}

{#snippet machineRow(machine: Machine)}
  {@const os = machineOs(machine.os)}
  {@const needsSignIn = signInWarning(machine)}
  {@const online = machine.status === 'online'}
  <MachineMenu {machine}>
    <div
      class="{ROW} flex items-center"
      title="{machine.hostname} · {machine.os}"
      data-rail-row
      tabindex="-1"
    >
      <span class={LEAD}>
        <os.Icon class="size-4 text-muted-foreground" />
      </span>
      <span class="min-w-0 truncate {online ? '' : 'text-muted-foreground'}">
        {machineLabel(machine.hostname)}
      </span>
      <span class={TAIL}>
        {#if needsSignIn}
          <span
            class="rounded-full bg-warning/15 px-1.5 text-micro font-medium text-warning"
            title={needsSignIn}
          >
            Needs sign-in
          </span>
        {/if}
        <span
          class="size-1.5 rounded-full {!online
            ? 'bg-muted-foreground/40'
            : needsSignIn
              ? 'bg-warning'
              : 'bg-success'}"
          title={!online ? 'Offline' : needsSignIn ? 'Online, but not signed in' : 'Online'}
        ></span>
      </span>
    </div>
  </MachineMenu>
{/snippet}

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<Sidebar.Root
  collapsible="none"
  role="navigation"
  aria-label="Sessions, projects and machines"
  class="h-full"
  bind:ref={railEl}
  onkeydown={rovingKeydown}
>
  <!-- No spawn button here: the board's header owns the primary one, and every
       project row has its own "+". A third pill in the rail was the same verb
       said twice. -->
  <Sidebar.Header class="p-2">
    <Sidebar.Menu>
      <Sidebar.MenuItem class={ITEM}>
        {@const current = page.url.pathname === '/tools'}
        <Sidebar.MenuButton isActive={current} class={ROW}>
          {#snippet child({ props })}
            <a {...props} href="/tools" aria-current={current ? 'page' : undefined} data-rail-row>
              <span class={LEAD}>
                <IconTools class="size-4 text-muted-foreground" />
              </span>
              <span>Tools</span>
            </a>
          {/snippet}
        </Sidebar.MenuButton>
      </Sidebar.MenuItem>
    </Sidebar.Menu>
  </Sidebar.Header>

  <Sidebar.Content class="gap-0">
    {#if needsYou.length > 0}
      <div transition:slide={rowIn}>
        <Sidebar.Group class={SECTION}>
          <Sidebar.GroupLabel class={LABEL}>
            Needs you
            <span
              class="ml-auto rounded-full bg-error/15 px-1.5 font-medium text-error"
              data-tabular
            >
              {needsYou.length}
            </span>
          </Sidebar.GroupLabel>
          <Sidebar.Menu>
            {#each needsYou as row (row.instance.id)}
              <Sidebar.MenuItem class={ITEM}>
                {@render alertRow(row.instance, row.failed)}
              </Sidebar.MenuItem>
            {/each}
          </Sidebar.Menu>
        </Sidebar.Group>
      </div>
    {/if}

    {#if cockpit.machines.length > 0}
      <Sidebar.Group class={SECTION}>
        <Sidebar.GroupLabel class={LABEL}>
          Sessions
          <span class="ml-auto" data-tabular>{sessions.length}</span>
        </Sidebar.GroupLabel>
        {#if sessions.length > 0}
          <Sidebar.Menu>
            {#each sessions as instance (instance.id)}
              <Sidebar.MenuItem class={ITEM}>
                {@render sessionRow(instance)}
              </Sidebar.MenuItem>
            {/each}
          </Sidebar.Menu>
        {:else}
          <p class="px-2 py-1 text-caption">Nothing running.</p>
        {/if}
      </Sidebar.Group>
    {/if}

    {#if projects.length > 0}
      <Sidebar.Group class={SECTION}>
        <Sidebar.GroupLabel class={LABEL}>Projects</Sidebar.GroupLabel>
        <Sidebar.Menu>
          {#each projects as project (project.id)}
            <Sidebar.MenuItem class={ITEM}>
              {@render projectRow(project)}
            </Sidebar.MenuItem>
          {/each}
        </Sidebar.Menu>
      </Sidebar.Group>
    {/if}

    {#if cockpit.machines.length === 0}
      <div class="px-4 py-6 text-center">
        <p class="text-caption">No machines connected yet.</p>
        <a href="/session" class="mt-1 inline-block text-[13px] text-primary hover:underline">
          How to connect one
        </a>
      </div>
    {/if}
  </Sidebar.Content>

  {#if machines.length > 0}
    <Sidebar.Footer class="gap-0 border-t border-border/50 p-2">
      <Sidebar.GroupLabel class={LABEL}>Machines</Sidebar.GroupLabel>
      <div
        class="flex w-full min-w-0 flex-col"
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
            {@render machineRow(item.machine)}
          </div>
        {/each}
      </div>
    </Sidebar.Footer>
  {/if}
</Sidebar.Root>

<SpawnPanel
  open={spawnFor !== null}
  prefill={spawnFor ?? undefined}
  onclose={() => (spawnFor = null)}
/>
