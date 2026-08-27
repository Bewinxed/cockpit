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

  // Native page transitions: same-document view transitions, skipped for
  // readers who prefer reduced motion; browsers without the API just navigate.
  onNavigate((navigation) => {
    if (!document.startViewTransition) return;
    // Switching tabs is not going anywhere: crossfading the whole document
    // between two tabs is what made a tab click read as a page load, and Fleet
    // is the first tab in the strip. A swipe still animates — it names a
    // direction, and the gesture is the thing being animated.
    if (
      !document.documentElement.dataset.nav &&
      navigation.from &&
      navigation.to &&
      SESSION.test(navigation.from.url.pathname) &&
      SESSION.test(navigation.to.url.pathname)
    ) {
      return;
    }
    // A hidden document has nothing to animate, and Chrome aborts the
    // transition there — which rejects `finished` under a navigation race.
    if (document.hidden) {
      delete document.documentElement.dataset.nav;
      return;
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      delete document.documentElement.dataset.nav;
      return;
    }
    return new Promise((resolve) => {
      const transition = document.startViewTransition(async () => {
        resolve();
        await navigation.complete.catch(() => {});
      });
      // Cleared only once the animation has actually finished — the direction
      // is read by CSS *during* it, so clearing any earlier means a swipe
      // backwards animates forwards. Anything that navigates without setting a
      // direction gets the forward push, which is the right default.
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
