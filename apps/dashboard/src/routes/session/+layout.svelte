<script lang="ts">
  /**
   * Session pane stacking and the shared identity header.
   *
   * One pane is kept per conversation the reader has opened. Switching flips
   * `visibility` — nothing unmounts, nothing is measured twice, scroll
   * positions survive.
   *
   * What changed here, and why everything else follows from it: the active
   * conversation is `workspace.activeSessionId`, a plain piece of state, not
   * `page.params.id`. A tab click assigns it and re-renders in the same frame;
   * the URL is written afterwards with `pushState`, which runs no load. Because
   * no load runs, `page.data` cannot change on a switch, so the server tail
   * cannot land late and rebuild a transcript that is already on screen. That
   * late landing was the layout shift; it is now structurally impossible rather
   * than suppressed.
   *
   * The View-Transition suppression flag, the one-frame animation guards and
   * the slide-direction interlocks that used to live here are gone with it.
   * They existed only to hide the navigation cascade this no longer performs.
   */
  import type { Snippet } from 'svelte';
  import { onMount, untrack } from 'svelte';
  import { afterNavigate } from '$app/navigation';
  import { page } from '$app/state';
  import type { EffortLevel, PermissionMode } from '@cockpit/core';
  import FleetBoard from '$lib/cockpit/FleetBoard.svelte';
  import SessionPane from '$lib/cockpit/SessionPane.svelte';
  import SessionHeader, { type SettingChange } from '$lib/cockpit/transcript/SessionHeader.svelte';
  import {
    cockpit,
    syncSubscriptions,
    submitCommand,
    commandRecord,
    streamCapable,
    relaunchSession,
    type HistorySource,
  } from '$lib/cockpit/client.svelte';
  import { workspace, sessionIdOf } from '$lib/cockpit/workspace/workspace.svelte';
  import { workingSet } from '$lib/cockpit/working-set.svelte';
  import { resolveSessionTitle } from '$lib/cockpit/links';
  import { models, covers, ensureModels } from '$lib/cockpit/models.svelte';
  import { PERMISSION_MODES } from '$lib/cockpit/permission-modes';
  import { effortStops as getEffortStops, hasEffortScale } from '$lib/cockpit/effort-levels';

  let { children }: { children: Snippet } = $props();

  /* ── What is on screen ───────────────────────────────────────────── */

  const viewId = $derived(workspace.activeSessionId ?? '');
  const onBoard = $derived(workspace.activeSessionId === null);

  /* ── The server's answer, claimed once ───────────────────────────────
     `page.data` only changes on a REAL navigation — a cold load, a deep
     link, an arrival from another route. Reading it reactively would mean
     every pane re-evaluating its claim whenever anything touched the page
     store; worse, it was the mechanism by which a late-landing tail
     rebuilt a transcript mid-animation. So it is captured by value, at the
     two moments it can actually differ, and handed to the one pane it
     belongs to as a prop. */

  interface EntryData {
    id: string;
    tail: unknown;
    history: Promise<HistorySource | null> | null;
  }

  const captureEntry = (): EntryData => ({
    id: page.params.id ?? '',
    tail: (page.data as { tail?: unknown }).tail ?? null,
    history:
      (page.data as { history?: Promise<HistorySource | null> | null }).history ?? null,
  });

  let entry = $state<EntryData>(captureEntry());
  afterNavigate(() => {
    entry = captureEntry();
    reconcileFromUrl();
  });

  /* ── URL → workspace ─────────────────────────────────────────────────
     The other direction of the projection, and the only one that reads the
     URL.

     Deliberately NOT a `$effect` on `page.url`. A shallow `pushState` does
     not re-run this layout's effects — measured, not assumed: an instrumented
     effect fired twice at mount and never again across three tab clicks and
     two back presses, leaving the store a whole history entry behind the
     address bar. Reactivity is the wrong instrument here anyway. There are
     exactly two ways the URL can move without this store having moved first,
     and both are events: the browser walking history, and a real navigation
     arriving from another route. So both are listened for, `location` is read
     directly, and nothing depends on when a framework store catches up.

     Our own `pushState` needs no reconciliation at all — the store was the
     thing that moved first. The equality check makes that a no-op rather than
     a second write. */

  const browsingCwd = $derived(page.url.searchParams.get('cwd') ?? '');
  const browsingHarness = $derived(page.url.searchParams.get('harness') ?? 'claude');
  const browsingMachine = $derived(page.url.searchParams.get('machine'));

  function reconcileFromUrl(): void {
    const url = new URL(location.href);
    const parts = url.pathname.split('/').filter(Boolean);
    // Another route entirely — leave the workspace holding what it holds, so
    // a trip to Usage and back does not cost the reader their place.
    if (parts[0] !== 'session') return;
    const urlId = parts[1] ?? null;
    if (urlId === workspace.activeSessionId) return;
    // Only carry context when the URL actually names a machine. A stored
    // conversation's machine and folder are how it is addressed at all, and
    // `workingSet.visit` SPREADS what it is given over what it holds — so
    // handing it a blank context because this particular URL had no query
    // string erases the real one, and the pane that had been reading a
    // transcript a moment ago reports itself unreachable.
    const machine = url.searchParams.get('machine');
    workspace.reveal(
      urlId,
      urlId && machine
        ? {
            machine,
            cwd: url.searchParams.get('cwd') ?? '',
            harness: url.searchParams.get('harness') ?? 'claude',
          }
        : undefined
    );
  }

  onMount(() => {
    reconcileFromUrl();
    const onPop = () => reconcileFromUrl();
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  });

  /* ── Panes ───────────────────────────────────────────────────────────
     A pane is mounted the first time its conversation is shown and then
     kept for the life of the session — that is what makes a return to a
     tab free. The list only grows here; closing a tab prunes it. */

  let mounted = $state<string[]>([]);

  $effect.pre(() => {
    const id = viewId;
    if (!id) return;
    untrack(() => {
      if (!mounted.includes(id)) mounted.push(id);
    });
  });

  $effect(() => {
    const open = new Set(workspace.openIds);
    untrack(() => {
      const keep = mounted.filter((id) => open.has(id));
      if (keep.length !== mounted.length) mounted = keep;
    });
  });

  $effect(() => {
    syncSubscriptions();
  });

  /* ── Per-pane view state (chat / flow) ───────────────────────────── */

  let views = $state<Record<string, 'chat' | 'flow'>>({});

  /* ── Shared header ───────────────────────────────────────────────────
     ONE instance, above the stack. Because it is one instance and its text
     comes from synchronous state, torph morphs the title character by
     character on a switch instead of the whole bar being replaced. */

  const session = $derived(cockpit.session(viewId) ?? null);
  const machineId = $derived(cockpit.session(viewId)?.machineId ?? '');

  const machineName = $derived(
    cockpit.machines.find((m) => m.machineId === machineId)?.hostname ?? machineId
  );

  const title = $derived(
    resolveSessionTitle({
      title: cockpit.instances.find((i) => i.id === viewId)?.title,
      firstMessage: session?.messages.find((m) => m.type === 'user' && m.content.trim())?.content,
      cwd: session?.cwd || browsingCwd,
      id: viewId,
    })
  );

  const stats = $derived(cockpit.statsOf(viewId));
  const activity = $derived(cockpit.activityOf(viewId));

  const machineRow = $derived(cockpit.machines.find((m) => m.machineId === machineId) ?? null);
  const harnessReport = $derived(
    machineRow?.harnesses?.find((report) => report.harness === session?.harness) ?? null
  );
  const offeredModes = $derived(
    harnessReport
      ? PERMISSION_MODES.filter((mode) =>
          harnessReport.capabilities.permissionModes.includes(mode.value)
        )
      : PERMISSION_MODES
  );
  const chosenModel = $derived(
    session?.model ? (models.offered.find((row) => covers(row, session.model!)) ?? null) : null
  );
  const harnessEffort = $derived(harnessReport?.capabilities.effort !== false);
  const showEffort = $derived(harnessEffort && hasEffortScale(chosenModel));
  const effortStopsForModel = $derived(getEffortStops(chosenModel));

  $effect(() => {
    ensureModels();
  });

  function onmodel(model: string): SettingChange {
    if (!machineId) return null;
    return submitCommand(viewId, machineId, 'set-model', { model });
  }
  function onpermission(mode: PermissionMode): SettingChange {
    if (!machineId) return null;
    if (mode === 'bypassPermissions') return relaunchSession(viewId, machineId, mode);
    return submitCommand(viewId, machineId, 'set-permission-mode', { mode });
  }
  function oneffort(level: EffortLevel): SettingChange {
    if (!machineId) return null;
    return submitCommand(viewId, machineId, 'set-effort', { effort: level });
  }
