<script lang="ts">
  import "../app.css";
  import "$lib/theme.svelte";
  /**
   * The UI face, by the name the build gives it. `app.css` reaches this same
   * file through @fontsource's `@font-face`, but only once the stylesheet has
   * parsed — so on a cold load the page painted in the system fallback and
   * reflowed every line ~100ms later when Geist arrived. Importing the asset
   * gets Vite's resolved (hashed) URL, which is the one the CSS will ask for,
   * so the preload below is a head start rather than a second download.
   */
  import geistLatin from "@fontsource-variable/geist/files/geist-latin-wght-normal.woff2?url";
  import type { Snippet } from "svelte";
  import { onMount } from "svelte";
  import { onNavigate } from "$app/navigation";
  import { Toaster } from "$lib/components/ui/sonner";
  import { enableLongPressMenus } from "$lib/utils/longpress";
  import { ensureConnected } from "$lib/whiffle/client.svelte";
  import Shell from "$lib/whiffle/Shell.svelte";
  import type { LayoutServerData } from "./$types";

  let { children, data }: { children: Snippet; data: LayoutServerData } =
    $props();

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

  const SPOKE_ORDER = [
    "session",
    "tools",
    "rules",
    "hooks",
    "delegates",
    "usage",
  ];

  function spokeIndex(pathname: string): number {
    const seg = pathname.split("/").filter(Boolean)[0] || "session";
    return SPOKE_ORDER.indexOf(seg);
  }

  // Only animate what needs animating.
  // - Sidebar nav (spoke <-> spoke): vertical slide keyed to spoke order.
  // - Same-page param changes (?tab=): instant.
  // - Drill-in (Fleet -> Session/[id]): horizontal push.
  //
  // Moving between conversations never arrives here at all: the workspace
  // store shows the pane and writes the URL with `pushState`, which runs no
  // navigation. The flag that used to tell this handler to stand down during a
  // swipe is gone with the navigation it was suppressing.
  onNavigate((navigation) => {
    if (!document.startViewTransition) {
      return;
    }
    if (!(navigation.from && navigation.to)) {
      return;
    }

    const from = navigation.from.url.pathname;
    const to = navigation.to.url.pathname;

    // Same page, different params — instant.
    if (from === to) {
      return;
    }

    // Session tab switches skip VT entirely. The panes are visibility-toggled
    // with their own CSS crossfade (opacity transition in session/+layout), so
    // a VT here only adds ~300ms of capture/animate overhead on top of the
    // transition that already runs. The DOM swap is 4ms; don't gate it.
    if (SESSION.test(from) && SESSION.test(to)) {
      return;
    }

    // Hidden or reduced motion — instant.
    if (document.hidden) {
      delete document.documentElement.dataset.nav;
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      delete document.documentElement.dataset.nav;
      return;
    }

    // Compute direction and set it as CSS custom properties on :root.
    // Custom properties work reliably in all browsers including iOS Safari,
    // unlike data-attribute selectors on view-transition pseudo-elements.
    const el = document.documentElement;
    if (!el.dataset.nav) {
      const fromIdx = spokeIndex(from);
      const toIdx = spokeIndex(to);
      if (fromIdx >= 0 && toIdx >= 0 && fromIdx !== toIdx) {
        // Vertical: sidebar is top-to-bottom
        const down = toIdx > fromIdx;
        el.style.setProperty("--vt-old-x", "0");
        el.style.setProperty("--vt-old-y", down ? "-8%" : "8%");
        el.style.setProperty("--vt-new-x", "0");
        el.style.setProperty("--vt-new-y", down ? "8%" : "-8%");
      } else {
        // Horizontal: drill-in/out
        el.style.setProperty("--vt-old-x", "-8%");
        el.style.setProperty("--vt-old-y", "0");
        el.style.setProperty("--vt-new-x", "8%");
        el.style.setProperty("--vt-new-y", "0");
      }
    } else if (el.dataset.nav === "prev") {
      // Back navigation
      el.style.setProperty("--vt-old-x", "8%");
      el.style.setProperty("--vt-old-y", "0");
      el.style.setProperty("--vt-new-x", "-8%");
      el.style.setProperty("--vt-new-y", "0");
    }

    return new Promise((resolve) => {
      const transition = document.startViewTransition(async () => {
        resolve();
        await navigation.complete.catch(() => {});
      });
      const clear = () => {
        delete el.dataset.nav;
        el.style.removeProperty("--vt-old-x");
        el.style.removeProperty("--vt-old-y");
        el.style.removeProperty("--vt-new-x");
        el.style.removeProperty("--vt-new-y");
      };
      transition.finished.then(clear, clear);
    });
  });
</script>

<svelte:head>
  <link
    as="font"
    crossorigin="anonymous"
    href={geistLatin}
    rel="preload"
    type="font/woff2"
  >
</svelte:head>

<Toaster position="bottom-right" />
<Shell railWidth={data.railWidth}> {@render children()} </Shell>
