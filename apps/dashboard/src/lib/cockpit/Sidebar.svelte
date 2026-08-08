<script module lang="ts">
  import type { Activity } from './activity';

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

  /** How many finished sessions a folder offers before it asks to be asked. */
  const RECENTS = 3;

  const SHUT_KEY = 'outpost-rail-shut';
  const UNSEEN_KEY = 'outpost-rail-unseen';

  /** A finish stops being news after a day; after that it is just history. */
  const UNSEEN_TTL_MS = 24 * 60 * 60 * 1000;

  const readMap = <T,>(key: string): Record<string, T> => {
    if (typeof localStorage === 'undefined') return {};
    try {
      const stored = JSON.parse(localStorage.getItem(key) ?? '{}') as unknown;
      return stored && typeof stored === 'object' ? (stored as Record<string, T>) : {};
    } catch {
      return {};
    }
  };

  const writeMap = (key: string, map: object): void => {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(key, JSON.stringify(map));
  };

  /**
   * Which folders are shut — the closed ones rather than the open ones, so a
   * directory that starts working while you are away arrives with its work
   * showing rather than hidden behind a chevron nobody knew to press.
   */
  const shut = $state<Record<string, true>>(readMap<true>(SHUT_KEY));

  function setFolder(id: string, open: boolean): void {
    if (open) delete shut[id];
    else shut[id] = true;
    writeMap(SHUT_KEY, shut);
  }

  /** Which folders are showing every recent they have, rather than the first few. */
  const showingAll = $state<Record<string, boolean>>({});

  /**
   * Sessions that finished while you were looking somewhere else, by when they
   * did. A dot cannot say this for itself: by the time you look, the session
   * that ended is simply green, indistinguishable from the one that never ran.
   */
  const unseen = $state<Record<string, number>>(
    Object.fromEntries(
      Object.entries(readMap<number>(UNSEEN_KEY)).filter(
        ([, at]) => typeof at === 'number' && Date.now() - at < UNSEEN_TTL_MS
      )
    )
  );

  /** What each session was last seen doing — the other half of a transition. */
  const seenActivity = new Map<string, Activity>();
</script>

