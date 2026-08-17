<script lang="ts">
  /**
   * The strip of open conversations, at the top of the working area rather than
   * in the chrome: the tabs and the thing they open are one surface, so the
   * strip is drawn on the canvas with a seam under it, not in chrome material
   * (user, 2026-08-08).
   *
   * Browser grammar throughout. The order is insertion order and it never
   * re-ranks, so clicking a tab moves nothing on screen — no tab travels, and
   * there is no reorder to animate. Fleet leads it as the fixed first tab, the
   * way back to the board.
   */
import { flip } from 'svelte/animate';
import { SvelteSet } from 'svelte/reactivity';
import { dndzone, SHADOW_ITEM_MARKER_PROPERTY_NAME, type DndEvent } from 'svelte-dnd-action';
import { page } from '$app/state';
import { goto } from '$app/navigation';
import * as ContextMenu from '$lib/components/ui/context-menu';
import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
import {
  IconClose,
  IconColumns,
  IconCopy,
  IconFolder,
  IconFork,
  IconPlus,
  IconStop,
} from '$lib/icons';
import { isTyping } from '$lib/utils/typing';
import ActivityDot from './ActivityDot.svelte';
import SpawnPanel from './SpawnPanel.svelte';
  import {
    backfillSession,
    cockpit,
    forkSession,
    openSession,
    openTranscript,
    stopSession,
  } from './client.svelte';
  import { copyToClipboard } from './copy';
