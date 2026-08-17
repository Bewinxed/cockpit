<script module lang="ts">
  import type { Activity } from './activity';
  import { readJson, writeJson } from './storage';

  /**
   * Which sessions are showing the sub-work they have out — subagents and
   * delegates alike, behind one fold. Not persisted: subagents are the
   * shortest-lived thing the rail draws, and an expansion restored onto work
   * that finished hours ago is noise, not memory.
   */
  const subworkUnfolded = $state<Record<string, boolean>>({});

  const toggleSubwork = (instanceId: string, open = !subworkUnfolded[instanceId]): void => {
    subworkUnfolded[instanceId] = open;
  };

  /** Which branch peek is open — at most one at a time. */
  const peeking = $state<Record<string, boolean>>({});

  function setPeek(key: string, open: boolean): void {
    if (open) for (const k of Object.keys(peeking)) peeking[k] = false;
    peeking[key] = open;
  }

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
    const stored = readJson<unknown>(key, {});
    return stored && typeof stored === 'object' ? (stored as Record<string, T>) : {};
  };

  const writeMap = (key: string, map: object): void => {
    writeJson(key, map);
  };

  /**
   * What the reader has said about each folder, kept rather than assumed, so a
   * shut folder stays shut across visits. The old shape stored `true` for shut
   * and nothing for open; it migrates on read. Without a stored answer a folder
   * with live work or an alert arrives open and a dormant one arrives shut —
   * what was once "a directory that starts working while you are away arrives
   * with its work showing" now in the default rather than the storage key.
   */
  type Fold = 'open' | 'shut';
  const fold = $state<Record<string, Fold>>(
    Object.fromEntries(
      Object.entries(readMap<Fold | true>(SHUT_KEY)).map(([id, v]) => [id, v === true ? 'shut' : v])
    )
  );

  function setFolder(id: string, open: boolean): void {
    fold[id] = open ? 'open' : 'shut';
    writeMap(SHUT_KEY, fold);
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
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { flip } from 'svelte/animate';
  import { slide } from 'svelte/transition';
  import { quintOut } from 'svelte/easing';
  import { dndzone, type DndEvent } from 'svelte-dnd-action';

  const TOUCH_DRAG_DELAY_MS = 1200;
  import type { SDKSessionInfo } from '@cockpit/core';
  import { Button } from '$lib/components/ui/button';
  import * as Sidebar from '$lib/components/ui/sidebar';
  import {
    IconChevronRight,
    IconChevronUp,
    IconFolderDuo,
    IconPinFilled,
    IconPlus,
    IconSparklesDuo,
    IconSubagentsDuo,
    IconTools,
    IconUsage,
  } from '$lib/icons';
  import { SubagentPeek } from '$lib/components/features';
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
  import { delegateHandle, sessionTitle, transcriptHref } from './links';
  import ProviderLogo from '$lib/components/features/ProviderLogo.svelte';
  import { machineLabel, signInWarning } from './machine';
  import { orderMachines, rail, type PinKind } from './rail.svelte';

  /**
   * 32px row, one line, the same slots wherever the rail draws one. Rows end
   * flush at the edge: the folder header's hover "+" overlays its own tail, so
   * nothing reserves a gutter for it any more.
   */
  const ROW = 'h-8 gap-2 rounded-lg pr-2 pl-2 text-[13px]';
  const LABEL = 'h-7 gap-1.5 px-2 text-micro font-medium text-muted-foreground';
  const ITEM = 'rounded-lg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none';
  const SUBROW =
    'flex h-7 w-full items-center gap-1.5 rounded-lg pr-2 pl-8 text-micro text-muted-foreground transition-colors duration-150 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground';
  /**
   * The leading slot every row shares — a 16px glyph, or a 6px dot centred in
   * the same space, so titles line up down the whole rail whatever leads them.
   *
   * A row takes one slot. The folder header's slot carries the directory mark
   * and swaps it for the disclosure chevron on hover/focus; every other row
   * puts its own glyph in that one slot. Hierarchy is said by the folder
   * header — its mark, font-medium and identity ink — and by the dot column,
   * so the whole rail runs down one line.
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
    if (info) return { text: sessionTitle(info), path: false };
    // What its spawn said it is for — a delegate's brief, first line. Every
    // delegate is a side quest, so the catalog will never have a title for one:
    // without this the whole of a delegation reads as an id.
    if (instance.title) return { text: instance.title, path: false };
    // A delegate with no title at all gets its fleet-wide handle rather than
    // the bare leaf: seven delegates of one session are seven different names,
    // and each matches the "[Report from delegate <handle>]" its parent shows.
    if (instance.parentInstanceId) return { text: delegateHandle(instance), path: true };
    return { text: leaf(instance.cwd), path: true };
  };

  /**
   * When a session's transcript was last written, from the catalog — a session
   * with no transcript yet is the newest thing in the folder, not the oldest,
   * so it sorts first, not last. This is what orders live rows by recency
   * rather than by the hub's own order.
   */
  const lastActiveAt = (row: InstanceRow): number =>
    cockpit.catalogOf(row.machineId).find((info) => info.sessionId === row.sessionId)?.lastModified ??
    Number.MAX_SAFE_INTEGER;

  /** With more than one box, a folder whose rows all share one can say so once. */
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
   * A delegate is a full session that names the instance that delegated to it
   * (`parentInstanceId`). Its row folds under that parent rather than filing
   * into a directory of its own — unless the parent is not itself listed, in
   * which case it reads as an ordinary top-level session.
   */
  const parentIds = $derived(new Set(sessions.map((row) => row.id)));
  const delegates = $derived(
    sessions.filter((row) => row.parentInstanceId && parentIds.has(row.parentInstanceId))
  );
  const delegateIds = $derived(new Set(delegates.map((row) => row.id)));
  /** The rows the rail files top-level: everything that is not a listed delegate. */
  const topSessions = $derived(sessions.filter((row) => !delegateIds.has(row.id)));
  const delegatesOf = (parentId: string): InstanceRow[] =>
    delegates
      .filter((row) => row.parentInstanceId === parentId)
      .sort((a, b) => lastActiveAt(b) - lastActiveAt(a));

  /**
   * The only red in the rail: a session parked on a permission or a question —
   * something with an answer the user can give from the queue. A session that
   * died has nothing to answer, so it is not here: failure is a status its row
   * already paints red, not a need. One row per session — six requests parked
   * on the same session is still one session to open.
   */
  const needsYou = $derived.by(() => {
    const rows: InstanceRow[] = [];
    const seen = new Set<string>();
    for (const request of cockpit.blocked) {
      const instance = cockpit.instances.find((row) => row.id === request.instanceId);
      if (!instance || seen.has(instance.id)) continue;
      seen.add(instance.id);
      rows.push(instance);
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
    // Pins first, then newest activity first — sorting by recency is deliberate
    // (user decision 2026-08-17), not the hub's own order reasserting itself.
    const rows = [...live].sort(
      (a, b) => pinnedFirst('session')(a, b) || lastActiveAt(b) - lastActiveAt(a)
    );
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
    const waiting = new Set(needsYou.map((row) => row.id));
    const claimed = new Set<string>();
    const list: Folder[] = [];

    for (const project of cockpit.projects) {
      const members = cockpit.liveIn(project).filter((row) => !delegateIds.has(row.id));
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
    for (const row of topSessions) {
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
   * that has stopped there, is not a hierarchy — the header and the chevron
   * both say "there is more in here" about a folder with one thing in it. It
   * draws as that session's own row instead.
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

  /**
   * Whether a folder draws open. The reader's own say wins; without one, a
   * folder with live work or an alert arrives open, and a dormant one arrives
   * shut — history stays out of the way until it has something to say.
   */
  const isOpen = (folder: Folder): boolean => {
    const said = fold[folder.id];
    if (said) return said === 'open';
    return folder.live.length > 0 || folder.alerting;
  };

  /** Whether any folder is currently open — what the collapse-all control toggles. */
  const anyOpen = $derived(folders.some((f) => !isFlat(f) && isOpen(f)));

  function foldAll(open: boolean): void {
    for (const folder of folders) if (!isFlat(folder)) setFolder(folder.id, open);
  }

  /** Everything but this one shut — how you get back to one folder at a time. */
  function collapseOthers(id: string): void {
    for (const folder of folders) {
      if (folder.id !== id && !isFlat(folder)) setFolder(folder.id, false);
    }
    setFolder(id, true);
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
      // The only other thing a row folds open is the sub-work it has out.
      const instanceId = focused?.dataset.subagents;
      if (!instanceId) return;
      event.preventDefault();
      toggleSubwork(instanceId, open);
    }
  }
</script>

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

{#snippet alertRow(instance: InstanceRow)}
  {@const current = isCurrent(`/session/${instance.id}`)}
  {@const name = titleOf(instance)}
  <Sidebar.MenuButton isActive={current} class={ROW}>
    {#snippet child({ props })}
      <a
        {...props}
        href="/session/{instance.id}"
        aria-current={current ? 'page' : undefined}
        title="Waiting on you"
        data-rail-row
        in:slide={rowIn}
        out:slide={rowOut}
      >
        <span class={LEAD}>
          <ActivityDot activity="blocked" size={1.5} />
        </span>
        <span class="min-w-0 truncate {name.path ? 'font-mono' : ''}">{name.text}</span>
        <span class={TAIL}>
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
  {@const name = titleOf(instance)}
  {@const delegateRows = delegatesOf(instance.id)}
  {@const bgTasks = cockpit.backgroundTasksOf(instance.id)}
  {@const subworkTotal = branches.length + delegateRows.length}
  {@const subworkRunning =
    branches.filter((b) => b.status === 'running' || b.status === 'starting').length +
    delegateRows.filter((row) => cockpit.activityOf(row.id) !== 'idle').length}
  {@const subworkOpen = subworkUnfolded[instance.id] ?? subworkRunning > 0}
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
          title={sleeping ? SLEEPING_HINT : handoff ? `${name.text} — handed work from ${handedFrom}` : name.text}
          data-rail-row
          data-subagents={subworkTotal > 0 ? instance.id : undefined}
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
              class="size-2 shrink-0 rounded-full bg-primary"
              title="Finished while you were away"
            ></span>
          {/if}
          <!-- A quest is marked beside its name rather than in front of it: the
               leading slot belongs to state, and the titles stay in one column. -->
          {#if quest}
            <IconSparklesDuo class="size-3.5 shrink-0 text-muted-foreground" />
          {/if}
          <span class={TAIL}>
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
              {@render machineGlyph(instance.machineId)}
            {/if}
            {#if flat?.oneMachine}
              {@render machineGlyph(flat.machineId)}
            {/if}
          </span>
        </a>
      {/snippet}
    </Sidebar.MenuButton>
  </LiveSessionMenu>

  {#if subworkTotal > 0}
    <button
      type="button"
      class={SUBROW}
      aria-expanded={subworkOpen}
      onclick={() => toggleSubwork(instance.id)}
    >
      <IconChevronRight
        class="size-3 shrink-0 transition-transform duration-240 ease-expo {subworkOpen
          ? 'rotate-90'
          : ''}"
      />
      <span>
        {subworkTotal} subagent{subworkTotal === 1 ? '' : 's'}{subworkRunning > 0
          ? ` · ${subworkRunning} running`
          : ''}
      </span>
    </button>

    {#if subworkOpen}
      <ul class="flex flex-col gap-0.5 pl-8" transition:slide={rowIn}>
        {#each branches as branch (branch.toolUseId)}
          {@const branchRunning = branch.status === 'running' || branch.status === 'starting'}
          {@const branchDone = branch.status === 'complete'}
          {@const branchError = branch.status === 'error'}
          {@const peekKey = `${instance.id}:${branch.toolUseId}`}
          <li>
            <SubagentPeek
              {branch}
              instanceId={instance.id}
              open={peeking[peekKey] ?? false}
              onOpenChange={(v) => setPeek(peekKey, v)}
            >
              {#snippet children({ props })}
                <a
                  {...props}
                  href="/session/{instance.id}#subagent-{branch.toolUseId}"
                  class="flex items-start gap-1.5 rounded-lg px-2 py-1 text-micro
                         transition-colors duration-150
                         hover:bg-sidebar-accent hover:text-sidebar-accent-foreground
                         {branchDone ? 'text-muted-foreground/60' : 'text-muted-foreground'}"
                  title={branch.description ?? branch.subagentType}
                  onclick={(e) => {
                    e.preventDefault();
                    setPeek(peekKey, !(peeking[peekKey] ?? false));
                  }}
                  ondblclick={(e) => {
                    e.preventDefault();
                    setPeek(peekKey, false);
                    void goto(`/session/${instance.id}#subagent-${branch.toolUseId}`);
                  }}
                >
                  <span
                    class="mt-1 size-2 shrink-0 rounded-full {BRANCH_DOT[branch.status] ??
                      'bg-muted-foreground/40'} {branchRunning
                      ? 'animate-pulse motion-reduce:animate-none'
                      : ''}"
                  ></span>
                  <span class="min-w-0 flex-1">
                    <span class="block truncate">{branch.description ?? branch.subagentType}</span>
                    {#if branchError}
                      <span class="block truncate text-destructive">
                        {branch.error ? `Failed · ${branch.error}` : 'Failed'}
                      </span>
                    {:else if branch.summary && branchRunning}
                      <span class="block truncate text-muted-foreground">{branch.summary}</span>
                    {/if}
                  </span>
                </a>
              {/snippet}
            </SubagentPeek>
          </li>
        {/each}
        {#each delegateRows as delegate (delegate.id)}
          <li>
            {@render delegateRow(delegate)}
          </li>
        {/each}
        {#if bgTasks > 0}
          <li class="px-2 py-1 text-micro text-muted-foreground/50">
            {bgTasks} background task{bgTasks === 1 ? '' : 's'}
          </li>
        {/if}
      </ul>
    {/if}
  {/if}
{/snippet}

{#snippet delegateRow(instance: InstanceRow)}
  {@const activity = cockpit.activityOf(instance.id)}
  {@const sleeping = isResumable(instance)}
  {@const current = isCurrent(`/session/${instance.id}`)}
  {@const name = titleOf(instance)}
  {@const nested = delegatesOf(instance.id)}
  <!-- A titled row no longer shows its handle, and the handle is what its
       reports name it by — the hover carries both, so the cross-reference to
       the parent's transcript stays one pointer away. -->
  {@const hover = instance.title ? `${delegateHandle(instance)} · ${instance.title}` : name.text}
  <LiveSessionMenu {instance}>
    <Sidebar.MenuButton isActive={current} class={ROW}>
      {#snippet child({ props })}
        <a
          {...props}
          href="/session/{instance.id}"
          aria-current={current ? 'page' : undefined}
          title={sleeping ? SLEEPING_HINT : hover}
          data-rail-row
          in:slide={rowIn}
          out:slide={rowOut}
        >
          <span class={LEAD}>
            {#if sleeping}
              <span class="size-1.5 rounded-full bg-muted-foreground/40" title={SLEEPING_LABEL}></span>
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
          <span class={TAIL}>
            <!-- What the delegate IS, not just that it is one: the executor
                 model's mark and leaf, with the word kept for the hover. -->
            <span
              class="flex shrink-0 items-center gap-1 rounded-full bg-muted px-1.5 text-micro font-medium text-muted-foreground"
              title={instance.model ? `delegate · ${instance.model}` : 'delegate'}
            >
              {#if instance.model}
                <ProviderLogo model={instance.model} size={12} />
                <!-- A phone rail has no room for a model name; the mark alone
                     says it, and the hover/long-press title keeps the words. -->
                <span class="hidden max-w-24 truncate sm:inline">{instance.model.split('/').pop()}</span>
              {:else}
                delegate
              {/if}
            </span>
          </span>
        </a>
      {/snippet}
    </Sidebar.MenuButton>
  </LiveSessionMenu>
  {#if nested.length > 0}
    <ul class="flex flex-col gap-0.5 pl-8" transition:slide={rowIn}>
      {#each nested as delegate (delegate.id)}
        <li>
          {@render delegateRow(delegate)}
        </li>
      {/each}
    </ul>
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
  {@const open = isOpen(folder)}
  {@const tinted = !open && folder.alerting}
  {@const all = showingAll[folder.id] ?? false}
  {@const recents = all ? folder.stored : folder.stored.slice(0, RECENTS)}
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
            <span class="{LEAD} relative">
              <IconFolderDuo
                class="size-4 transition-opacity duration-150 md:group-hover/folder:opacity-0 md:group-focus-within/folder:opacity-0 {tinted ? 'text-error' : 'identity-ink'}"
                style={tinted ? undefined : identityVar(folder.cwd)}
              />
              <IconChevronRight
                class="absolute inset-0 m-auto size-4 text-muted-foreground/70 opacity-0 transition-all duration-240 ease-expo md:group-hover/folder:opacity-100 md:group-focus-within/folder:opacity-100 {open ? 'rotate-90' : ''}"
              />
            </span>
            <span class="min-w-0 truncate font-medium {folder.mono ? 'font-mono' : ''}">
              {folder.name}
            </span>
            <span class={TAIL}>
              {#if folder.pinned}
                <IconPinFilled class="size-3 text-muted-foreground/60" />
              {/if}
              {#if !open && folder.live.some((row) => unseen[row.id] !== undefined)}
                <span
                  class="size-2 shrink-0 rounded-full bg-primary"
                  title="Something in here finished while you were away"
                ></span>
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
      <!-- Overlays the tail on hover: `bg-sidebar-accent` covers whatever it
           overlaps, and a phone has no hover to reveal it with, so there it
           simply stays. -->
      <Button
        variant="ghost"
        size="icon-sm"
        class="absolute top-0 right-0 bg-sidebar-accent transition-opacity duration-150 md:opacity-0
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
      <Sidebar.Menu>
        {#each folder.live as instance (instance.id)}
          <Sidebar.MenuItem class={ITEM}>
            {@render sessionRow(instance, !folder.oneMachine, null)}
          </Sidebar.MenuItem>
        {/each}
        {#if recents.length > 0}
          <li
            class="flex h-6 items-center pr-2 pl-8 text-micro font-medium text-muted-foreground/70"
            aria-hidden="true"
          >
            Recent
          </li>
        {/if}
        {#each recents as info (info.sessionId)}
          <Sidebar.MenuItem class={ITEM}>
            {@render recentRow(folder.machineId, info)}
          </Sidebar.MenuItem>
        {/each}
        {#if folder.stored.length > RECENTS}
          <li>
            <button
              type="button"
              class={SUBROW}
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
            {#each needsYou as instance (instance.id)}
              <Sidebar.MenuItem class={ITEM}>
                {@render alertRow(instance)}
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
            <Button
              variant="ghost"
              size="icon-sm"
              class="-mr-1"
              title={anyOpen ? 'Collapse all folders' : 'Expand all folders'}
              aria-label={anyOpen ? 'Collapse all folders' : 'Expand all folders'}
              onclick={() => foldAll(!anyOpen)}
            >
              <IconChevronUp
                class="transition-transform duration-240 ease-expo {anyOpen ? '' : 'rotate-180'}"
              />
            </Button>
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
      <Sidebar.GroupLabel class={LABEL}>
        Machines
        <span class="ml-auto flex items-center gap-1">
          <a href="/tools" title="Tools" aria-label="Tools" aria-current={page.url.pathname === '/tools' ? 'page' : undefined} class="flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-150 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"><IconTools class="size-4" /></a>
          <a href="/usage" title="Usage" aria-label="Usage" aria-current={page.url.pathname === '/usage' ? 'page' : undefined} class="flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-150 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"><IconUsage class="size-4" /></a>
        </span>
      </Sidebar.GroupLabel>
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
