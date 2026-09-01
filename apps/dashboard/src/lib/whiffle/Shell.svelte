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
  import { Button } from '$lib/components/ui/button';
  import { IconSearch, IconShield, IconSidebar } from '$lib/icons';
  import { isTyping } from '$lib/utils/typing';
  import { TextMorph } from 'torph/svelte';
  import { whiffle, hubSocketUrl, reconnectNow } from './client.svelte';
  import JumpPalette from './JumpPalette.svelte';
  import ConfirmDialog from './ConfirmDialog.svelte';
  import Sidebar from './Sidebar.svelte';
  import SessionTabs from './SessionTabs.svelte';
  import { workspace } from './workspace/workspace.svelte';
  import UsageMeter from './UsageMeter.svelte';
  import AssistantOrb from './assistant/AssistantOrb.svelte';
  import AssistantPanel from './assistant/AssistantPanel.svelte';

  const RAIL_KEY = 'whiffle-rail-width';
  const RAIL_MIN = 216;
  const RAIL_MAX = 520;
  const RAIL_DEFAULT = 340;

  const clamp = (px: number) => Math.min(RAIL_MAX, Math.max(RAIL_MIN, Math.round(px || RAIL_DEFAULT)));

  let {
    children,
    /** Read from the `whiffle-rail-width` cookie server-side (see
     *  +layout.server.ts) so the first paint is already the resolved width —
     *  the rail no longer renders the default and jumps on hydration. */
    railWidth: initialRailWidth = RAIL_DEFAULT,
  }: { children: import('svelte').Snippet; railWidth?: number } = $props();

  let railWidth = $state(clamp(initialRailWidth));
  let jumpOpen = $state(false);
  let railOpen = $state(false);
  let assistantOpen = $state(false);
  let orbEl: HTMLButtonElement | null = $state(null);

  /**
   * The rail's width is settled before the first paint, in two places at once.
   *
   * SSR draws it from the `whiffle-rail-width` cookie, and the inline script in
   * `app.html` overwrites `--rail-w` from localStorage — which is where the
   * width is actually authored, and which the server cannot read. A browser with
   * a stored width and no cookie (a fresh profile, or the pre-cookie migration)
   * used to paint the default and snap once this component mounted; now the
   * property is already right when the first pixel goes down and this only
   * adopts it.
   *
   * From here on the property is this component's: `setRail` writes it, so the
   * drag handle and the cookie and localStorage never disagree.
   */
  onMount(() => {
    const stored = Number(localStorage.getItem(RAIL_KEY));
    setRail(Number.isFinite(stored) && stored > 0 ? stored : railWidth);
  });

  function setRail(px: number) {
    railWidth = clamp(px);
    // The one place the width is applied. `--sidebar-width` resolves through it
    // (see the shell's inline style), so the value the inline script established
    // is replaced rather than fought with.
    document.documentElement.style.setProperty('--rail-w', `${railWidth}px`);
    try {
      localStorage.setItem(RAIL_KEY, String(railWidth));
      document.cookie = `${RAIL_KEY}=${railWidth};path=/;max-age=31536000;samesite=lax`;
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
    if (!(event.metaKey || event.ctrlKey)) return;
    if (isTyping()) return;
    const key = event.key.toLowerCase();
    if (key === 'k') {
      event.preventDefault();
      jumpOpen = !jumpOpen;
      return;
    }
    // Split the focused group, putting the conversation in front into the new
    // half. `mod+\` is the binding VS Code uses for exactly this, and this is
    // a straight copy of that model — borrowing the gesture's name too costs
    // nothing and saves the reader learning a second one.
    if (key === '\\' && onSession) {
      const here = workspace.activeSessionId;
      if (!here || workspace.openIds.length < 2) return;
      event.preventDefault();
      workspace.split(workspace.focusedLeafId, event.shiftKey ? 'bottom' : 'right', here);
    }
  }

  const limits = $derived(whiffle.usageLimitsAny());
  const onSession = $derived(page.url.pathname.startsWith('/session'));

  /**
   * The app strip is the LONE group's strip — and the board's only one.
   *
   * Once the workspace is split each group draws its own, and keeping this
   * one as well would put two rows of tabs on screen listing the same
   * conversations, one of which could not say which half it meant. But the
   * per-group strips live inside the surface the fleet board covers, so
   * hiding this on the board as well left nothing to click: a split reader
   * who went to Fleet could not get back to a conversation at all.
   *
   * So it follows what is on screen rather than what the tree holds: the
   * board always has a strip, and a split session view does not need one.
   */
  const appStrip = $derived(
    onSession && (workspace.activeSessionId === null || workspace.leaves.length < 2)
  );

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

  /**
   * Whether this tab has ever had the hub. A socket that dropped is retrying
   * and will say so; one that never landed is a wrong address, and the two want
   * different words.
   */
  let everConnected = $state(false);
  $effect(() => {
    if (whiffle.status === 'connected') everConnected = true;
  });

  /**
   * The first connection is not a fault, and it used to be drawn as one.
   *
   * `status` starts at `disconnected` — a socket that has not been made yet
   * reads exactly like one that failed — so every cold load hydrated with the
   * red "can't reach the hub" banner up, then tore it down a frame later when
   * the socket opened. That is a 47px band inserted and removed between the top
   * bar and the tab strip: two layout shifts, ±47px, on a load where nothing
   * was ever wrong.
   *
   * So the banner waits for evidence, but only for the `connecting` phase —
   * the grace period before the first attempt completes. Once the status is
   * `disconnected` or `error`, the hub is known-unreachable and the banner
   * fires without requiring a prior successful connection: an operator whose
   * browser loads while the hub is already down sees the full-width banner
   * immediately (after the grace), not caption-sized text buried in an empty
   * state.
   */
  const CONNECT_GRACE = 4000;
  let graceOver = $state(false);
  onMount(() => {
    const timer = setTimeout(() => (graceOver = true), CONNECT_GRACE);
    return () => clearTimeout(timer);
  });
  const showBanner = $derived.by(() => {
    const s = whiffle.status;
    if (s === 'connected') return false;
    // A socket that errored or was declared disconnected is a known fault —
    // show the banner once the grace has elapsed or the attempt has failed,
    // without requiring a prior successful connection.
    if (s === 'disconnected' || s === 'error') return whiffle.connectFailed || graceOver;
    // `connecting` is the transient every cold load passes through. Show the
    // banner only when a prior connection has been lost and the grace elapsed.
    return everConnected && graceOver;
  });

  // The countdown is a clock, not a frame: 250ms is fast enough that the number
  // never looks stuck and slow enough to cost nothing.
  let now = $state(Date.now());
  $effect(() => {
    if (whiffle.status === 'connected') return;
    const timer = setInterval(() => (now = Date.now()), 250);
    return () => clearInterval(timer);
  });
  const retryIn = $derived(
    whiffle.retryAt ? Math.max(0, Math.ceil((whiffle.retryAt - now) / 1000)) : 0
  );
</script>

<svelte:window onkeydown={shortcut} />

<a class="skip" href="#main-content">Skip to content</a>

<!-- `--rail-w` is set before the body parses (app.html) from the same key this
     component writes; the server's cookie width is the fallback under it. SSR
     therefore emits no committed width of its own, and there is nothing to
     snap away from on hydration. -->
<div class="shell" style="--sidebar-width: var(--rail-w, {railWidth}px)">
  <aside class="rail hidden min-[900px]:flex">
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
    <Sheet.Content side="left" class="w-[284px] p-0 min-[900px]:hidden">
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
        class="burger min-[900px]:hidden"
        aria-label="Open navigation"
        onclick={() => (railOpen = true)}
      >
        <IconSidebar />
      </button>
      <!-- The one "where am I" label, now visible at every width — the brand
           lives in the rail, and the crumb is what the top bar owes a reader
           who arrived by URL. -->
      <TextMorph text={crumb} class="crumb" as="span" duration={150} />

      <div class="right">
        <!-- Desktop budget and fleet status — phone shows UsageMeter instead. -->
        {#if limits && whiffle.status === 'connected'}
          <span class="desk-budget hidden min-[900px]:flex" title="Today's spend vs. limit">
            <span class="desk-budget-text">
              Today ${(limits.spendUsed ?? 0).toFixed(2)}
              {#if limits.spendLimit !== null}
                <span class="desk-budget-cap">/ ${limits.spendLimit.toFixed(0)}</span>
              {/if}
            </span>
            {#if limits.spendLimit !== null && limits.spendLimit > 0}
              {@const pct = Math.min(100, ((limits.spendUsed ?? 0) / limits.spendLimit) * 100)}
              <span class="desk-budget-bar">
                <span
                  class="desk-budget-fill"
                  class:warn={pct >= 70 && pct < 90}
                  class:critical={pct >= 90}
                  style="width: {pct}%"
                ></span>
              </span>
            {/if}
          </span>
        {/if}

        {#if whiffle.status === 'connected' && whiffle.machines.length > 0}
          <span class="desk-machines hidden min-[900px]:inline">
            {whiffle.onlineMachines.length} machine{whiffle.onlineMachines.length === 1 ? '' : 's'}
          </span>
        {/if}

        <!-- Jump is a single entry: the one command surface the top bar opens.
             The old phone thumb bar duplicated it; that bar is gone. -->
        <Button
          variant="outline"
          size="sm"
          class="jump"
          onclick={() => (jumpOpen = true)}
          title="Jump to session (⌘K)"
        >
          <IconSearch />
          <span class="hidden sm:inline">Jump</span>
        </Button>
        <span class="min-[900px]:hidden"><UsageMeter /></span>
        {#if whiffle.blockedCount > 0}
          <a class="icobtn" href="/session" title="{whiffle.blockedCount} waiting on you">
            <IconShield />
            <span class="badge">{whiffle.blockedCount}</span>
          </a>
        {/if}
        <AssistantOrb
          bind:ref={orbEl}
          open={assistantOpen}
          onclick={() => (assistantOpen = !assistantOpen)}
        />
        <!-- No always-on hub dot: a green light that is green 99% of the time
             says nothing. Connection health folds into the banner below, which
             is shown only when the hub is NOT connected. -->
        <ThemeSwitcher />
      </div>
    </header>

    <!-- Server-side there is no socket to have lost, so the banner would render
         into every first paint and flash away on hydration. -->
    {#if browser && showBanner}
      <div class="banner {everConnected ? 'warn' : 'bad'}" role="status">
        {#if everConnected}
          <span>Hub connection lost — retrying in {retryIn}s</span>
          <Button variant="outline" size="sm" onclick={reconnectNow}>Reconnect</Button>
        {:else}
          <span>Can't reach the hub at <code>{hubSocketUrl()}</code></span>
          <Button variant="outline" size="sm" onclick={reconnectNow}>Retry</Button>
        {/if}
      </div>
    {/if}

    {#if appStrip}
      <SessionTabs />
    {/if}

    <!-- The old thumb bar is gone, so this region reclaims its height. On a
         session route the composer owns its own bottom inset; everywhere else
         the scroll region pads the home-indicator safe area itself so the last
         row is never tucked under it. -->
    <main id="main-content" class="content" class:safe={!onSession}>
      {@render children()}
    </main>
  </div>
</div>

<JumpPalette bind:open={jumpOpen} />
<!-- One dialog for every destructive confirm in the app (see confirm.svelte.ts). -->
<ConfirmDialog />

<AssistantPanel bind:open={assistantOpen} {orbEl} />

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
    /* Exclude from view transitions so the sidebar stays rock-still
       while the content area cross-fades on spoke navigation. */
    view-transition-name: sidebar;
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
    height: 57px; /* the mock's fixed top-bar height; a magic layout value */
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: 0 var(--space-6) 0 var(--space-7);
    background: var(--surface-raised);
    border-bottom: 1px solid var(--border-hairline);
    view-transition-name: topbar;
  }
  .burger {
    width: 44px;
    height: 44px;
    margin-left: calc(-1 * var(--space-2));
    display: grid;
    place-items: center;
    border: 0;
    background: none;
    border-radius: var(--radius-control);
    color: var(--ink-row);
    cursor: pointer;
  }
  /* At the mock's 900px breakpoint the rail returns and the burger retires.
     Scoped so it beats the display:grid above, which a utility class cannot. */
  @media (min-width: 900px) {
    .burger {
      display: none;
    }
  }
  .burger :global(svg) {
    width: 19px;
    height: 19px;
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
    gap: var(--space-2);
    min-width: 0;
  }
  .right :global(.jump) {
    gap: var(--space-2);
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
  /* Tactile press — the affordance dips under the finger, only the transform
     transitions, and it is suppressed for reduced-motion. */
  .icobtn,
  .burger {
    transition: background var(--motion-fast) var(--ease-toggle);
  }
  .icobtn:active,
  .burger:active {
    transform: scale(0.96);
  }
  @media (prefers-reduced-motion: reduce) {
    .icobtn:active,
    .burger:active {
      transform: none;
    }
  }
  @media (pointer: coarse) {
    .icobtn {
      width: 44px;
      height: 44px;
    }
    /* Every affordance in the right cluster takes the 44px thumb floor —
       the Jump button, the usage meter's pill and the theme toggle included,
       so a phone tap never lands on a 32px target. */
    .right :global(.jump),
    .right :global(button),
    .right :global(a) {
      min-height: 44px;
      min-width: 44px;
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

  .desk-budget {
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
    color: var(--ink-muted);
  }
  .desk-budget-cap {
    color: var(--ink-faint);
  }
  .desk-budget-bar {
    display: block;
    width: 48px;
    height: 4px;
    border-radius: var(--radius-pill);
    background: var(--surface-field);
    overflow: hidden;
  }
  .desk-budget-fill {
    display: block;
    height: 100%;
    border-radius: var(--radius-pill);
    background: var(--data-ok);
    transition: width var(--motion-fast) var(--ease-toggle);
  }
  .desk-budget-fill.warn {
    background: var(--data-warn);
  }
  .desk-budget-fill.critical {
    background: var(--data-bad);
  }
  .desk-machines {
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
    color: var(--ink-muted);
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
    /* Only the content slot transitions — everything above it (sidebar,
       top bar, session tabs) stays still because they have their own
       view-transition-name or are outside this element. */
    view-transition-name: content;
  }
  /* Own the home-indicator inset where no composer is present to own it. */
  @media (pointer: coarse) {
    .content.safe {
      padding-bottom: env(safe-area-inset-bottom);
    }
  }
</style>