<script lang="ts">
  /**
   * The folder is the key. Not the title — titles are the SDK's summary of a
   * conversation and they change under you — and not the machine, which is a
   * fact about a session rather than a way to find one. So the middle of the
   * rail is one directory hierarchy: a registered project or a bare cwd that
   * has work in it, and under each of them the sessions running there and the
   * last few that ran there. What is waiting on a human is lifted out of that
   * and sits above it; the machines themselves are a strip at the foot that
   * says which boxes there are.
   */
  import { page } from '$app/state';
  import { flip } from 'svelte/animate';
  import { slide } from 'svelte/transition';
  import { quintOut } from 'svelte/easing';
  import { dndzone, type DndEvent } from 'svelte-dnd-action';

  const TOUCH_DRAG_DELAY_MS = 1200;
  import type { SDKSessionInfo } from '@cockpit/core';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import * as Sidebar from '$lib/components/ui/sidebar';
  import {
    IconChevronRight,
    IconPinFilled,
    IconPlus,
    IconSparklesDuo,
    IconSubagentsDuo,
    IconTools,
  } from '$lib/icons';
  import { formatDistanceToNow } from '$lib/utils/time';
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
  import FolderMenu from './FolderMenu.svelte';
  import LiveSessionMenu from './LiveSessionMenu.svelte';
  import MachineMenu from './MachineMenu.svelte';
  import NewProjectPopover from './NewProjectPopover.svelte';
  import OsMark from './OsMark.svelte';
  import SpawnPanel from './SpawnPanel.svelte';
  import StoredSessionMenu from './StoredSessionMenu.svelte';
  import { folderPrefs, identityVar } from './folder-prefs.svelte';
  import { sessionTitle, transcriptHref } from './links';
  import { machineLabel, signInWarning } from './machine';
  import { orderMachines, rail, type PinKind } from './rail.svelte';

  /**
   * 32px row, one line, the same slots wherever the rail draws one. The right
   * inset is the folder header's "+" gutter, taken by every row rather than by
   * that one: a tail that stops 28px short of its neighbour's is the ragged
   * edge, and reserving the gutter once is what puts every tail on one line.
   */
  const ROW = 'h-8 gap-2 rounded-lg pr-9 pl-2 text-[13px]';
  const LABEL = 'h-7 gap-1.5 px-2 text-micro font-medium text-muted-foreground';
  const ITEM = 'rounded-lg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none';
  /**
   * The leading slot every row shares — a 16px glyph, or a 6px dot centred in
   * the same space, so titles line up down the whole rail whatever leads them.
   *
   * A top-level row takes two of them: state or disclosure first, then the
   * folder's mark. A row with no mark leaves the second one empty rather than
   * closing it up, which is what puts a session's title in the same column as
   * the folder headers above and below it — and it is the same 24px a nested
   * row is indented by, so the whole rail runs down one line.
   */
  const LEAD = 'flex w-4 shrink-0 items-center justify-center';
  /** Everything to the right of a title, in one cluster at the far edge. */
  const TAIL = 'ml-auto flex shrink-0 items-center gap-1.5';
  const META = 'shrink-0 text-micro text-muted-foreground';
  /** Sections are separated by a seam, never by a gap or a box. */
  const SECTION = 'border-t border-border/50 px-2 py-2';
  /**
   * What a folder's contents are inset by. One lead slot plus its gap, so a
   * session's dot sits under its folder's glyph and their titles share a
   * column — the indent is the hierarchy, and nothing is boxed to say so.
   */
  const NEST = 'pl-6';

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

  /** Every session the rail lists, before it is filed under a directory. */
  const sessions = $derived(cockpit.listedInstances.filter((row) => !isFailed(row)));

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

  /** One directory the reader keeps work in, and everything it holds. */
  interface Folder {
    id: string;
    name: string;
    /** A bare directory is named by its leaf, and a path is data (Mono-Is-Data). */
    mono: boolean;
    cwd: string;
    machineId: string;
    project: ProjectRow | null;
    pinned: boolean;
    live: InstanceRow[];
    /** What ran here and stopped — the newest first, live ones taken out. */
    stored: SDKSessionInfo[];
    /** Everything in here runs on one box, so the header can say which once. */
    oneMachine: boolean;
    /** Something inside is waiting on a human — what a shut folder inherits. */
    alerting: boolean;
    /** When a transcript here was last written; what orders dormant folders. */
    at: number;
  }

  type FolderSeed = Omit<Folder, 'live' | 'stored' | 'oneMachine' | 'at'>;

  function fill(seed: FolderSeed, live: InstanceRow[], stored: SDKSessionInfo[]): Folder {
    const running = new Set(live.map((row) => row.sessionId));
    const recents = stored
      .filter((info) => !running.has(info.sessionId))
      .sort((a, b) => b.lastModified - a.lastModified);
    // Only the pins move: the hub's own order is stable, and a rail that
    // re-sorts itself under the pointer is one nobody can aim at.
    const rows = [...live].sort(pinnedFirst('session'));
    return {
      ...seed,
      live: rows,
      stored: recents,
      oneMachine: manyMachines && rows.every((row) => row.machineId === seed.machineId),
      at: Math.max(
        0,
        // A project registered today outranks a directory whose last transcript
        // is three weeks old, before anything has ever run in it.
        seed.project ? Date.parse(seed.project.createdAt) || 0 : 0,
        // Counted before the live sessions are taken out, so a folder is dated
        // by the last transcript written in it, running or not.
        ...stored.map((info) => info.lastModified)
      ),
    };
  }

  /**
   * One hierarchy, from two sources that the reader does not distinguish: the
   * projects they registered, and the directories the fleet is simply working
   * in. A project claims everything under its checkout, so a directory only
   * becomes a folder of its own once no project speaks for it.
   */
  const folders = $derived.by(() => {
    const waiting = new Set(needsYou.map((row) => row.instance.id));
    const claimed = new Set<string>();
    const list: Folder[] = [];

    for (const project of cockpit.projects) {
      const members = cockpit.liveIn(project);
      for (const row of members) claimed.add(row.id);
      list.push(
        fill(
          {
            id: project.id,
            name: project.name,
            mono: false,
            cwd: project.cwd,
            machineId: project.machineId,
            project,
            pinned: rail.isPinned('project', project.id),
            alerting: members.some((row) => waiting.has(row.id)),
          },
          members.filter((row) => !isFailed(row)),
          cockpit.storedIn(project)
        )
      );
    }

    const bare = new Map<string, InstanceRow[]>();
    for (const row of sessions) {
      if (claimed.has(row.id)) continue;
      const key = `${row.machineId}:${row.cwd}`;
      const found = bare.get(key);
      if (found) found.push(row);
      else bare.set(key, [row]);
    }

    for (const [id, members] of bare) {
      const [first] = members;
      if (!first) continue;
      list.push(
        fill(
          {
            id,
            name: leaf(first.cwd),
            mono: true,
            cwd: first.cwd,
            machineId: first.machineId,
            project: null,
            pinned: false,
            alerting: members.some((row) => waiting.has(row.id)),
          },
          members,
          cockpit.catalogOf(first.machineId).filter((info) => info.cwd === first.cwd)
        )
      );
    }

    // A folder with work in it is, by definition, the one something happened in
    // most recently; the catalog's timestamps order everything behind that.
    return list.sort(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) ||
        Number(b.live.length > 0) - Number(a.live.length > 0) ||
        b.at - a.at
    );
  });

  /**
   * A directory nobody registered, holding one running session and nothing
   * that has stopped there, is not a hierarchy — the header, the chevron and
   * the indent all say "there is more in here" about a folder with one thing
   * in it. It draws as that session's own row instead.
   */
  const isSolo = (folder: Folder): boolean =>
    !folder.project && folder.live.length === 1 && folder.stored.length === 0;

  /**
   * Whether the rail flattens this directory into plain rows. The rule above
   * is only the default: what the reader said outranks it in both directions,
   * registered or not. A folder with nothing running has no rows to flatten
   * into, so it keeps its header and its preference waits.
   */
  const isFlat = (folder: Folder): boolean => {
    if (folder.live.length === 0) return false;
    const said = folderPrefs.grouping(folder.cwd);
    return said ? said === 'ungrouped' : isSolo(folder);
  };

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

  /** "Spawn here" from a folder header — the board's own panel, prefilled. */
  let spawnFor = $state<{ machineId: string; cwd: string; projectId?: string } | null>(null);

  const spawnHere = (folder: Folder): void => {
    spawnFor = { machineId: folder.machineId, cwd: folder.cwd, projectId: folder.project?.id };
  };

  /** Everything but this one shut — how you get back to one folder at a time. */
  function collapseOthers(id: string): void {
    for (const folder of folders) {
      if (folder.id !== id && !isFlat(folder)) shut[folder.id] = true;
    }
    delete shut[id];
    writeMap(SHUT_KEY, shut);
  }

  let settled = $state(false);
  $effect(() => {
    if (cockpit.machines.length > 0 && !settled) {
      requestAnimationFrame(() => (settled = true));
    }
  });
  const rowIn = $derived({ duration: settled ? 240 : 0, easing: quintOut });
  const rowOut = $derived({ duration: settled ? 160 : 0, easing: quintOut });

  /**
   * A session that stopped working while the reader was elsewhere gets marked,
   * because nothing else on the row can say it: an hour later a session that
   * finished and a session that never started look exactly alike.
   */
  $effect(() => {
    const here = page.url.pathname;
    for (const row of cockpit.listedInstances) {
      const now = cockpit.activityOf(row.id);
      const before = seenActivity.get(row.id);
      seenActivity.set(row.id, now);
      if (before === 'working' && now === 'idle' && here !== `/session/${row.id}`) {
        unseen[row.id] = Date.now();
        writeMap(UNSEEN_KEY, unseen);
      }
    }
  });

  /** Opening it is seeing it, so the mark comes off on arrival. */
  $effect(() => {
    const path = page.url.pathname;
    const id = path.startsWith('/session/') ? path.slice('/session/'.length) : '';
    if (unseen[id] === undefined) return;
    delete unseen[id];
    writeMap(UNSEEN_KEY, unseen);
  });

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
      const open = event.key === 'ArrowRight';
      const folderId = focused?.dataset.folder;
      if (folderId) {
        event.preventDefault();
        setFolder(folderId, open);
        return;
      }
      // The only other thing a row folds open is the subagents it has out.
      const instanceId = focused?.dataset.subagents;
      if (!instanceId) return;
      event.preventDefault();
      toggleSubagents(instanceId, open);
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

