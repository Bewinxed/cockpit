<script lang="ts">
  import '../app.css';
  import '$lib/theme.svelte';
  /**
   * The UI face, by the name the build gives it. `app.css` reaches this same
   * file through @fontsource's `@font-face`, but only once the stylesheet has
   * parsed — so on a cold load the page painted in the system fallback and
   * reflowed every line ~100ms later when Geist arrived. Importing the asset
   * gets Vite's resolved (hashed) URL, which is the one the CSS will ask for,
   * so the preload below is a head start rather than a second download.
   */
  import geistLatin from '@fontsource-variable/geist/files/geist-latin-wght-normal.woff2?url';
  import { onMount } from 'svelte';
  import type { Snippet } from 'svelte';
  import { onNavigate } from '$app/navigation';
  import { Toaster } from '$lib/components/ui/sonner';
  import Shell from '$lib/cockpit/Shell.svelte';
  import { ensureConnected } from '$lib/cockpit/client.svelte';
  import { enableLongPressMenus } from '$lib/utils/longpress';
  import type { LayoutServerData } from './$types';

  let { children, data }: { children: Snippet; data: LayoutServerData } = $props();

  // One socket for the whole app; routes only read the state it fills in.
  onMount(ensureConnected);
  // iOS has no right-click; a held press is its context menu.
  onMount(enableLongPressMenus);

  /**
   * Everything the tab strip reaches: the conversations, and the fleet board
   * that leads them. One surface with several things stacked in it, not several
   * pages — `session/+layout.svelte` keeps all of them mounted at once.
   */
  const SESSION = /^\/session(\/|$)/;

  /** Spoke order — the sidebar nav's top-to-bottom sequence. Position in this
   *  array determines animation direction: navigating to a higher index slides
   *  the old content left (you moved "down"), lower index slides right ("up").
   *  Like iOS Settings or a tab controller where position drives direction. */
  const SPOKE_ORDER = ['session', 'tools', 'rules', 'hooks', 'delegates', 'usage'];

  function spokeIndex(pathname: string): number {
    const seg = pathname.split('/').filter(Boolean)[0] || 'session';
    return SPOKE_ORDER.indexOf(seg);
  }

  // View transitions with directional awareness.
  // - Session tab switches: skip (panes are already mounted)
  // - Spoke navigation: directional slide (position in sidebar determines direction)
  // - Drill-in/out: forward/back slide
  // - Mobile gestures: push animation (data-nav already set)
  onNavigate((navigation) => {
    if (!document.startViewTransition) return;

    // Same-page param changes (e.g. ?tab= on /tools): no transition.
    // Switching tabs within a page is not navigation — it's the same surface
    // showing a different panel. Animating it makes a tab click feel like
    // a page reload.
    if (
      navigation.from &&
      navigation.to &&
      navigation.from.url.pathname === navigation.to.url.pathname
    ) {
      return;
    }

    // Session tab switches: no transition — panes are visibility-toggled.
    if (
      !document.documentElement.dataset.nav &&
      navigation.from &&
      navigation.to &&
      SESSION.test(navigation.from.url.pathname) &&
      SESSION.test(navigation.to.url.pathname)
    ) {
      return;
    }

    if (document.hidden) {
      delete document.documentElement.dataset.nav;
      return;
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      delete document.documentElement.dataset.nav;
      return;
    }

    // Determine direction from navigation context.
    if (!document.documentElement.dataset.nav && navigation.from && navigation.to) {
      const fromIdx = spokeIndex(navigation.from.url.pathname);
      const toIdx = spokeIndex(navigation.to.url.pathname);

      if (fromIdx >= 0 && toIdx >= 0 && fromIdx !== toIdx) {
        // Lateral spoke navigation — direction from sidebar position.
        document.documentElement.dataset.nav = toIdx > fromIdx ? 'next' : 'prev';
      } else {
        // Drill-in (adding depth) vs drill-out (removing depth).
        const fromDepth = navigation.from.url.pathname.split('/').filter(Boolean).length;
        const toDepth = navigation.to.url.pathname.split('/').filter(Boolean).length;
        document.documentElement.dataset.nav = toDepth >= fromDepth ? 'next' : 'prev';
      }
    }

    return new Promise((resolve) => {
      const transition = document.startViewTransition(async () => {
        resolve();
        await navigation.complete.catch(() => {});
      });
      const clear = () => delete document.documentElement.dataset.nav;
      transition.finished.then(clear, clear);
    });
  });
</script>

<svelte:head>
  <link rel="preload" as="font" type="font/woff2" href={geistLatin} crossorigin="anonymous" />
</svelte:head>

<Toaster position="bottom-right" />
<Shell railWidth={data.railWidth}>
  {@render children()}
</Shell>
