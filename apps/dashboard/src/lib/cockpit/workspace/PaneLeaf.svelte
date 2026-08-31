<script lang="ts">
  /**
   * One group: a strip of tabs, the identity bar for whichever is showing,
   * and the conversations themselves stacked behind it.
   *
   * This is the unit the grid splits. Everything that used to be "the session
   * layout" lives here now, once per group rather than once per app, which is
   * what lets two conversations be worked in side by side.
   *
   * The header stays ONE instance per group on purpose. Because there is one
   * of it and its text comes from synchronous state, torph morphs the title
   * character by character when the group changes tab, instead of the bar
   * being torn down and rebuilt. Give each tab its own header and that
   * disappears.
   */
  import { untrack } from 'svelte';
  import type { EffortLevel, PermissionMode } from '@cockpit/core';
  import SessionPane from '../SessionPane.svelte';
  import SessionHeader, { type SettingChange } from '../transcript/SessionHeader.svelte';
  import PaneTabs from './PaneTabs.svelte';
  import {
    cockpit,
    submitCommand,
    commandRecord,
    streamCapable,
    relaunchSession,
    type HistorySource,
  } from '../client.svelte';
  import { workspace, type LeafNode } from './workspace.svelte';
  import { createSwipe } from './gesture.svelte';
  import { paneDropTarget, dropHint } from './dnd.svelte';
  import { workingSet } from '../working-set.svelte';
  import { resolveSessionTitle } from '../links';
  import { models, covers, ensureModels } from '../models.svelte';
  import { PERMISSION_MODES } from '../permission-modes';
  import { effortStops as getEffortStops, hasEffortScale } from '../effort-levels';

  let {
    leaf,
    entryId = '',
    entryTail = null,
    entryHistory = null,
    swipeable = false,
    showTabs = undefined,
  }: {
    leaf: LeafNode;
    /** Which conversation this page's server data belongs to, if any. */
    entryId?: string;
    entryTail?: unknown;
    entryHistory?: Promise<HistorySource | null> | null;
    /** Only the phone's single group takes the swipe. */
    swipeable?: boolean;
    /**
     * Whether this group draws its own strip. Left unset it decides for
     * itself: a lone group has no need of one, because the app strip above
     * it already lists exactly the same conversations. Two rows of tabs
     * saying the same thing is chrome, not information.
     */
    showTabs?: boolean;
  } = $props();

  const swipe = createSwipe(() => leaf.id);

  /** A lone group defers to the app strip; a split group owns its tabs. */
  const stripVisible = $derived(showTabs ?? workspace.leaves.length > 1);

  /** What a drop hovering this group would do, if anything. */
  const splitEdge = $derived(dropHint.splits(leaf.id));
  const joins = $derived(dropHint.joins(leaf.id));

  const viewId = $derived(leaf.active ?? '');
  /** Whether the reader's keyboard belongs to this group. */
  const isFocusedLeaf = $derived(workspace.focusedLeafId === leaf.id);

  /**
   * Which conversation the header NAMES — the swipe's target once a drag has
   * passed the point it would commit at, so the title morphs while the finger
   * is still moving and morphs back if the drag retreats.
   */
  const headerId = $derived(swipe.previewId ?? viewId);

  /* ── Panes ─────────────────────────────────────────────────────────
     Mounted on first sight and kept, so returning to a tab is free. The
     conversations either side are mounted ahead of being asked for, which
     is what makes a swipe reveal something rather than nothing. */

  let mounted = $state<string[]>([]);

  $effect.pre(() => {
    const id = viewId;
    if (!id) return;
    untrack(() => {
      if (!mounted.includes(id)) mounted.push(id);
    });
  });

  /**
   * Mount the conversations either side, but only where they can be reached
   * by a gesture, and never on the critical path of the switch itself.
   *
   * Prewarming exists so a swipe reveals something rather than nothing. A
   * pointer cannot swipe, so on a desktop it buys nothing and costs a great
   * deal: each neighbour is a whole pane, transcript and virtualiser, and
   * mounting two of them synchronously put 224ms of flush behind a tab click
   * that the handler itself finished in 1ms.
   *
   * Even where it IS wanted it waits: the switch settles first, and the
   * neighbours arrive after, so the conversation the reader asked for is
   * never behind the two they did not.
   */
  $effect(() => {
    if (!swipeable) return;
    const here = leaf.active;
    if (!here) return;
    const neighbours = [workspace.step(here, 1, leaf.id), workspace.step(here, -1, leaf.id)];
    const warm = setTimeout(() => {
      untrack(() => {
        for (const id of neighbours) if (id && !mounted.includes(id)) mounted.push(id);
      });
    }, 120);
    return () => clearTimeout(warm);
  });

  $effect(() => {
    const open = new Set(leaf.tabs);
    untrack(() => {
      const keep = mounted.filter((id) => open.has(id));
      if (keep.length !== mounted.length) mounted = keep;
    });
  });

  /* ── Per-tab view state (chat / flow) ───────────────────────────── */

  let views = $state<Record<string, 'chat' | 'flow'>>({});

  /* ── The header's data ──────────────────────────────────────────── */

  const session = $derived(cockpit.session(headerId) ?? null);
  const machineId = $derived(cockpit.session(headerId)?.machineId ?? '');
  const headerCtx = $derived(workingSet.contextOf(headerId));

  const machineName = $derived(
    cockpit.machines.find((m) => m.machineId === machineId)?.hostname ?? machineId
  );

  const title = $derived(
    resolveSessionTitle({
      title: cockpit.instances.find((i) => i.id === headerId)?.title,
      firstMessage: session?.messages.find((m) => m.type === 'user' && m.content.trim())?.content,
      cwd: session?.cwd || headerCtx?.cwd,
      id: headerId,
    })
  );

  const stats = $derived(cockpit.statsOf(headerId));
  const activity = $derived(cockpit.activityOf(headerId));

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
    return submitCommand(headerId, machineId, 'set-model', { model });
  }
  function onpermission(mode: PermissionMode): SettingChange {
    if (!machineId) return null;
    if (mode === 'bypassPermissions') return relaunchSession(headerId, machineId, mode);
    return submitCommand(headerId, machineId, 'set-permission-mode', { mode });
  }
  function oneffort(level: EffortLevel): SettingChange {
    if (!machineId) return null;
    return submitCommand(headerId, machineId, 'set-effort', { effort: level });
  }