{#snippet machineGlyph(machineId: string)}
  {@const machine = cockpit.machines.find((row) => row.machineId === machineId)}
  {#if machine}
    <!-- Said once for the whole folder, where every row would otherwise carry
         the same 112px chip: the box is a property of the directory here. -->
    <span class="flex shrink-0 items-center" title={machineLabel(machine.hostname)}>
      <OsMark os={machine.os} class="size-3.5 text-muted-foreground" />
    </span>
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
        <span class={LEAD}></span>
        <span class="min-w-0 truncate {name.path ? 'font-mono' : ''}">{name.text}</span>
        <span class={TAIL}>
          {#if failed}
            <span class="text-micro font-medium text-error">Failed</span>
          {/if}
          <!-- The glyph, not the 112px name badge: a queue row is a session
               row, and it ends where every other tail ends. -->
          {@render machineGlyph(instance.machineId)}
        </span>
      </a>
    {/snippet}
  </Sidebar.MenuButton>
{/snippet}

{#snippet sessionRow(instance: InstanceRow, chip: boolean, flat: Folder | null)}
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
  <LiveSessionMenu
    {instance}
    ongroup={flat ? () => folderPrefs.setGrouping(flat.cwd, 'grouped') : undefined}
  >
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
          <!-- A session is not a folder, so it wears no folder mark — the slot
               its folder's mark would take is left empty, and the directory it
               stands for is said by the leaf in the tail instead. -->
          {#if flat}
            <span class={LEAD}></span>
          {/if}
          <span
            class="min-w-0 truncate {name.path ? 'font-mono' : ''} {sleeping
              ? 'text-muted-foreground'
              : name.path && flat
                ? 'identity-ink'
                : ''}"
            style={flat && name.path && !sleeping ? identityVar(flat.cwd) : undefined}
          >
            {name.text}
          </span>
          <!-- A glance cue, not an alert: it says only that this one stopped
               while you were elsewhere, and it goes when you open it. -->
          {#if unseen[instance.id] !== undefined}
            <span
              class="size-1.5 shrink-0 rounded-full bg-primary"
              title="Finished while you were away"
            ></span>
          {/if}
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
            <!-- Where it runs, since no header says it any more — and only when
                 the title is not already that same path. It carries the
                 directory's hue, which is the whole of what the folder mark
                 used to say on a row that is not a folder. -->
            {#if flat && !name.path}
              <span
                class="max-w-24 truncate font-mono text-micro {sleeping
                  ? 'text-muted-foreground'
                  : 'identity-ink'}"
                style={sleeping ? undefined : identityVar(flat.cwd)}
                title={flat.cwd}
              >
                {flat.name}
              </span>
            {/if}
            {#if chip}
              {@render machineChip(instance.machineId)}
            {/if}
            {#if flat?.oneMachine}
              {@render machineGlyph(flat.machineId)}
            {/if}
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

{#snippet recentRow(machineId: string, info: SDKSessionInfo)}
  {@const current = isCurrent(`/session/${info.sessionId}`)}
  <StoredSessionMenu {machineId} {info}>
    <!-- The lead slot stays empty rather than shrinking: what a stopped session
         has no state to report, and the titles keep their column. -->
    <Sidebar.MenuButton isActive={current} class="{ROW} text-muted-foreground">
      {#snippet child({ props })}
        <a
          {...props}
          href={transcriptHref(machineId, info)}
          aria-current={current ? 'page' : undefined}
          title={sessionTitle(info)}
          data-rail-row
        >
          <span class={LEAD}></span>
          <span class="min-w-0 truncate">{sessionTitle(info)}</span>
          <span class={TAIL}>
            <span class={META} data-tabular>
              {formatDistanceToNow(new Date(info.lastModified))}
            </span>
          </span>
        </a>
      {/snippet}
    </Sidebar.MenuButton>
  </StoredSessionMenu>
{/snippet}

{#snippet folderGroup(folder: Folder)}
  {@const open = !shut[folder.id]}
  {@const tinted = !open && folder.alerting}
  {@const all = showingAll[folder.id] ?? false}
  {@const recents = all ? folder.stored : folder.stored.slice(0, RECENTS)}
  {@const Mark = folderPrefs.mark(folder.cwd)}
  <FolderMenu
    name={folder.name}
    cwd={folder.cwd}
    project={folder.project}
    onnew={() => spawnHere(folder)}
    onungroup={folder.live.length > 0
      ? () => folderPrefs.setGrouping(folder.cwd, 'ungrouped')
      : undefined}
    oncollapseothers={() => collapseOthers(folder.id)}
  >
    <div class="group/folder relative">
      <Sidebar.MenuButton class={ROW}>
        {#snippet child({ props })}
          <button
            {...props}
            type="button"
            aria-expanded={open}
            title={folder.cwd}
            data-rail-row
            data-folder={folder.id}
            onclick={() => setFolder(folder.id, !open)}
          >
            <span class={LEAD}>
              <IconChevronRight
                class="text-muted-foreground/70 transition-transform duration-240 {open
                  ? 'rotate-90'
                  : ''}"
                style="transition-timing-function: var(--ease-out-expo)"
              />
            </span>
            <!-- The directory's own hue and mark, except while it is shouting:
                 what is waiting on a human outranks what the folder wears. In
                 a slot of its own, so a wider mark cannot push the title out
                 of the column the rows below it keep. -->
            <span class={LEAD}>
              <Mark
                class="size-4 {tinted ? 'text-error' : 'identity-ink'}"
                style={tinted ? undefined : identityVar(folder.cwd)}
              />
            </span>
            <span class="min-w-0 truncate font-medium {folder.mono ? 'font-mono' : ''}">
              {folder.name}
            </span>
            <span class={TAIL}>
              {#if folder.pinned}
                <IconPinFilled class="size-3 text-muted-foreground/60" />
              {/if}
              {#if folder.live.length > 0}
                <span
                  class="text-micro font-medium {tinted
                    ? 'rounded-full bg-error/15 px-1.5 text-error'
                    : 'text-muted-foreground'}"
                  title={tinted ? 'Something in here is waiting on you' : undefined}
                  data-tabular
                >
                  {folder.live.length}
                </span>
              {/if}
              {#if folder.oneMachine}
                {@render machineGlyph(folder.machineId)}
              {/if}
            </span>
          </button>
        {/snippet}
      </Sidebar.MenuButton>
      <!-- Reserved by `pr-9` above, so nothing shifts when it fades in. A phone
           has no hover to reveal it with, so there it simply stays. -->
      <Button
        variant="ghost"
        size="icon-sm"
        class="absolute top-0 right-0 transition-opacity duration-150 md:opacity-0
               md:group-focus-within/folder:opacity-100 md:group-hover/folder:opacity-100
               md:focus-visible:opacity-100"
        title="New session in {folder.name}"
        aria-label="New session in {folder.name}"
        onclick={() => spawnHere(folder)}
      >
        <IconPlus />
      </Button>
    </div>
  </FolderMenu>

  {#if open}
    <div transition:slide={rowIn}>
      <Sidebar.Menu class={NEST}>
        {#each folder.live as instance (instance.id)}
          <Sidebar.MenuItem class={ITEM}>
            {@render sessionRow(instance, !folder.oneMachine, null)}
          </Sidebar.MenuItem>
        {/each}
        {#each recents as info (info.sessionId)}
          <Sidebar.MenuItem class={ITEM}>
            {@render recentRow(folder.machineId, info)}
          </Sidebar.MenuItem>
        {/each}
        {#if folder.stored.length > RECENTS}
          <li>
            <button
              type="button"
              class="flex h-7 w-full items-center rounded-lg pr-2 pl-8 text-micro
                     text-muted-foreground transition-colors duration-150
                     hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              onclick={() => (showingAll[folder.id] = !all)}
            >
              {all ? 'Show fewer' : `Show all ${folder.stored.length}`}
            </button>
          </li>
        {/if}
        {#if folder.live.length === 0 && folder.stored.length === 0}
          <li class="pr-2 pl-8 text-caption">Nothing here yet.</li>
        {/if}
      </Sidebar.Menu>
    </div>
  {/if}
{/snippet}

{#snippet machineRow(machine: Machine)}
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
        <OsMark os={machine.os} class="text-muted-foreground" />
      </span>
      <span class={LEAD}></span>
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
  aria-label="Sessions, folders and machines"
  class="h-full"
  bind:ref={railEl}
  onkeydown={rovingKeydown}
>
  <!-- No spawn button here: the board's header owns the primary one, and every
       folder header has its own "+". A third pill in the rail was the same verb
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
              <span class={LEAD}></span>
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
        <Sidebar.GroupLabel class="{LABEL} h-8">
          Folders
          <span class="ml-auto flex items-center">
            <NewProjectPopover />
          </span>
        </Sidebar.GroupLabel>
        {#if folders.length > 0}
          <Sidebar.Menu>
            {#each folders as folder (folder.id)}
              {#if isFlat(folder)}
                <!-- Flattened: the folder's live work stands at the top level,
                     one row each. What stopped here is not shown — a folder
                     asked to get out of the way should not leave its history
                     behind as loose rows; the project page and ⌘K still have
                     it. -->
                {#each folder.live as instance (instance.id)}
                  <Sidebar.MenuItem class={ITEM}>
                    {@render sessionRow(instance, false, folder)}
                  </Sidebar.MenuItem>
                {/each}
              {:else}
                <Sidebar.MenuItem class={ITEM}>
                  {@render folderGroup(folder)}
                </Sidebar.MenuItem>
              {/if}
            {/each}
          </Sidebar.Menu>
        {:else}
          <p class="px-2 py-1 text-caption">Nothing running.</p>
        {/if}
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
