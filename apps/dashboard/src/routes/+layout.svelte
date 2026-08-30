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

  /** Top-level spokes — lateral siblings in the sidebar nav. Moving between
   *  these is like switching tabs in one app, not navigating to a new page.
   *  DESIGN.md §Motion: "Structure never animates." */
  const SPOKE = /^\/(session|tools|rules|hooks|delegates|usage)\/?$/;

  // Native page transitions: same-document view transitions.
  // DESIGN.md §Motion: "Only the live channel moves. Structure — rows, cards,
  // columns, chrome — never animates." Routine spoke navigation is instant;
  // only depth changes (drill-in to a [id] route) and explicit gesture
  // navigations (mobile swipes with data-nav set) earn a transition.
  onNavigate((navigation) => {
    if (!document.startViewTransition) return;

    // Session tab switches: no transition. Switching tabs inside the session
    // layout is a parameter change, not a navigation — the panes are already
    // mounted and visibility-toggled.
    if (
      !document.documentElement.dataset.nav &&
      navigation.from &&
      navigation.to &&
      SESSION.test(navigation.from.url.pathname) &&
      SESSION.test(navigation.to.url.pathname)
    ) {
      return;
    }

    // Lateral spoke navigation (Fleet ↔ Tools ↔ Rules ↔ Usage etc.):
    // instant, no transition. These are sections in the same app — animating
    // them makes every sidebar click feel like a page reload.
    if (
      !document.documentElement.dataset.nav &&
      navigation.from &&
      navigation.to &&
      SPOKE.test(navigation.from.url.pathname) &&
      SPOKE.test(navigation.to.url.pathname)
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

    // Depth change or explicit gesture — run the transition.
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
