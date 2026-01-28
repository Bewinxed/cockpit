<script lang="ts">
  import '../app.css';
  import '@xyflow/svelte/dist/style.css';
  import { onMount, onDestroy } from 'svelte';
  import { toast } from 'svelte-sonner';
  import { page } from '$app/state';
  import { HUB_URL } from '$lib/config';
  // Stores and WebSocket setup
  import { agents, instances, permissions, projects, ui, setupWSAndConnect, disconnectWS } from '$lib/stores';
  import { restoreTabsFromStorage, persistTabsToStorage, openInstance } from '$lib/stores/url-sync.svelte';
  import '$lib/stores/theme.svelte';
  import type { Snippet } from 'svelte';

  // Shell components
  import AppShell from '$lib/components/shell/AppShell.svelte';
  import { Toaster } from '$lib/components/ui/sonner';

  // Svelte 5: children snippet for layout
  let { children }: { children: Snippet } = $props();

  // Track seen permission IDs to show toasts only for new ones
  let seenPermissionIds = new Set<string>();

  // Watch for new permission requests and show toasts
  $effect(() => {
    const pendingPerms = permissions.sorted;
    for (const perm of pendingPerms) {
      if (!seenPermissionIds.has(perm.requestId)) {
        seenPermissionIds.add(perm.requestId);
        const instance = instances.get(perm.instanceId);
        const instanceName = instance?.name || instance?.cwd?.split('/').pop() || 'Instance';

        toast.warning(`Permission Request`, {
          description: `${instanceName} wants to use ${perm.toolName}`,
          action: {
            label: 'View',
            onClick: () => openInstance(perm.instanceId)
          },
          duration: 10000
        });
      }
    }
  });

  // Populate stores from server-loaded data ($page.data is serialized into HTML
  // by SvelteKit and available synchronously on both server render and client hydration).
  agents.initializeFromSSR(page.data.agents);
  instances.initializeFromSSR(page.data.instances);
  projects.initializeFromSSR(page.data.projects);
  for (const [id, msgs] of Object.entries(page.data.tabMessages as Record<string, any[]>)) {
    instances.initializeMessagesFromSSR(id, msgs);
  }

  // Connect to real-time updates (client-side only)
  onMount(() => {
    setupWSAndConnect(HUB_URL);

    // Restore tabs from localStorage if URL has none
    restoreTabsFromStorage();

    // Register global keyboard shortcuts
    function handleKeydown(e: KeyboardEvent) {
      // Ignore if in input/textarea
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        // Allow Escape to still work
        if (e.key !== 'Escape') return;
      }

      const isMac = navigator.platform.includes('Mac');
      const cmdKey = isMac ? e.metaKey : e.ctrlKey;

      // Cmd+K - Command palette
      if (cmdKey && e.key === 'k') {
        e.preventDefault();
        ui.toggleCommandPalette();
        return;
      }

      // Cmd+N - New instance
      if (cmdKey && e.key === 'n') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('agentdeck:new-instance'));
        return;
      }

      // Escape - Close modals or clear selection
      if (e.key === 'Escape') {
        // Don't clear selection if in a modal - the modal will handle it
        return;
      }
    }

    window.addEventListener('keydown', handleKeydown);

    // Persist tabs to storage when URL changes
    function handlePopState() {
      persistTabsToStorage();
    }
    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('keydown', handleKeydown);
      window.removeEventListener('popstate', handlePopState);
    };
  });

  onDestroy(() => {
    disconnectWS();
  });
</script>

<Toaster position="bottom-right" />
<AppShell />
{@render children()}
