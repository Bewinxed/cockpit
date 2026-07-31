<script lang="ts">
  import '../app.css';
  import '$lib/theme.svelte';
  import { onMount } from 'svelte';
  import type { Snippet } from 'svelte';
  import { onNavigate } from '$app/navigation';
  import { Toaster } from '$lib/components/ui/sonner';
  import Shell from '$lib/cockpit/Shell.svelte';
  import { ensureConnected } from '$lib/cockpit/client.svelte';

  let { children }: { children: Snippet } = $props();

  // One socket for the whole app; routes only read the state it fills in.
  onMount(ensureConnected);

  // Native page transitions: same-document view transitions, skipped for
  // readers who prefer reduced motion; browsers without the API just navigate.
  onNavigate((navigation) => {
    if (!document.startViewTransition) return;
    // A hidden document has nothing to animate, and Chrome aborts the
    // transition there — which rejects `finished` under a navigation race.
    if (document.hidden) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    return new Promise((resolve) => {
      const transition = document.startViewTransition(async () => {
        resolve();
        await navigation.complete.catch(() => {});
      });
      transition.finished.catch(() => {});
    });
  });
</script>

<Toaster position="bottom-right" />
<Shell>
  {@render children()}
</Shell>
