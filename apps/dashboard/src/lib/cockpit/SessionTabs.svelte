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
    IconStop,
  } from '$lib/icons';
  import { isTyping } from '$lib/utils/typing';
  import ActivityDot from './ActivityDot.svelte';
  import {
    backfillSession,
    cockpit,
    forkSession,
    openSession,
    openTranscript,
    stopSession,
  } from './client.svelte';
  import { copyToClipboard } from './copy';
  import { identityVar } from './identity';
  import { sessionTitle } from './links';
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
  const routeId = $derived(page.params?.id ?? '');
  const onFleet = $derived(page.url.pathname === '/session');

  /** The tab just clicked. `page` only names it once the router has finished,
   *  and a tab that highlights a frame late reads as the click being ignored. */
  let pending = $state<string | null>(null);
  const currentId = $derived(pending ?? routeId);

  function navigate(id: string) {
    if (id === currentId) return;
    pending = id;
    // The session owns its own scroll and its own focus; letting the router
    // reset either is the rest of the "full navigation" feel.
    void goto(`/session/${id}`, { noScroll: true, keepFocus: true }).finally(
      () => (pending = null)
    );
  }

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

  /** Where the strip goes when the tab being closed is the one on screen: the
   *  neighbour to the right, then the left, then the board. */
  function closeTab(id: string) {
    const at = tabs.findIndex((tab) => tab.id === id);
    const next = tabs[at + 1] ?? tabs[at - 1] ?? null;
    workingSet.forget(id);
    if (id !== currentId) return;
    void goto(next ? `/session/${next.id}` : '/session');
  }

  function closeOthers(id: string) {
    for (const tab of tabs.filter((tab) => tab.id !== id)) workingSet.forget(tab.id);
    navigate(id);
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
    if (next) navigate(next);
  }

  /** The strip scrolls rather than squeezing its tabs, so a tab reached with
   *  `]` or a swipe has to be brought back into view. Instant, and it moves the
   *  strip's own scroll — no tab changes place. */
  let strip = $state<HTMLElement | null>(null);
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
</script>

<svelte:window onkeydown={handleGlobalKeydown} />

{#if tabs.length > 0}
  <div
    bind:this={strip}
    role="tablist"
    aria-label="Open sessions"
    class="no-scrollbar flex shrink-0 items-end gap-0.5 overflow-x-auto border-b border-border/60 px-2 pt-1"
  >
    <a href="/session" role="tab" aria-selected={onFleet} class="{TAB} {onFleet ? ACTIVE : IDLE}">
      <IconColumns class="size-4" />
      Fleet
    </a>

    {#each visible as tab (tab.id)}
      {@const active = tab.id === currentId}
      {@const project = projectFor(tab)}
      <ContextMenu.Root>
        <ContextMenu.Trigger class="contents">
          <div
            role="tab"
            data-tab={tab.id}
            aria-selected={active}
            tabindex={active ? 0 : -1}
            style={identityVar(tab.cwd)}
            class="{TAB} max-w-[200px] cursor-default {active ? ACTIVE : IDLE}"
            onclick={() => navigate(tab.id)}
            onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(tab.id); } else { handleTabKeydown(e); } }}
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
    {/each}

    {#if overflow.length > 0}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger class="{TAB} {IDLE}">
          +{overflow.length}
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="start">
          {#each overflow as tab (tab.id)}
            <DropdownMenu.Item onSelect={() => navigate(tab.id)}>
              <ActivityDot activity={tab.activity} size={1.5} />
              <span class="truncate">{tab.title}</span>
            </DropdownMenu.Item>
          {/each}
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    {/if}
  </div>
{/if}
