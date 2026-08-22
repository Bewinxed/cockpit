<script lang="ts">
  /**
   * The app chrome: the management rail on the left, a slim bar across the top,
   * and everything else underneath. Ported from mocks/v2-fleet.html (`aside` +
   * `main .top`) and mocks/v5-workspace.html (the tab strip).
   *
   * On a phone the rail is a sheet the bar's burger opens; on a desktop it is a
   * resizable column whose width is this browser's, not the fleet's.
   */
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import { afterNavigate } from '$app/navigation';
  import { page } from '$app/state';
  import * as Sheet from '$lib/components/ui/sheet';
  import ThemeSwitcher from '$lib/components/ui/ThemeSwitcher.svelte';
  import { Button } from '$lib/outpost';
  import { IconCommand, IconSearch, IconShield, IconSidebar } from '$lib/icons';
  import { isTyping } from '$lib/utils/typing';
  import { cockpit, hubSocketUrl, reconnectNow } from './client.svelte';
  import JumpPalette from './JumpPalette.svelte';
  import ShortcutSheet from './ShortcutSheet.svelte';
  import Sidebar from './Sidebar.svelte';
  import SessionTabs from './SessionTabs.svelte';
  import ThumbBar from './ThumbBar.svelte';
  import UsageMeter from './UsageMeter.svelte';

  let { children }: { children: import('svelte').Snippet } = $props();

  const RAIL_KEY = 'cockpit-rail-width';
  const RAIL_MIN = 216;
  const RAIL_MAX = 520;
  const RAIL_DEFAULT = 288;

  let railWidth = $state(RAIL_DEFAULT);
  let jumpOpen = $state(false);
  let shortcutsOpen = $state(false);
  let railOpen = $state(false);

  const clamp = (px: number) => Math.min(RAIL_MAX, Math.max(RAIL_MIN, Math.round(px)));

  onMount(() => {
    const stored = Number(localStorage.getItem(RAIL_KEY));
    if (Number.isFinite(stored) && stored > 0) railWidth = clamp(stored);
  });

  function setRail(px: number) {
    railWidth = clamp(px);
    try {
      localStorage.setItem(RAIL_KEY, String(railWidth));
    } catch {
      // A browser that will not store just starts at the default next time.
    }
  }

  function startDrag(event: PointerEvent) {
    const handle = event.currentTarget as HTMLElement;
    handle.setPointerCapture(event.pointerId);
    const move = (e: PointerEvent) => setRail(e.clientX);
    const stop = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', stop);
      handle.removeEventListener('pointercancel', stop);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
  }

  function resizeKey(event: KeyboardEvent) {
    const step = event.shiftKey ? 32 : 8;
    switch (event.key) {
      case 'ArrowLeft':
        setRail(railWidth - step);
        break;
      case 'ArrowRight':
        setRail(railWidth + step);
        break;
      case 'Home':
        setRail(RAIL_MIN);
        break;
      case 'End':
        setRail(RAIL_MAX);
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  // The sheet is a place you go through, not one you stay in.
  afterNavigate(() => {
    railOpen = false;
  });

  function shortcut(event: KeyboardEvent) {
    if (event.key.toLowerCase() !== 'k' || !(event.metaKey || event.ctrlKey)) return;
    if (isTyping()) return;
    event.preventDefault();
    jumpOpen = !jumpOpen;
  }

  const onSession = $derived(page.url.pathname.startsWith('/session'));

  /** Which section the bar names, for the readers who arrived by URL. */
  const crumb = $derived.by(() => {
    const [section] = page.url.pathname.split('/').filter(Boolean);
    switch (section) {
      case undefined:
      case 'session':
        return 'Fleet';
      case 'project':
        return 'Project';
      default:
        return section[0].toUpperCase() + section.slice(1);
    }
  });

  const HUB_DOT: Record<string, string> = {
    connected: 'bg-success',
    connecting: 'bg-warning animate-pulse',
    unreachable: 'bg-error',
  };
  const HUB_TITLE: Record<string, string> = {
    connected: 'Hub connected',
    connecting: 'Connecting to the hub…',
    unreachable: 'Cannot reach the hub',
  };

  /**
   * Whether this tab has ever had the hub. A socket that dropped is retrying
   * and will say so; one that never landed is a wrong address, and the two want
   * different words.
   */
  let everConnected = $state(false);
  $effect(() => {
    if (cockpit.status === 'connected') everConnected = true;
  });

  // The countdown is a clock, not a frame: 250ms is fast enough that the number
  // never looks stuck and slow enough to cost nothing.
  let now = $state(Date.now());
  $effect(() => {
    if (cockpit.status === 'connected') return;
    const timer = setInterval(() => (now = Date.now()), 250);
    return () => clearInterval(timer);
  });
  const retryIn = $derived(
    cockpit.retryAt ? Math.max(0, Math.ceil((cockpit.retryAt - now) / 1000)) : 0
  );
</script>

<svelte:window onkeydown={shortcut} />

<a class="skip" href="#main-content">Skip to content</a>

<div class="shell" style="--sidebar-width: {railWidth}px">
  <aside class="rail hidden md:flex">
    <Sidebar />
    <div
      class="grip"
      role="slider"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-valuenow={railWidth}
      aria-valuemin={RAIL_MIN}
      aria-valuemax={RAIL_MAX}
      tabindex="0"
      onpointerdown={startDrag}
      onkeydown={resizeKey}
    ></div>
  </aside>

  <Sheet.Root bind:open={railOpen}>
    <Sheet.Content side="left" class="w-[284px] p-0 md:hidden">
      <Sheet.Header class="sr-only">
        <Sheet.Title>Navigation</Sheet.Title>
      </Sheet.Header>
      <Sidebar />
    </Sheet.Content>
  </Sheet.Root>

  <div class="main">
    <header class="top">
      <button
        type="button"
        class="burger md:hidden"
        aria-label="Open navigation"
        onclick={() => (railOpen = true)}
      >
        <IconSidebar />
      </button>
      <a class="wordmark md:hidden" href="/session">Outpost</a>
      <span class="crumb hidden md:inline">{crumb}</span>

      <div class="right">
        <Button class="jump" onclick={() => (jumpOpen = true)} title="Jump to session (⌘K)">
          <IconSearch />
          <span class="hidden sm:inline">Jump</span>
        </Button>
        <span class="md:hidden"><UsageMeter /></span>
        {#if cockpit.blockedCount > 0}
          <a class="icobtn" href="/session" title="{cockpit.blockedCount} waiting on you">
            <IconShield />
            <span class="badge">{cockpit.blockedCount}</span>
          </a>
        {/if}
        <span class="hub {HUB_DOT[cockpit.hub]}" title={HUB_TITLE[cockpit.hub]}></span>
        <button
          type="button"
          class="icobtn"
          aria-label="Keyboard shortcuts"
          onclick={() => (shortcutsOpen = true)}
        >
          <IconCommand />
        </button>
        <ThemeSwitcher />
      </div>
    </header>

    <!-- Server-side there is no socket to have lost, so the banner would render
         into every first paint and flash away on hydration. -->
    {#if browser && cockpit.status !== 'connected'}
      <div class="banner {everConnected ? 'warn' : 'bad'}" role="status">
        {#if everConnected}
          <span>Hub connection lost — retrying in {retryIn}s</span>
          <Button onclick={reconnectNow}>Reconnect</Button>
        {:else}
          <span>Can't reach the hub at <code>{hubSocketUrl()}</code></span>
          <Button onclick={reconnectNow}>Retry</Button>
        {/if}
      </div>
    {/if}

    {#if onSession}
      <SessionTabs />
    {/if}

    <main id="main-content" class="content">
      {@render children()}
    </main>

    {#if onSession}
      <ThumbBar onjump={() => (jumpOpen = true)} />
    {/if}
  </div>
</div>

<JumpPalette bind:open={jumpOpen} />
<ShortcutSheet bind:open={shortcutsOpen} />

<style>
  .skip {
    position: absolute;
    left: -9999px;
    z-index: 100;
    padding: var(--space-2) var(--space-4);
    background: var(--surface-raised);
    border-radius: var(--radius-control);
    box-shadow: var(--shadow-lifted);
  }
  .skip:focus {
    left: var(--space-4);
    top: var(--space-4);
  }

  .shell {
    display: flex;
    height: 100dvh;
    width: 100%;
    background: var(--surface-field);
    overflow: hidden;
  }

  .rail {
    position: relative;
    width: var(--sidebar-width);
    flex: 0 0 var(--sidebar-width);
    min-width: 0;
    border-right: 1px solid var(--border-hairline);
  }
  .grip {
    position: absolute;
    top: 0;
    bottom: 0;
    right: -3px;
    width: 6px;
    cursor: col-resize;
    touch-action: none;
    z-index: 5;
  }
  .grip:hover,
  .grip:focus-visible {
    background: var(--border-control);
    outline: none;
  }

  .main {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .top {
    height: 57px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 0 var(--space-6) 0 var(--space-7);
    background: var(--surface-raised);
    border-bottom: 1px solid var(--border-hairline);
  }
  .burger {
    width: 44px;
    height: 44px;
    margin-left: -10px;
    display: grid;
    place-items: center;
    border: 0;
    background: none;
    border-radius: var(--radius-control);
    color: var(--ink-row);
    cursor: pointer;
  }
  .burger :global(svg) {
    width: 19px;
    height: 19px;
  }
  .wordmark {
    font-size: var(--text-md);
    font-weight: var(--weight-strong);
    letter-spacing: var(--track-display);
    color: var(--ink-strong);
    text-decoration: none;
  }
  .crumb {
    font-size: var(--text-md);
    color: var(--ink-body);
    font-weight: var(--weight-medium);
  }

  .right {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 9px;
  }
  .right :global(.jump) {
    gap: 7px;
  }
  .right :global(.jump svg) {
    width: 15px;
    height: 15px;
    color: var(--ink-muted);
  }

  .icobtn {
    position: relative;
    width: 32px;
    height: 32px;
    display: grid;
    place-items: center;
    border: 1px solid var(--border-hairline);
    background: var(--surface-raised);
    border-radius: var(--radius-control);
    color: var(--ink-body);
    cursor: pointer;
  }
  .icobtn :global(svg) {
    width: 17px;
    height: 17px;
  }
  @media (hover: hover) and (pointer: fine) {
    .icobtn:hover,
    .burger:hover {
      background: var(--surface-hover);
    }
  }
  .badge {
    position: absolute;
    top: -5px;
    right: -5px;
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    border-radius: var(--radius-pill);
    background: var(--status-attn-bg);
    color: var(--status-attn-ink);
    font-size: var(--text-xs);
    font-weight: var(--weight-strong);
    display: grid;
    place-items: center;
  }

  .hub {
    width: 8px;
    height: 8px;
    border-radius: var(--radius-pill);
    flex: 0 0 auto;
  }

  .banner {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-6) var(--space-2) var(--space-7);
    font-size: var(--text-base);
    border-bottom: 1px solid var(--border-hairline);
  }
  .banner.warn {
    background: var(--status-attn-bg);
    color: var(--status-attn-ink);
  }
  .banner.bad {
    background: var(--status-fail-bg);
    color: var(--status-fail-ink);
  }
  .banner code {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
  }

  .content {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: auto;
  }
</style>