import { identityVar } from './folder-prefs.svelte';
import { sessionTitle } from './links';
import { flipDurationMs } from './motion.svelte';
import { workingSet } from './working-set.svelte';

  const MAX_VISIBLE = 6;

  interface Tab {
    id: string;
    title: string;
    cwd: string;
    machineId: string;
    /** A running instance, as opposed to a stored transcript being read. */
    live: boolean;
    activity: ReturnType<typeof cockpit.activityOf>;
  }

  type DragTab = Tab & { [SHADOW_ITEM_MARKER_PROPERTY_NAME]?: boolean };

  function resolveTab(id: string): Tab | null {
    const instance = cockpit.listedInstances.find((row) => row.id === id);
    if (instance) {
      const leaf = instance.cwd.split('/').filter(Boolean).pop() ?? instance.id;
      const stored = cockpit
        .catalogOf(instance.machineId)
        .find((info) => info.sessionId === instance.sessionId);
      return {
        id,
        title: stored ? sessionTitle(stored) : leaf,
        cwd: instance.cwd,
        machineId: instance.machineId,
        live: true,
        activity: cockpit.activityOf(id),
      };
    }
    const session = cockpit.session(id);
    if (session) {
      const leaf = session.cwd.split('/').filter(Boolean).pop() ?? id.slice(0, 8);
      return {
        id,
        title: leaf,
        cwd: session.cwd,
        machineId: session.machineId,
        live: false,
        activity: cockpit.activityOf(id),
      };
    }
    return null;
  }

  const tabs = $derived(
    workingSet.order.map(resolveTab).filter((tab): tab is Tab => tab !== null)
  );
  const visible = $derived(tabs.slice(0, MAX_VISIBLE));
  const overflow = $derived(tabs.slice(MAX_VISIBLE));

  let tabDrag = $state<DragTab[] | null>(null);
  const dragItems = $derived<DragTab[]>(tabDrag ?? visible);

  function considerTabs(event: CustomEvent<DndEvent<DragTab>>): void {
    tabDrag = event.detail.items;
  }

  function finalizeTabs(event: CustomEvent<DndEvent<DragTab>>): void {
    tabDrag = null;
    workingSet.reorder(event.detail.items.map((item) => item.id));
  }
  /** The tab just clicked. `page` only names it once the router has finished,
   *  and a tab that highlights a frame late reads as the click being ignored. */
  let pending = $state<string | null>(null);
  const currentPath = $derived(pending ?? page.url.pathname);
  const currentId = $derived(currentPath.startsWith('/session/') ? currentPath.slice(9) : '');
  const onFleet = $derived(currentPath === '/session');

  /**
   * Every tab travels the same way, Fleet included. Each of them is a surface
   * the layout already has mounted, so a click is a switch: the router must not
   * reset the scroll or move the focus, which is the rest of the "full
   * navigation" feel — and Fleet, left as a plain link, was taking both.
   */
  function navigate(path: string) {
    if (path === currentPath) return;
    pending = path;
    void goto(path, { noScroll: true, keepFocus: true }).finally(() => (pending = null));
  }

  const open = (id: string) => navigate(`/session/${id}`);

  /**
   * Every open tab read in, one at a time, behind whatever is on screen.
   *
   * Frames already stream for every session, but a transcript is only fetched
   * when its page asks — so the first click on a tab paid for the read
   * (measured at 90–116ms cold against 10–75ms warm). These are the same calls
   * the session page makes, so a page that arrives on a warmed session finds
   * its own guards already satisfied and renders on the frame.
   */
  async function warm(tab: Tab): Promise<void> {
    const target = cockpit.session(tab.id);
    if (target && (target.messages.length > 0 || target.loading)) return;
    if (tab.live) {
      openSession(tab.id);
      await backfillSession(tab.id);
      return;
    }
    if (!tab.machineId) return;
    await openTranscript({
      viewId: tab.id,
      machineId: tab.machineId,
      sessionId: tab.id,
      cwd: tab.cwd,
      harness: cockpit.session(tab.id)?.harness ?? 'claude',
    });
  }

  /** One read at a time: ten transcripts at once would starve the live one. */
  let queue: Promise<void> = Promise.resolve();

  function warmTabs(): void {
    queue = queue.then(async () => {
      for (const tab of tabs) {
        if (tab.id === currentId) continue;
        await warm(tab);
      }
    });
  }

  /** Which tabs there are, not what they are doing — a key that changed with
   *  every activity tick would re-arm the idle callback forever. */
  const warmKey = $derived(`${workingSet.order.join(' ')}|${cockpit.listedInstances.length}`);

  $effect(() => {
    if (!warmKey) return;
    // After the page has settled, not during it: the session on screen gets the
    // socket and the first paint to itself.
    if (typeof requestIdleCallback === 'function') {
      const handle = requestIdleCallback(warmTabs, { timeout: 2000 });
      return () => cancelIdleCallback(handle);
    }
    const handle = setTimeout(warmTabs, 600);
    return () => clearTimeout(handle);
  });

  /** Tabs whose exit animation is in flight — removed after it finishes.
   *  A `SvelteSet` so `closing.has(id)` in the template is reactive: a plain
   *  `Set` never triggers, and the `tab-exiting` class never applies. */
  const closing = new SvelteSet<string>();

  /** The exit animation duration — CSS keyframes and the removal delay share it. */
  const TAB_EXIT_MS = 300;

  /** Where the strip goes when the tab being closed is the one on screen: the
   *  neighbour to the right, then the left, then the board. */
  function closeTab(id: string) {
    if (closing.has(id)) return;

    // Capture the tab wrapper's width BEFORE the class triggers the animation,
    // so the CSS `width` property can interpolate from this value to 0. Without
    // an explicit starting width, `width: auto → 0` is not animatable and the
    // `+` button snaps instead of sliding.
    const wrapper = strip?.querySelector(`[data-tab="${id}"]`)?.closest<HTMLElement>('[data-tab-wrapper]');
    if (wrapper) {
      wrapper.style.width = `${wrapper.getBoundingClientRect().width}px`;
    }

    closing.add(id);

    // Navigate away immediately so the next tab is active while the old one fades.
    const at = tabs.findIndex((tab) => tab.id === id);
    const next = tabs[at + 1] ?? tabs[at - 1] ?? null;
    if (id === currentId) {
      navigate(next ? `/session/${next.id}` : '/session');
    }

    // Remove after the CSS exit animation finishes — FLIP then fills the gap.
    setTimeout(() => {
      closing.delete(id);
      workingSet.forget(id);
    }, TAB_EXIT_MS);
  }

  function closeOthers(id: string) {
    for (const tab of tabs.filter((tab) => tab.id !== id)) workingSet.forget(tab.id);
    open(id);
  }

  /** The registered project this session belongs to — the board's own rule for
   *  which sessions a project owns, read backwards. */
  function projectFor(tab: Tab) {
    return cockpit.projects.find((project) =>
      cockpit.liveIn(project).some((row) => row.id === tab.id)
    );
  }

  async function fork(tab: Tab) {
    const target = cockpit.session(tab.id);
    if (!target?.sessionId) return;
    const instanceId = forkSession({
      machineId: target.machineId,
      cwd: target.cwd,
      sessionId: target.sessionId,
      harness: target.harness,
      history: target.messages,
    });
    await goto(`/session/${instanceId}`);
  }

  /** A branch needs the whole conversation, which a transcript still arriving
   *  does not have — the same bar the session header's Fork sets. */
  function forkable(tab: Tab): boolean {
    const target = cockpit.session(tab.id);
    return Boolean(target?.sessionId) && !target?.loading && !target?.hydrating;
  }

  function handleTabKeydown(event: KeyboardEvent) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const target = event.currentTarget as HTMLElement;
    const tablist = target.closest('[role="tablist"]');
    if (!tablist) return;
    const buttons = [...tablist.querySelectorAll<HTMLElement>('[role="tab"]')];
    const at = buttons.indexOf(target);
    const next = event.key === 'ArrowRight' ? (at + 1) % buttons.length : (at - 1 + buttons.length) % buttons.length;
    buttons[next]?.focus();
  }

  /** The fallback list for stepping when the working set is thin. */
  const fallbackIds = $derived(cockpit.listedInstances.map((row) => row.id));

  function handleGlobalKeydown(event: KeyboardEvent) {
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    if (event.key !== '[' && event.key !== ']') return;
    if (isTyping()) return;
    event.preventDefault();
    const by = event.key === ']' ? 1 : -1;
    const next = workingSet.step(currentId, by, fallbackIds);
    if (next) open(next);
  }

  /** The strip scrolls rather than squeezing its tabs, so a tab reached with
   *  `]` or a swipe has to be brought back into view. Instant, and it moves the
   *  strip's own scroll — no tab changes place. */
  let strip = $state<HTMLElement | null>(null);
  let spawnOpen = $state(false);
  $effect(() => {
    const id = currentId;
    if (!strip || !id) return;
    strip
      .querySelector(`[data-tab="${id}"]`)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });

  /** Browser-tab geometry: 36px tall and square-bottomed, so the active tab's
   *  identity underline lands flat on the seam instead of curving up its sides. */
  const TAB =
    'group flex h-9 shrink-0 items-center gap-1.5 rounded-t-lg px-2.5 text-[13px] ' +
    'transition-colors duration-150 ease-out';
  const ACTIVE = 'identity-underline bg-card font-medium text-foreground';
  const IDLE = 'text-muted-foreground hover:bg-accent hover:text-accent-foreground';

  /** The `+` button element, passed to SpawnPanel as its anchor. */
  let spawnBtn = $state<HTMLElement | null>(null);

  /** The entrance animation duration — CSS keyframes and the action share it. */
  const TAB_ENTER_MS = 500;

  /**
   * Tabs the strip has already rendered. A `use:` action that runs on every
   * mount would replay the entrance when `svelte-dnd-action` re-creates DOM
   * elements during a drag — tracking which ids have been seen prevents that.
   * Shadow items (the dnd library's own copies) are never added.
   */
  const seenTabs = new Set<string>();

  /**
   * Paper tab unfolds from behind via CSS class, not a Svelte `in:` transition.
   *
   * `in:` and `animate:flip` on the same keyed `#each` have a timing conflict
   * in Svelte 5: FLIP captures the layout before the `in:` transition applies
   * its starting state, so the element flashes at full size for one frame, then
   * snaps to the start state and animates forward. A `use:` action sets the
   * start styles inline BEFORE the first paint, adds a CSS class that runs the
   * keyframes, and cleans up after itself.
   */
  function tabEnterAction(node: HTMLElement, tabId: string) {
    // Empty string = shadow item (dnd copy); skip it.
    if (!tabId || seenTabs.has(tabId)) return;
    seenTabs.add(tabId);

    // Set the starting state inline so the first paint is small/dark — no flash.
    node.style.transform = 'scaleX(0.92) scaleY(0.3)';
    node.style.transformOrigin = 'bottom center';
    node.style.opacity = '0.4';
    node.style.filter = 'brightness(0.35)';

    // Kick off the CSS keyframes on the next frame so the browser has committed
    // the inline start styles and the animation runs FROM them TO the end state.
    requestAnimationFrame(() => {
      node.classList.add('tab-entering');
      const cleanup = () => {
        node.classList.remove('tab-entering');
        node.style.transform = '';
        node.style.transformOrigin = '';
        node.style.opacity = '';
        node.style.filter = '';
      };
      node.addEventListener('animationend', cleanup, { once: true });
      // Safety: clear inline styles even if animationend never fires.
      setTimeout(cleanup, TAB_ENTER_MS + 50);
    });
  }