</script>

<!-- One header for the stack. Conditional on there BEING a conversation, not
     on the store having caught up with it, so it stays on screen through the
     moment between opening a tab and its transcript arriving. -->
{#if !onBoard && viewId}
  <SessionHeader
    {title}
    seed={session?.cwd || browsingCwd || viewId}
    harness={session?.harness ?? browsingHarness}
    {machineName}
    cwd={session?.cwd || browsingCwd}
    {activity}
    model={session?.model ?? null}
    permissionMode={session?.permissionMode ?? null}
    effort={session?.effort ?? null}
    mcpCount={session?.mcp?.length ?? null}
    turns={stats.turns}
    totalTokens={stats.totalTokens}
    maxTokens={stats.maxTokens}
    cost={stats.cost}
    view={views[viewId] ?? 'chat'}
    onview={(v) => (views[viewId] = v)}
    {offeredModes}
    effortStops={effortStopsForModel}
    {showEffort}
    {harnessEffort}
    {onmodel}
    {onpermission}
    {oneffort}
    trackedCommand={commandRecord}
    streaming={streamCapable()}
  />
{/if}

<div class="pane-stack relative min-h-0 min-w-0 flex-1 overflow-hidden">
  <div class="pane absolute inset-0 flex" class:pane-hidden={!onBoard} inert={!onBoard}>
    <FleetBoard active={onBoard} />
  </div>

  {#each mounted as paneId (paneId)}
    {@const isActive = paneId === viewId && !onBoard}
    {@const ctx = workingSet.contextOf(paneId)}
    <div class="pane absolute inset-0 flex" class:pane-hidden={!isActive} inert={!isActive}>
      <SessionPane
        viewId={paneId}
        browsing={ctx?.machine ?? null}
        browsingCwd={ctx?.cwd ?? ''}
        browsingHarness={ctx?.harness ?? 'claude'}
        serverTail={paneId === entry.id ? entry.tail : null}
        serverHistory={paneId === entry.id ? entry.history : null}
        active={isActive}
        hideHeader
        view={views[paneId] ?? 'chat'}
        onview={(v) => (views[paneId] = v)}
      />
    </div>
  {/each}

  {@render children()}
</div>

<style>
  /* Only the active pane is shown. `visibility` rather than `display`,
     deliberately: a hidden pane still lays out, so the virtualiser keeps its
     measurements and revealing one costs nothing. */
  .pane {
    opacity: 1;
    visibility: visible;
  }

  .pane-hidden {
    visibility: hidden;
    pointer-events: none;
  }
</style>
