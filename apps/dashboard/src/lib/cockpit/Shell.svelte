<script lang="ts">
  /** The whole chrome: wordmark, hub status, session tabs, and the route. */
  import { IconSidebar, IconSearch, IconShield, IconHelp } from '$lib/icons';
  import type { Snippet } from 'svelte';
  import { fly, scale, slide } from 'svelte/transition';
  import { quintOut } from 'svelte/easing';
  import { afterNavigate } from '$app/navigation';
  import { page } from '$app/state';
  import { browser } from '$app/environment';
  import { Button } from '$lib/components/ui/button';
  import { Kbd } from '$lib/components/ui/kbd';
  import * as Sheet from '$lib/components/ui/sheet';
  import * as SidebarPrimitive from '$lib/components/ui/sidebar';
  import ThemeSwitcher from '$lib/components/ui/ThemeSwitcher.svelte';
  import { cockpit, reconnectNow } from './client.svelte';
  import JumpPalette from './JumpPalette.svelte';
  import SessionTabs from './SessionTabs.svelte';
  import ShortcutSheet from './ShortcutSheet.svelte';
  import Sidebar from './Sidebar.svelte';
  import ThumbBar from './ThumbBar.svelte';

  let { children }: { children: Snippet } = $props();

  let palette = $state(false);
  let shortcuts = $state(false);
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

  const dotLabel = $derived(
    {
      connected: 'Connected',
      connecting: 'Connecting',
      disconnected: 'Disconnected',
      error: 'Connection error',
    }[cockpit.status]
  );

  const blocked = $derived(cockpit.blockedCount);
  const disconnected = $derived(cockpit.status !== 'connected');

  /** The two screens a phone lives on; the rest are read, not worked from. */
  const thumbBar = $derived(page.url.pathname.startsWith('/session'));

  /* ---- Reconnect banner countdown ---- */
  let countdown = $state(0);
  let bannerVisible = $state(false);
  let recoveryFlash = $state(false);
  /** The first connection is not a recovery; the banner only shows after a drop. */
  let wasConnected = $state(false);

  $effect(() => {
    if (cockpit.status === 'connected') {
      if (bannerVisible && wasConnected) {
        recoveryFlash = true;
        setTimeout(() => {
          recoveryFlash = false;
          bannerVisible = false;
        }, 1500);
      } else {
        bannerVisible = false;
      }
      wasConnected = true;
      return;
    }
    if (wasConnected && (cockpit.status === 'disconnected' || cockpit.status === 'error')) {
      bannerVisible = true;
      recoveryFlash = false;
    }
  });

  $effect(() => {
    const retryAt = cockpit.retryAt;
    if (!retryAt || cockpit.status === 'connected') {
      countdown = 0;
      return;
    }
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((retryAt - Date.now()) / 1000));
      countdown = remaining;
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  });
</script>

<svelte:window onkeydown={handleKeydown} />

<JumpPalette bind:open={palette} />
<ShortcutSheet bind:open={shortcuts} />

<div class="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
  <a
    href="#main"
    class="sr-only rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50"
  >
    Skip to content
  </a>

  <header
    class="material-chrome scroll-edge-b relative z-30 flex h-12 shrink-0 items-center gap-3 px-4"
    style="view-transition-name: app-header"
  >
    <Button
      variant="ghost"
      size="icon-xs"
      class="md:hidden"
      aria-label="Machines and sessions"
      aria-expanded={rail}
      onclick={() => (rail = !rail)}
    >
      <IconSidebar />
    </Button>

    <a href="/session" class="text-title shrink-0 text-[17px]">Outpost</a>

    <SessionTabs />

    <div class="ml-auto flex items-center gap-1.5">
      <Button
        variant="ghost"
        size="xs"
        title="Jump to a project, machine, or session"
        onclick={() => (palette = true)}
      >
        <IconSearch />
        <span class="hidden sm:inline">Jump</span>
        <Kbd class="hidden sm:inline-flex">⌘K</Kbd>
      </Button>

      <a
        href="/session"
        class="flex min-h-6 items-center gap-1.5 rounded-lg px-1.5 py-0.5 text-xs transition-colors {blocked >
        0
          ? 'bg-error/10 text-error hover:bg-error/20'
          : 'text-muted-foreground/50 hover:text-muted-foreground'}"
        title="{blocked} session{blocked === 1 ? '' : 's'} awaiting approval"
      >
        <IconShield class="size-3" />
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

      <span class="flex size-6 items-center justify-center" title={dotLabel}>
        <span class="size-2 rounded-full {dot}"></span>
      </span>

      <Button
        variant="ghost"
        size="icon-xs"
        title="Keyboard shortcuts"
        aria-label="Keyboard shortcuts"
        onclick={() => (shortcuts = true)}
      >
        <IconHelp class="size-4" />
      </Button>

      <ThemeSwitcher />
    </div>
  </header>

  <!-- Reconnect banner -->
  {#if bannerVisible}
    <div
      class="relative z-20 flex items-center justify-center gap-3 px-4 py-1.5 text-[13px]
             {recoveryFlash ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'}"
      transition:slide={{ duration: 160, easing: quintOut }}
    >
      {#if recoveryFlash}
        Connected
      {:else}
        <span>Hub connection lost{countdown > 0 ? ` — retrying in ${countdown}s` : ' — retrying…'}</span>
        <Button variant="ghost" size="xs" class="h-6" onclick={reconnectNow}>
          Reconnect now
        </Button>
      {/if}
    </div>
  {/if}

  <SidebarPrimitive.Provider
    class="min-h-0 flex-1"
    style="--sidebar-width: {railWidth}px;"
    open={true}
  >
    <div class="hidden md:flex" style="view-transition-name: app-rail">
      <Sidebar />
    </div>
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

    <Sheet.Root bind:open={rail}>
      <Sheet.Content side="left" class="material-panel w-[85vw] max-w-sm p-0" showCloseButton={false}>
        <Sheet.Title class="sr-only">Navigation</Sheet.Title>
        <Sheet.Description class="sr-only">Machines and sessions</Sheet.Description>
        <Sidebar />
      </Sheet.Content>
    </Sheet.Root>
  </SidebarPrimitive.Provider>

  {#if thumbBar}
    <ThumbBar onjump={() => (palette = true)} />
  {/if}
</div>