</script>

<svelte:window onkeydown={handleGlobalKeydown} />

{#if tabs.length > 0}
  <div
    bind:this={strip}
    role="tablist"
    aria-label="Open sessions"
    class="no-scrollbar flex shrink-0 items-end gap-0.5 overflow-x-auto border-b border-border/60 px-2 pt-1"
  >
    <!-- Still a link, so a modified click opens it the way the browser would;
         a plain one is a tab switch and travels like the rest. Hidden on a
         phone, where the thumb bar owns the verb and three Fleets on one
         screen is two too many. -->
    <a
      href="/session"
      role="tab"
      aria-selected={onFleet}
      class="{TAB} hidden md:flex {onFleet ? ACTIVE : IDLE}"
      onclick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        navigate('/session');
      }}
    >
      <IconColumns class="size-4" />
      Fleet
    </a>

    <div
      use:dndzone={{
        items: dragItems,
        flipDurationMs: flipDurationMs(),
        dropTargetStyle: {},
        type: 'session-tabs',
        dragDisabled: false,
        autoAriaDisabled: true,
        zoneTabIndex: -1,
        zoneItemTabIndex: -1,
        delayTouchStart: true,
      }}
      onconsider={considerTabs}
      onfinalize={finalizeTabs}
      class="flex items-end gap-0.5"
    >
      {#each dragItems as tab (tab.id)}
        {@const active = tab.id === currentId}
        {@const project = projectFor(tab)}
        <div
          data-tab-wrapper={tab.id}
          animate:flip={{ duration: flipDurationMs() }}
          use:tabEnterAction={tab[SHADOW_ITEM_MARKER_PROPERTY_NAME] ? '' : tab.id}
          class="shrink-0 {closing.has(tab.id) ? 'tab-exiting' : ''}"
          onauxclick={(e) => {
            if (e.button === 1) {
              e.preventDefault();
              closeTab(tab.id);
            }
          }}
        >
          <ContextMenu.Root>
            <ContextMenu.Trigger class="contents">
              <div
                role="tab"
                data-tab={tab.id}
                aria-selected={active}
                tabindex={active ? 0 : -1}
                style={identityVar(tab.cwd)}
                class="{TAB} max-w-[200px] cursor-default {active ? ACTIVE : IDLE}"
                onclick={() => open(tab.id)}
                onkeydown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.stopPropagation();
                    open(tab.id);
                  } else {
                    handleTabKeydown(e);
                  }
                }}
              >
                <ActivityDot activity={tab.activity} size={1.5} />
                <span class="truncate">{tab.title}</span>
                <button
                  type="button"
                  tabindex={-1}
                  class="-mr-1.5 flex size-6 shrink-0 items-center justify-center rounded-full opacity-0
                         transition-opacity hover:bg-muted group-hover:opacity-100 {active
                    ? 'opacity-60'
                    : ''}"
                  aria-label="Close {tab.title}"
                  onclick={(e) => { e.stopPropagation(); e.preventDefault(); closeTab(tab.id); }}
                >
                  <IconClose class="size-3.5" />
                </button>
              </div>
            </ContextMenu.Trigger>

            <ContextMenu.Content>
              <ContextMenu.Item onSelect={() => closeTab(tab.id)}>
                <IconClose />
                Close
              </ContextMenu.Item>
              <ContextMenu.Item disabled={tabs.length < 2} onSelect={() => closeOthers(tab.id)}>
                <IconClose />
                Close others
              </ContextMenu.Item>

              <ContextMenu.Separator />

              <ContextMenu.Item disabled={!forkable(tab)} onSelect={() => fork(tab)}>
                <IconFork />
                Fork
              </ContextMenu.Item>
              <ContextMenu.Item
                disabled={!tab.live}
                onSelect={() => stopSession(tab.id, tab.machineId)}
              >
                <IconStop />
                Stop
              </ContextMenu.Item>

              <ContextMenu.Separator />

              {#if project}
                <ContextMenu.Item onSelect={() => goto(`/project/${project.id}`)}>
                  <IconFolder />
                  Open project
                </ContextMenu.Item>
              {/if}
              <ContextMenu.Item
                onSelect={() =>
                  copyToClipboard('Link', `${location.origin}/session/${tab.id}`)}
              >
                <IconCopy />
                Copy link
              </ContextMenu.Item>
            </ContextMenu.Content>
          </ContextMenu.Root>
        </div>
      {/each}
    </div>

    {#if overflow.length > 0}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger class="{TAB} {IDLE}">
          +{overflow.length}
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="start">
          {#each overflow as tab (tab.id)}
            <DropdownMenu.Item onSelect={() => open(tab.id)}>
              <ActivityDot activity={tab.activity} size={1.5} />
              <span class="truncate">{tab.title}</span>
            </DropdownMenu.Item>
          {/each}
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    {/if}

    <button
      bind:this={spawnBtn}
      type="button"
      class="{TAB} {IDLE}"
      aria-label="New session"
      onclick={() => (spawnOpen = true)}
    >
      <IconPlus class="size-4" />
    </button>
  </div>
{/if}

<SpawnPanel open={spawnOpen} onclose={() => (spawnOpen = false)} anchor={spawnBtn} />

<style>
  :global([data-is-dnd-shadow-item-internal]) {
    visibility: visible !important;
    opacity: 0.5;
  }

  .tab-entering {
    animation: tab-enter 500ms cubic-bezier(0.33, 1, 0.68, 1) forwards;
    transform-origin: bottom center;
  }

  @keyframes tab-enter {
    from {
      transform: scaleX(0.92) scaleY(0.3);
      opacity: 0.4;
      filter: brightness(0.35);
    }
    to {
      transform: scaleX(1) scaleY(1);
      opacity: 1;
      filter: brightness(1);
    }
  }

  .tab-exiting {
    animation: tab-exit 300ms cubic-bezier(0.33, 1, 0.68, 1) forwards;
    transform-origin: bottom center;
    pointer-events: none;
    overflow: hidden;
  }

  @keyframes tab-exit {
    to {
      transform: scaleX(0.92) scaleY(0.3);
      opacity: 0;
      filter: brightness(0.35);
      width: 0;
      padding: 0;
      margin: 0;
    }
  }
</style>
