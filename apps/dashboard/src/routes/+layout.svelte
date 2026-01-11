<script lang="ts">
  import '../app.css';
  import { page } from '$app/state';
  import { onMount, onDestroy } from 'svelte';
  import { HUB_URL } from '$lib/config';
  import {
    connect,
    disconnect,
    initializeFromSSR,
    toggleCommandPalette,
    selectedInstanceId,
    splitViewState
  } from '$lib/stores/realtime.svelte';
  import { syncUrlToStore } from '$lib/stores/url-sync.svelte';
  import { getAgents, getInstances, getProjects } from '$lib/data.remote';
  import '$lib/stores/theme';

  // Shell components
  import AppShell from '$lib/components/shell/AppShell.svelte';

  // Use $derived with await for remote functions - this works during SSR
  const agentsData = $derived(await getAgents());
  const instancesData = $derived(await getInstances());
  const projectsData = $derived(await getProjects());

  // Initialize stores reactively when data changes
  $effect(() => {
    initializeFromSSR(agentsData, instancesData, projectsData);
  });

  // Connect to real-time updates (client-side only)
  onMount(() => {
    connect(HUB_URL);

    // Sync URL to store on initial load
    syncUrlToStore();

    // Register global keyboard shortcuts
    function handleKeydown(e: KeyboardEvent) {
      // Ignore if in input/textarea
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        // Allow Escape to still work
        if (e.key !== 'Escape') return;
      }

      const isMac = navigator.platform.includes('Mac');
      const cmdKey = isMac ? e.metaKey : e.ctrlKey;

      // ⌘K - Command palette
      if (cmdKey && e.key === 'k') {
        e.preventDefault();
        toggleCommandPalette();
        return;
      }

      // ⌘N - New instance
      if (cmdKey && e.key === 'n') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('cockpit:new-instance'));
        return;
      }

      // Escape - Close modals or clear selection
      if (e.key === 'Escape') {
        // Don't clear selection if in a modal - the modal will handle it
        return;
      }
    }

    window.addEventListener('keydown', handleKeydown);

    return () => {
      window.removeEventListener('keydown', handleKeydown);
    };
  });

  onDestroy(() => {
    disconnect();
  });

  // React to URL changes (browser back/forward)
  $effect(() => {
    // This runs whenever page.url changes
    const _ = page.url.searchParams.get('instance');
    syncUrlToStore();
  });

  // Persist UI state to localStorage
  $effect(() => {
    const instanceId = $selectedInstanceId;
    if (instanceId) {
      localStorage.setItem('cockpit:selectedInstanceId', instanceId);
    } else {
      localStorage.removeItem('cockpit:selectedInstanceId');
    }
  });

  $effect(() => {
    const split = $splitViewState;
    localStorage.setItem('cockpit:splitViewState', JSON.stringify(split));
  });
</script>

<AppShell />
