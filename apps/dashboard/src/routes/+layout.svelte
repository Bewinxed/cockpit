<script lang="ts">
  import '../app.css';
  import '$lib/theme.svelte';
  import { onMount } from 'svelte';
  import type { Snippet } from 'svelte';
  import { Toaster } from '$lib/components/ui/sonner';
  import Shell from '$lib/cockpit/Shell.svelte';
  import { ensureConnected } from '$lib/cockpit/client.svelte';

  let { children }: { children: Snippet } = $props();

  // One socket for the whole app; routes only read the state it fills in.
  onMount(ensureConnected);
</script>

<Toaster position="bottom-right" />
<Shell>
  {@render children()}
</Shell>
