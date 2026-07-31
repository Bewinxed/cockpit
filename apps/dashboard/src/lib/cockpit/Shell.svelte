<script lang="ts">
  /** The whole chrome: wordmark, hub status, machine rail, and the route. */
  import { IconSidebar, IconSearch, IconShield } from '$lib/icons';
  import type { Snippet } from 'svelte';
  import { fly, scale } from 'svelte/transition';
  import { quintOut } from 'svelte/easing';
  import { afterNavigate } from '$app/navigation';
  import { browser } from '$app/environment';
  import * as SidebarPrimitive from '$lib/components/ui/sidebar';
  import ThemeSwitcher from '$lib/components/ui/ThemeSwitcher.svelte';
  import { cockpit } from './client.svelte';
  import JumpPalette from './JumpPalette.svelte';
  import Sidebar from './Sidebar.svelte';

  let { children }: { children: Snippet } = $props();

  let palette = $state(false);
  /** The rail is a drawer on narrow viewports, where it would eat the transcript. */
  let rail = $state(false);

  afterNavigate(() => (rail = false));

  const RAIL_KEY = 'cockpit-rail-width';
  const RAIL_DEFAULT = 288;
  const RAIL_MIN = 216;
  const RAIL_MAX = 520;

  const clampRail = (px: number) => Math.min(RAIL_MAX, Math.max(RAIL_MIN, Math.round(px)));

  function readRailWidth(): number {
    if (!browser) return RAIL_DEFAULT;
    const stored = Number(localStorage.getItem(RAIL_KEY));
    return Number.isFinite(stored) && stored > 0 ? clampRail(stored) : RAIL_DEFAULT;
  }

  let railWidth = $state(readRailWidth());

  /** Only committed widths are persisted, so a drag in progress writes once. */
  function commitRailWidth(px: number): void {
    railWidth = clampRail(px);
    localStorage.setItem(RAIL_KEY, String(railWidth));
  }

  function startResize(event: PointerEvent): void {
    const handle = event.currentTarget as HTMLElement;
    const startX = event.clientX;
    const startWidth = railWidth;
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);

    const move = (e: PointerEvent) => (railWidth = clampRail(startWidth + e.clientX - startX));
    const end = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      commitRailWidth(railWidth);
    };

    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }

  function resizeKeydown(event: KeyboardEvent): void {
    const step = event.shiftKey ? 48 : 16;
    if (event.key === 'ArrowLeft') commitRailWidth(railWidth - step);
    else if (event.key === 'ArrowRight') commitRailWidth(railWidth + step);
    else if (event.key === 'Home') commitRailWidth(RAIL_MIN);
    else if (event.key === 'End') commitRailWidth(RAIL_MAX);
    else return;
    event.preventDefault();
  }

  const TYPING = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

  /** Cmd+K anywhere, except while the user is typing into something. */
  function handleKeydown(event: KeyboardEvent) {
    if (event.key !== 'k' || !(event.metaKey || event.ctrlKey)) return;
    const target = event.target;
    if (target instanceof HTMLElement && (TYPING.has(target.tagName) || target.isContentEditable)) {
      return;
    }
    event.preventDefault();
    palette = true;
  }

  const dot = $derived(
    {
      connected: 'bg-success',
      connecting: 'bg-warning animate-pulse',
      disconnected: 'bg-muted-foreground',
      error: 'bg-error',
    }[cockpit.status]
  );

  const blocked = $derived(cockpit.blockedCount);
</script>

<svelte:window onkeydown={handleKeydown} />

{#if palette}
  <JumpPalette onClose={() => (palette = false)} />
{/if}

<div class="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
  <a
    href="#main"
    class="sr-only rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50"
  >
    Skip to content
  </a>
  <!-- The chrome sits in its own view-transition groups so it holds still
       while the route below it cross-fades. -->
  <header
    class="flex h-10 shrink-0 items-center gap-3 border-b border-border px-3"
    style="view-transition-name: app-header"
  >
    <button
      type="button"
      class="rounded p-1 transition-colors hover:bg-accent hover:text-accent-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring md:hidden"
      aria-label="Machines and sessions"
      aria-expanded={rail}
      onclick={() => (rail = !rail)}
    >
      <IconSidebar class="size-3.5" />
    </button>
    <a href="/session" class="font-mono text-sm font-semibold tracking-tight">COCKPIT</a>
    <button
      type="button"
      class="ml-auto flex min-h-6 items-center gap-1.5 rounded px-1.5 py-0.5 text-[11px] transition-colors hover:bg-accent hover:text-accent-foreground hover:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
      title="Jump to a project, machine, or session (Cmd/Ctrl + K)"
      onclick={() => (palette = true)}
    >
      <IconSearch class="size-3" />
      Jump
    </button>
    <a
      href="/session"
      class="flex min-h-6 items-center gap-1.5 rounded px-1.5 py-0.5 text-[11px] transition-colors {blocked >
      0
        ? 'bg-warning/10 text-warning hover:bg-warning/20'
        : 'text-muted-foreground/50 hover:text-muted-foreground'}"
      title="{blocked} session{blocked === 1 ? '' : 's'} awaiting approval"
    >
      <IconShield class="size-3" />
      <!-- The count is the app's "what needs me" heartbeat: it pops when it
           crosses zero, and the digit re-enters when it changes. -->
      {#if blocked > 0}
        <span
          in:scale={{ duration: 260, start: 0.5, easing: quintOut }}
          out:scale={{ duration: 180, start: 0.75, easing: quintOut }}
        >
          {#key blocked}
            <span class="inline-block" in:fly={{ y: 4, duration: 150, easing: quintOut }}>
              {blocked}
            </span>
          {/key}
        </span>
      {/if}
    </a>
    <span class="flex min-h-6 items-center gap-1.5 text-[11px] text-muted-foreground">
      <span class="size-1.5 rounded-full {dot}"></span>
      {cockpit.status}
    </span>
    <ThemeSwitcher />
  </header>

  <SidebarPrimitive.Provider
    class="min-h-0 flex-1"
    style="--sidebar-width: {railWidth}px;"
    open={true}
  >
    <div class="hidden md:flex" style="view-transition-name: app-rail">
      <Sidebar />
    </div>
    <!-- The rail is sized by --sidebar-width rather than a pane library: the
         min/max here are pixels, and percentage panes would redefine them on
         every viewport change. -->
    <!-- A focusable separator is the ARIA window-splitter widget; the rule below
         only knows the decorative kind. -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Rail width"
      aria-valuenow={railWidth}
      aria-valuemin={RAIL_MIN}
      aria-valuemax={RAIL_MAX}
      tabindex="0"
      class="hidden w-1 shrink-0 cursor-col-resize touch-none transition-colors hover:bg-border focus-visible:bg-ring focus-visible:outline-none md:block"
      onpointerdown={startResize}
      onkeydown={resizeKeydown}
    ></div>
    <main id="main" class="flex min-w-0 flex-1 flex-col overflow-hidden">
      {@render children()}
    </main>

    {#if rail}
      <div class="fixed inset-0 z-40 flex md:hidden">
        <button
          type="button"
          class="absolute inset-0 bg-black/40"
          aria-label="Close navigation"
          onclick={() => (rail = false)}
        ></button>
        <div class="relative flex max-w-[85vw] shadow-lg">
          <Sidebar />
        </div>
      </div>
    {/if}
  </SidebarPrimitive.Provider>
</div>
