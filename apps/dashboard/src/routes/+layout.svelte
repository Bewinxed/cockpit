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

  /** Top-level spokes — clicking between these is instant. */
  const SPOKE = /^\/(session|tools|rules|hooks|delegates|usage)\/?$/;

  // Only animate what needs animating.
  // - Sidebar nav (spoke ↔ spoke): instant. No transition.
  // - Session tab switches: instant here; the pane crossfade is CSS in session/+layout.
  // - Same-page param changes (?tab=): instant.
  // - Drill-in (Fleet → Session/[id]): subtle 100ms opacity fade.
  // - Mobile gesture swipes: keep the push (data-nav already set by gesture handler).
  onNavigate((navigation) => {
    if (!document.startViewTransition) return;
    if (!navigation.from || !navigation.to) return;

    const from = navigation.from.url.pathname;
    const to = navigation.to.url.pathname;

    // Same page, different params — instant.
    if (from === to) return;

    // Session tab switches — instant (panes handle their own crossfade).
    if (!document.documentElement.dataset.nav && SESSION.test(from) && SESSION.test(to)) return;

    // Spoke ↔ spoke — instant.
    if (!document.documentElement.dataset.nav && SPOKE.test(from) && SPOKE.test(to)) return;

    // Hidden or reduced motion — instant.
    if (document.hidden) { delete document.documentElement.dataset.nav; return; }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      delete document.documentElement.dataset.nav; return;
    }

    // Everything else (drill-in, drill-out, mobile gesture): animate.
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