</script>

<!-- The whole group answers to a click by taking focus, so typing goes where
     the reader just looked. `focusin` rather than `click`: reaching the
     composer with the keyboard should move focus too. -->
<section
  class="leaf"
  class:leaf-focused={isFocusedLeaf}
  onfocusincapture={() => workspace.focus(leaf.id)}
  onpointerdowncapture={() => workspace.focus(leaf.id)}
>
  <!-- The focus mark is graphite, never the accent: the one loud colour in
       this product means a session is asking for something, and "you are
       typing here" must not compete with it. -->
  <span class="rail" aria-hidden="true"></span>

  {#if stripVisible}
    <PaneTabs {leaf} />
  {/if}

  {#if viewId}
    <SessionHeader
      {title}
      seed={session?.cwd || headerCtx?.cwd || headerId}
      harness={session?.harness ?? headerCtx?.harness ?? 'claude'}
      {machineName}
      cwd={session?.cwd || headerCtx?.cwd || ''}
      {activity}
      model={session?.model ?? null}
      permissionMode={session?.permissionMode ?? null}
      effort={session?.effort ?? null}
      mcpCount={session?.mcp?.length ?? null}
      turns={stats.turns}
      totalTokens={stats.totalTokens}
      maxTokens={stats.maxTokens}
      cost={stats.cost}
      view={views[headerId] ?? 'chat'}
      onview={(v) => (views[headerId] = v)}
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

  <!-- Where a dropped conversation would go, shown as the shape it would
       take: half the group when a split is on offer, the whole of it when
       the drop would simply join these tabs. The indicator and the hitbox
       read the same 25% band, so the picture cannot promise something the
       drop will not do. -->
  {#if splitEdge}
    <div class="drop-preview drop-{splitEdge}" aria-hidden="true"></div>
  {:else if joins}
    <div class="drop-preview drop-whole" aria-hidden="true"></div>
  {/if}

  <div class="stack" use:swipe.action={swipeable} use:paneDropTarget={leaf.id}>
    {#each mounted as paneId (paneId)}
      {@const isActive = paneId === viewId}
      {@const offset = swipe.offsetOf(paneId, isActive)}
      {@const shown = isActive || offset !== null}
      {@const ctx = workingSet.contextOf(paneId)}
      <div
        class="pane"
        class:pane-hidden={!shown}
        inert={!isActive}
        style:transform={offset === null ? 'translateX(0)' : `translateX(${offset}px)`}
        style:transition={swipe.transition}
      >
        <SessionPane
          viewId={paneId}
          browsing={ctx?.machine ?? null}
          browsingCwd={ctx?.cwd ?? ''}
          browsingHarness={ctx?.harness ?? 'claude'}
          serverTail={paneId === entryId ? entryTail : null}
          serverHistory={paneId === entryId ? entryHistory : null}
          visible={shown}
          focused={isActive && isFocusedLeaf}
          hideHeader
          view={views[paneId] ?? 'chat'}
          onview={(v) => (views[paneId] = v)}
        />
      </div>
    {/each}
  </div>
</section>

<style>
  .leaf {
    /* A split pane can be 370px wide inside a 1400px window, so the chrome
       inside it has to answer to the PANE, not the viewport. Viewport media
       queries are the wrong instrument here and produce exactly what they
       did before this: a full-width identity bar clipped in half. */
    container-type: inline-size;
    container-name: leaf;
    position: relative;
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    background: var(--surface-field);
  }

  /* Which group the keyboard belongs to, said without colour: a hairline
     rail down the leading edge, and nothing at all on the others. Rank by
     position and weight — the accent budget belongs to "needs you". */
  .rail {
    position: absolute;
    inset: 0 auto 0 0;
    width: 2px;
    background: var(--ink-muted);
    opacity: 0;
    z-index: 2;
    pointer-events: none;
  }
  .leaf-focused .rail {
    opacity: 0.5;
  }

  /* Graphite and a hairline, never the accent — a drop preview is
     structure being proposed, not a session asking for something. */
  .drop-preview {
    position: absolute;
    z-index: 3;
    pointer-events: none;
    background: var(--surface-hover);
    border: 1px solid var(--border-strong);
    opacity: 0.9;
  }
  .drop-whole {
    inset: 0;
  }
  .drop-left {
    inset: 0 50% 0 0;
  }
  .drop-right {
    inset: 0 0 0 50%;
  }
  .drop-top {
    inset: 0 0 50% 0;
  }
  .drop-bottom {
    inset: 50% 0 0 0;
  }

  .stack {
    position: relative;
    display: flex;
    flex: 1 1 auto;
    min-height: 0;
    min-width: 0;
    overflow: hidden;
  }

  .pane {
    position: absolute;
    inset: 0;
    display: flex;
  }

  /* `visibility`, never `display`: a hidden pane still lays out, so the
     virtualiser keeps its measurements and revealing one costs nothing.
     Note what is NOT here — `.pane` does not declare `visibility: visible`.
     Visibility inherits, but a descendant that re-declares `visible`
     un-hides ITSELF through a hidden ancestor, so writing it here made
     every pane paint straight through the surface hiding this whole group,
     and the fleet board and the transcripts rendered on top of each other.
     Only the hidden state is ever stated; the visible one is inherited. */
  .pane-hidden {
    visibility: hidden;
    pointer-events: none;
  }
</style>
