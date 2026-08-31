<script lang="ts">
  /**
   * Session pane stacking, shared identity header, and swipe gesture.
   *
   * One pane is kept per open tab. Switching flips `visibility` — nothing
   * unmounts, nothing is measured twice, scroll positions survive.
   *
   * Architecture:
   * - ONE shared SessionHeader sits above the pane stack. Because it is a
   *   single component instance, torph morphs the title, path and pill text
   *   character-by-character on every tab switch — no crossfade, no
   *   remount.
   * - The TRANSCRIPT BODY slides directionally (tab-click or swipe).
   * - The COMPOSER stays static — it is shared structure.
   * - Horizontal swipe on the transcript area navigates between tabs, like
   *   a finance app swiping between months.
   */
  import type { Snippet } from 'svelte';
  import { untrack } from 'svelte';
  import { goto } from '$app/navigation';
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
  } from '$lib/cockpit/client.svelte';
  import { workingSet } from '$lib/cockpit/working-set.svelte';
  import { resolveSessionTitle } from '$lib/cockpit/links';
  import { models, covers, ensureModels } from '$lib/cockpit/models.svelte';
  import { PERMISSION_MODES } from '$lib/cockpit/permission-modes';
  import {
    effortStops as getEffortStops,
    hasEffortScale,
  } from '$lib/cockpit/effort-levels';

  let { children }: { children: Snippet } = $props();

  /* ── Pane management ─────────────────────────────────────────────── */

  interface Pane {
    id: string;
    browsing: string | null;
    cwd: string;
    harness: string;
  }

  const viewId = $derived(page.params.id ?? '');
  const onBoard = $derived(page.url.pathname === '/session');

  /** Slide direction for the transcript body on tab switch (click). */
  let prevViewId = $state(viewId);
  let slideDir = $state<'' | 'left' | 'right'>('');

  $effect.pre(() => {
    const cur = viewId;
    const prev = prevViewId;
    if (cur === prev) return;
    const order = workingSet.order;
    const curIdx = order.indexOf(cur);
    const prevIdx = order.indexOf(prev);
    slideDir = curIdx > prevIdx ? 'left' : curIdx < prevIdx ? 'right' : '';
    prevViewId = cur;
  });

  $effect(() => {
    if (!slideDir) return;
    const id = setTimeout(() => { slideDir = ''; }, 260);
    return () => clearTimeout(id);
  });

  const browsing = $derived(page.url.searchParams.get('machine'));
  const browsingCwd = $derived(page.url.searchParams.get('cwd') ?? '');
  const browsingHarness = $derived(page.url.searchParams.get('harness') ?? 'claude');

  let panes = $state<Pane[]>(
    viewId ? [{ id: viewId, browsing, cwd: browsingCwd, harness: browsingHarness }] : []
  );

  $effect.pre(() => {
    const id = viewId;
    if (!id) return;
    const machineId = browsing;
    const cwd = browsingCwd;
    const harness = browsingHarness;
    untrack(() => {
      workingSet.visit(id, { machine: machineId, cwd, harness });
      const held = panes.find((pane) => pane.id === id);
      if (!held) {
        panes.push({ id, browsing: machineId, cwd, harness });
        return;
      }
      if (machineId && !held.browsing) {
        held.browsing = machineId;
        held.cwd = cwd;
        held.harness = harness;
      }
    });
  });

  $effect(() => {
    const open = new Set(workingSet.order);
    const id = viewId;
    untrack(() => {
      const keep = panes.filter((pane) => pane.id === id || open.has(pane.id));
      if (keep.length !== panes.length) panes = keep;
    });
  });

  $effect(() => {
    syncSubscriptions();
  });

  /* ── Per-pane view state (chat / flow) ───────────────────────────── */

  let views = $state<Record<string, 'chat' | 'flow'>>({});

  /* ── Shared header data ──────────────────────────────────────────── */
  /* Computed from the cockpit store for the active viewId, fed to
     the ONE SessionHeader instance so torph can morph the text. */

  const session = $derived(cockpit.session(viewId) ?? null);
  const machineId = $derived(cockpit.session(viewId)?.machineId ?? '');

  const machineName = $derived(
    cockpit.machines.find((m) => m.machineId === machineId)?.hostname ?? machineId
  );

  const title = $derived(
    resolveSessionTitle({
      title: cockpit.instances.find((i) => i.id === viewId)?.title,
      firstMessage: session?.messages.find(
        (m) => m.type === 'user' && m.content.trim()
      )?.content,
      cwd: session?.cwd || browsingCwd,
      id: viewId,
    })
  );

  const stats = $derived(cockpit.statsOf(viewId));
  const activity = $derived(cockpit.activityOf(viewId));

  const machineRow = $derived(
    cockpit.machines.find((m) => m.machineId === machineId) ?? null
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
  const harnessEffort = $derived(
    harnessReport?.capabilities.effort !== false
  );
  const showEffort = $derived(harnessEffort && hasEffortScale(chosenModel));
  const effortStopsForModel = $derived(getEffortStops(chosenModel));

  $effect(() => { ensureModels(); });

  function onmodel(model: string): SettingChange {
    if (!machineId) return null;
    return submitCommand(viewId, machineId, 'set-model', { model });
  }
  function onpermission(mode: PermissionMode): SettingChange {
    if (!machineId) return null;
    if (mode === 'bypassPermissions')
      return relaunchSession(viewId, machineId, mode);
    return submitCommand(viewId, machineId, 'set-permission-mode', { mode });
  }
  function oneffort(level: EffortLevel): SettingChange {
    if (!machineId) return null;
    return submitCommand(viewId, machineId, 'set-effort', { effort: level });
  }

  /* ── Swipe gesture ───────────────────────────────────────────────── */
  /* Horizontal swipe on the transcript body navigates between tabs.
     The adjacent pane appears flush — "it was always there" — and the
     finger's delta drives both panes in lockstep.

     The gesture is ignored on interactive elements, the composer, and
     horizontally scrollable containers (code blocks). */

  type SwipePhase = 'idle' | 'tracking' | 'decided' | 'releasing';

  let containerEl = $state<HTMLDivElement | null>(null);
  let swipePhase = $state<SwipePhase>('idle');
  let swipeDelta = $state(0);
  let swipeTargetId = $state<string | null>(null);
  let swipeDirection = $state<'left' | 'right' | null>(null);
  let swipeContainerWidth = $state(0);
  let swipeCompleting = $state(false);

  // Touch tracking (not reactive — only read inside handlers)
  let touchStartX = 0;
  let touchStartY = 0;
  let touchSamples: Array<{ x: number; t: number }> = [];

  /**
   * Whether this touch target should suppress the swipe.
   *
   * Interactive controls, the composer, and horizontally scrollable
   * containers (code blocks with overflow) are all off-limits. The
   * swipe fires only on the transcript body — the biggest unadorned
   * surface in the pane.
   */
  function shouldIgnoreSwipe(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return true;
    // Only allow swipe inside the transcript-slide area
    if (!target.closest('.transcript-slide')) return true;
    // Not on interactive controls
    if (
      target.closest(
        'button, a, input, textarea, select, [contenteditable="true"], ' +
        '[role="button"], [role="link"], [role="tab"], .composer'
      )
    ) return true;
    // Not inside horizontally scrollable containers
    let node: HTMLElement | null = target;
    const fence = target.closest('.transcript-slide');
    while (node && node !== fence) {
      const style = getComputedStyle(node);
      if (
        (style.overflowX === 'auto' || style.overflowX === 'scroll') &&
        node.scrollWidth > node.clientWidth + 1
      ) return true;
      node = node.parentElement;
    }
    return false;
  }

  function handleTouchStart(e: TouchEvent) {
    if (swipePhase !== 'idle' || onBoard) return;
    if (shouldIgnoreSwipe(e.target)) return;
    const touch = e.touches[0];
    touchStartX = touch.clientX;
    touchStartY = touch.clientY;
    touchSamples = [{ x: touch.clientX, t: performance.now() }];
    swipePhase = 'tracking';
  }

  function handleTouchMove(e: TouchEvent) {
    if (swipePhase !== 'tracking' && swipePhase !== 'decided') return;
    const touch = e.touches[0];
    const dx = touch.clientX - touchStartX;
    const dy = touch.clientY - touchStartY;

    // Record sample for release velocity
    const now = performance.now();
    touchSamples.push({ x: touch.clientX, t: now });
    if (touchSamples.length > 5) touchSamples.shift();

    if (swipePhase === 'tracking') {
      // Need a minimum displacement before committing
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      // Vertical-dominant → it's a scroll, bail out
      if (Math.abs(dy) > Math.abs(dx) * 0.7) {
        swipePhase = 'idle';
        return;
      }
      // Decide it's a horizontal swipe
      const dir: 'left' | 'right' = dx < 0 ? 'left' : 'right';
      const step = dir === 'left' ? 1 : -1;
      const fallback = cockpit.instances.map((i) => i.id);
      const target = workingSet.step(viewId, step, fallback);
      if (!target || !containerEl) {
        swipePhase = 'idle';
        return;
      }
      swipeDirection = dir;
      swipeTargetId = target;
      swipeContainerWidth = containerEl.clientWidth;
      swipePhase = 'decided';
      // fall through to update delta
    }

    // Prevent vertical scroll once we own the gesture
    e.preventDefault();

    // Clamp: can't overshoot the adjacent pane
    if (swipeDirection === 'left') {
      swipeDelta = Math.max(Math.min(dx, 0), -swipeContainerWidth);
    } else {
      swipeDelta = Math.min(Math.max(dx, 0), swipeContainerWidth);
    }
  }

  function handleTouchEnd() {
    if (swipePhase === 'tracking') {
      swipePhase = 'idle';
      return;
    }
    if (swipePhase !== 'decided') return;

    // Release velocity (px/ms)
    let velocity = 0;
    if (touchSamples.length >= 2) {
      const first = touchSamples[0];
      const last = touchSamples[touchSamples.length - 1];
      const dt = last.t - first.t;
      if (dt > 0) velocity = (last.x - first.x) / dt;
    }

    const ratio = Math.abs(swipeDelta) / swipeContainerWidth;
    const fast =
      swipeDirection === 'left' ? velocity < -0.3 : velocity > 0.3;
    const far = ratio > 0.3;

    releaseSwipe(far || fast);
  }

  function handleTouchCancel() {
    if (swipePhase === 'decided') releaseSwipe(false);
    else swipePhase = 'idle';
  }

  function releaseSwipe(complete: boolean) {
    swipeCompleting = complete;
    swipePhase = 'releasing';

    // Set the final delta — the CSS transition animates from current
    // position to this target.
    swipeDelta = complete
      ? swipeDirection === 'left' ? -swipeContainerWidth : swipeContainerWidth
      : 0;

    const duration = complete ? 300 : 250;

    setTimeout(() => {
      if (complete && swipeTargetId) {
        // Prevent the tab-click slideDir from firing on this navigation
        prevViewId = swipeTargetId;

        // Build the URL with stored-session context if needed
        const targetPane = panes.find((p) => p.id === swipeTargetId);
        let url = `/session/${swipeTargetId}`;
        if (targetPane?.browsing) {
          const q = new URLSearchParams();
          q.set('machine', targetPane.browsing);
          q.set('cwd', targetPane.cwd);
          q.set('harness', targetPane.harness);
          url += `?${q.toString()}`;
        }
        void goto(url, { noScroll: true });
      }
      // Reset
      swipePhase = 'idle';
      swipeDelta = 0;
      swipeTargetId = null;
      swipeDirection = null;
      swipeCompleting = false;
    }, duration);
  }

  /**
   * Svelte action: registers non-passive touch listeners so the swipe
   * handler can call `preventDefault` on touchmove once it owns the
   * gesture. Passive touchstart is fine — only touchmove needs the opt-out.
   */
  function swipeable(node: HTMLElement) {
    node.addEventListener('touchstart', handleTouchStart, { passive: true });
    node.addEventListener('touchmove', handleTouchMove, { passive: false });
    node.addEventListener('touchend', handleTouchEnd, { passive: true });
    node.addEventListener('touchcancel', handleTouchCancel, { passive: true });
    return {
      destroy() {
        node.removeEventListener('touchstart', handleTouchStart);
        node.removeEventListener('touchmove', handleTouchMove);
        node.removeEventListener('touchend', handleTouchEnd);
        node.removeEventListener('touchcancel', handleTouchCancel);
      },
    };
  }

  /* ── Derived pane transform helpers ─────────────────────────────── */

  function paneTransform(paneId: string, isActive: boolean): string {
    if (swipePhase === 'idle') return '';
    if (swipePhase === 'tracking') return '';
    if (isActive) return `translateX(${swipeDelta}px)`;
    if (paneId === swipeTargetId) {
      const sign = swipeDirection === 'left' ? 1 : -1;
      return `translateX(${sign * swipeContainerWidth + swipeDelta}px)`;
    }
    return '';
  }
</script>

<!-- Shared SessionHeader — one instance, torph morphs text across tab switches.
     Conditional on viewId (not session) so the header stays on screen during
     the brief window between navigation and session-store population. -->
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

<div
  class="pane-stack relative min-h-0 min-w-0 flex-1 overflow-hidden"
  bind:this={containerEl}
  use:swipeable
>
  <div
    class="pane absolute inset-0 flex"
    class:pane-hidden={!onBoard}
    inert={!onBoard}
  >
    <FleetBoard active={onBoard} />
  </div>

  {#each panes as pane (pane.id)}
    {@const isActive = pane.id === viewId && !onBoard}
    {@const isSwipeTarget =
      swipePhase !== 'idle' && pane.id === swipeTargetId}
    {@const shouldShow = isActive || isSwipeTarget}
    <div
      class="pane absolute inset-0 flex"
      class:pane-hidden={!shouldShow}
      class:pane-swiping={swipePhase === 'decided' && shouldShow}
      class:pane-releasing={swipePhase === 'releasing' && shouldShow}
      inert={!isActive && !isSwipeTarget}
      style:transform={paneTransform(pane.id, isActive)}
    >
      <SessionPane
        viewId={pane.id}
        browsing={pane.browsing}
        browsingCwd={pane.cwd}
        browsingHarness={pane.harness}
        active={isActive}
        slideDir={swipePhase !== 'idle' ? '' : (shouldShow && !isSwipeTarget ? slideDir : '')}
        hideHeader
        view={views[pane.id] ?? 'chat'}
        onview={(v) => (views[pane.id] = v)}
        forceVisible={isSwipeTarget}
      />
    </div>
  {/each}

  {@render children()}
</div>

<style>
  /* Pane visibility: only the active pane (and the swipe target during
     a gesture) is shown. The header lives above the stack — from the
     user's perspective it persists while torph morphs the text. */
  .pane {
    opacity: 1;
    visibility: visible;
  }

  .pane-hidden {
    visibility: hidden;
    pointer-events: none;
  }

  /* During active drag: no CSS transition — the transform tracks the
     finger directly. `will-change` promotes the layer so the compositor
     handles the translation. */
  .pane-swiping {
    transition: none !important;
    will-change: transform;
  }

  /* On release: animate to the final position (snap to place or
     snap back) with the Apple-recommended deceleration curve.
     Duration is set by the JS (300ms complete, 250ms cancel). */
  .pane-releasing {
    transition: transform 300ms cubic-bezier(0.16, 1, 0.3, 1);
    will-change: transform;
  }

  @media (prefers-reduced-motion: reduce) {
    .pane,
    .pane-hidden,
    .pane-swiping,
    .pane-releasing {
      transition: none !important;
    }
  }
</style>
