<script lang="ts">
  import type { EffortLevel, PermissionMode } from "@whiffle/core";
  /**
   * One group: a strip of tabs, the identity bar for whichever is showing,
   * and a slot per conversation stacked behind it.
   *
   * This is the unit the grid splits. Everything that used to be "the session
   * layout" lives here now, once per group rather than once per app, which is
   * what lets two conversations be worked in side by side. The conversations
   * themselves are not this group's to mount: `PaneHost` keeps each one
   * alive once and docks it into the slot here, so a split, a move or a
   * change of grid rearranges the DOM without rebuilding a transcript.
   *
   * The header stays ONE instance per group on purpose. Because there is one
   * of it and its text comes from synchronous state, torph morphs the title
   * character by character when the group changes tab, instead of the bar
   * being torn down and rebuilt. Give each tab its own header and that
   * disappears.
   */
  import { untrack } from "svelte";
  import { browser } from "$app/environment";
  import { page } from "$app/state";
  import {
    commandRecord,
    type HistorySource,
    relaunchSession,
    streamCapable,
    submitCommand,
    whiffle,
  } from "../client.svelte";
  import {
    effortStops as getEffortStops,
    hasEffortScale,
  } from "../effort-levels";
  import { covers, ensureModels, models } from "../models.svelte";
  import { PERMISSION_MODES } from "../permission-modes";
  import SessionPane from "../SessionPane.svelte";
  import { sessionName } from "../session-name";
  import SessionHeader, {
    type SettingChange,
  } from "../transcript/SessionHeader.svelte";
  import { dropHint, paneDropTarget } from "./dnd.svelte";
  import { paneViews, slot } from "./dock.svelte";
  import { createSwipe } from "./gesture.svelte";
  import PaneTabs from "./PaneTabs.svelte";
  import { contextOf, type LeafNode, workspace } from "./workspace.svelte";

  let {
    leaf,
    swipeable = false,
  }: {
    leaf: LeafNode;
    /** Only the phone's single group takes the swipe. */
    swipeable?: boolean;
  } = $props();

  const swipe = createSwipe(() => leaf.id);

  /** What a drop hovering this group would do, if anything. */
  const splitEdge = $derived(dropHint.splits(leaf.id));
  const joins = $derived(dropHint.joins(leaf.id));

  const viewId = $derived(leaf.active ?? "");
  const activeIndex = $derived(leaf.tabs.indexOf(viewId));
  /** A pane's distance from the active tab along the strip; nowhere, with no tab showing. */
  const deltaOf = (paneId: string) =>
    activeIndex < 0 ? Number.NaN : leaf.tabs.indexOf(paneId) - activeIndex;
  /** Whether the reader's keyboard belongs to this group. */
  const isFocusedLeaf = $derived(workspace.focusedLeafId === leaf.id);

  /**
   * Which conversation the header NAMES — the swipe's target once a drag has
   * passed the point it would commit at, so the title morphs while the finger
   * is still moving and morphs back if the drag retreats.
   */
  const headerId = $derived(swipe.previewId ?? viewId);

  /* ── Slots ─────────────────────────────────────────────────────────
     Opened on first sight and kept, so returning to a tab is free. The
     conversations either side are asked for ahead of time, which is what
     makes a swipe reveal something rather than nothing. */

  // Seeded with the showing tab so the server and the first client render
  // agree; later tabs are added by the effects below.
  let mounted = $state<string[]>(
    untrack(() => (leaf.active ? [leaf.active] : []))
  );

  $effect.pre(() => {
    const id = viewId;
    if (!id) {
      return;
    }
    untrack(() => {
      if (!mounted.includes(id)) {
        mounted.push(id);
      }
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
    if (!swipeable) {
      return;
    }
    const here = leaf.active;
    if (!here) {
      return;
    }
    const neighbours = [
      workspace.step(here, 1, leaf.id),
      workspace.step(here, -1, leaf.id),
    ];
    const warm = setTimeout(() => {
      untrack(() => {
        for (const id of neighbours) {
          if (id && !mounted.includes(id)) {
            mounted.push(id);
          }
        }
      });
    }, 120);
    return () => clearTimeout(warm);
  });

  $effect(() => {
    const open = new Set(leaf.tabs);
    untrack(() => {
      const keep = mounted.filter((id) => open.has(id));
      if (keep.length !== mounted.length) {
        mounted = keep;
      }
    });
  });

  /* ── The header's data ──────────────────────────────────────────── */

  const session = $derived(whiffle.session(headerId) ?? null);
  const machineId = $derived(whiffle.session(headerId)?.machineId ?? "");
  const headerCtx = $derived(contextOf(headerId));

  const machineName = $derived(
    whiffle.machines.find((m) => m.machineId === machineId)?.hostname ??
      machineId
  );

  const servedNames = $derived(
    (page.data as { names?: Record<string, string> }).names ?? {}
  );
  const title = $derived(sessionName(headerId, servedNames).label);

  const stats = $derived(whiffle.statsOf(headerId));
  const activity = $derived(whiffle.activityOf(headerId));

  const machineRow = $derived(
    whiffle.machines.find((m) => m.machineId === machineId) ?? null
  );
  const harnessReport = $derived(
    machineRow?.harnesses?.find(
      (report) => report.harness === session?.harness
    ) ?? null
  );
  const offeredModes = $derived(
    harnessReport
      ? PERMISSION_MODES.filter((mode) =>
          harnessReport.capabilities.permissionModes.includes(mode.value)
        )
      : PERMISSION_MODES
  );
  const chosenModel = $derived(
    session?.model
      ? (models.offered.find((row) => covers(row, session.model!)) ?? null)
      : null
  );
  const harnessEffort = $derived(harnessReport?.capabilities.effort !== false);
  const showEffort = $derived(harnessEffort && hasEffortScale(chosenModel));
  const effortStopsForModel = $derived(getEffortStops(chosenModel));

  // One more attempt each time a session comes up, and on nothing else: the
  // store's own reads are untracked so a failed ask cannot re-run this.
  $effect(() => {
    void whiffle.runningInstances.length;
    untrack(ensureModels);
  });

  function onmodel(model: string): SettingChange {
    if (!machineId) {
      return null;
    }
    return submitCommand(headerId, machineId, "set-model", { model });
  }
  function onpermission(mode: PermissionMode): SettingChange {
    if (!machineId) {
      return null;
    }
    if (mode === "bypassPermissions") {
      return relaunchSession(headerId, machineId, mode);
    }
    return submitCommand(headerId, machineId, "set-permission-mode", { mode });
  }
  function oneffort(level: EffortLevel): SettingChange {
    if (!machineId) {
      return null;
    }
    return submitCommand(headerId, machineId, "set-effort", { effort: level });
  }
</script>

<!-- The whole group answers to a click by taking focus, so typing goes where
     the reader just looked. `focusin` rather than `click`: reaching the
     composer with the keyboard should move focus too. -->
<section
  class="leaf"
  onfocusincapture={() => workspace.focus(leaf.id)}
  onpointerdowncapture={() => workspace.focus(leaf.id)}
  class:leaf-focused={isFocusedLeaf}
>
  <!-- The focus mark is graphite, never the accent: the one loud colour in
       this product means a session is asking for something, and "you are
       typing here" must not compete with it. -->
  <span aria-hidden="true" class="rail"></span>

  <PaneTabs {leaf} />

  {#if viewId}
    <SessionHeader
      {activity}
      cost={stats.cost}
      cwd={session?.cwd || headerCtx?.cwd || ''}
      effort={session?.effort ?? null}
      effortStops={effortStopsForModel}
      harness={session?.harness ?? headerCtx?.harness ?? 'claude'}
      {harnessEffort}
      {machineName}
      maxTokens={stats.maxTokens}
      mcpCount={session?.mcp?.length ?? null}
      model={session?.model ?? null}
      {offeredModes}
      {oneffort}
      {onmodel}
      {onpermission}
      onview={(v) => (paneViews[headerId] = v)}
      permissionMode={session?.permissionMode ?? null}
      seed={session?.cwd || headerCtx?.cwd || headerId}
      {showEffort}
      streaming={streamCapable()}
      {title}
      totalTokens={stats.totalTokens}
      trackedCommand={commandRecord}
      turns={stats.turns}
      view={paneViews[headerId] ?? 'chat'}
    />
  {/if}

  <!-- Where a dropped conversation would go, shown as the shape it would
       take: half the group when a split is on offer, the whole of it when
       the drop would simply join these tabs. The indicator and the hitbox
       read the same 25% band, so the picture cannot promise something the
       drop will not do. -->
  {#if splitEdge}
    <div aria-hidden="true" class="drop-preview drop-{splitEdge}"></div>
  {:else if joins}
    <div aria-hidden="true" class="drop-preview drop-whole"></div>
  {/if}

  <!-- Where the strip can be swiped, the two neighbours are parked either
       side at rest — painted, and building their rows — so a swipe reveals
       a current transcript rather than one that paints on the claim frame.
       A pointer cannot swipe, so elsewhere only the active pane is shown. -->
  <div class="stack" use:swipe.action={swipeable} use:paneDropTarget={leaf.id}>
    {#each mounted as paneId (paneId)}
      {@const isActive = paneId === viewId}
      {@const delta = deltaOf(paneId)}
      {@const shown = isActive || (swipeable && Math.abs(delta) <= 1)}
      {@const ctx = contextOf(paneId)}
      <div
        class="pane"
        data-delta={delta}
        data-pane={paneId}
        inert={!isActive}
        class:pane-hidden={!shown}
        use:slot={{ id: paneId, shown }}
      >
        <!-- The server paints the conversation here so a reload shows it
             before the bundle runs; on hydration this branch is dropped and
             PaneHost mounts the live pane into the slot. -->
        {#if !browser}
          <SessionPane
            browsing={ctx?.machine ?? null}
            browsingCwd={ctx?.cwd ?? ''}
            browsingHarness={ctx?.harness ?? 'claude'}
            focused={false}
            hideHeader
            onview={() => {}}
            serverHistory={paneId === page.params.id
              ? ((page.data as { history?: Promise<HistorySource | null> | null }).history ?? null)
              : null}
            serverTail={paneId === page.params.id
              ? ((page.data as { tail?: unknown }).tail ?? null)
              : null}
            view={paneViews[paneId] ?? 'chat'}
            viewId={paneId}
            visible={shown}
          />
        {/if}
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
  /* Parked by delta, flush, so the seam between two panes never shows. The
     swipe writes its travel inline over these and clears it after; only a
     pane that can be seen is promised to the compositor. */
  .pane:not(.pane-hidden) {
    will-change: transform;
  }
  .pane[data-delta="-1"] {
    transform: translate3d(-100%, 0, 0);
  }
  .pane[data-delta="0"] {
    transform: translate3d(0, 0, 0);
  }
  .pane[data-delta="1"] {
    transform: translate3d(100%, 0, 0);
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
