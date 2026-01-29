<script lang="ts">
  import '../app.css';
  import '@xyflow/svelte/dist/style.css';
  import { onMount } from 'svelte';
  import { onNavigate } from '$app/navigation';
  import { toast } from 'svelte-sonner';
  import { HUB_URL } from '$lib/config';
  import {
    agents,
    instances,
    permissions,
    projects,
    ui,
    connection,
    setupWSAndConnect,
    disconnectWS,
  } from '$lib/stores';
  import { tabs } from '$lib/stores/tabs.svelte';
  import { getAgents, getInstances, getProjects } from '$lib/data.remote';
  import '$lib/stores/theme.svelte';
  import type { Snippet } from 'svelte';

  import AppShell from '$lib/components/shell/AppShell.svelte';
  import { Toaster } from '$lib/components/ui/sonner';

  let { children }: { children: Snippet } = $props();

  // ============================================
  // SSR Data via Remote Functions
  // ============================================

  // Remote functions return objects with:
  // - .current: the resolved data (reactive)
  // - .pending: number of pending requests (0 = not loading)
  // - .error: Error object if failed
  // - .refresh(): re-fetch from server
  const ssrAgents = getAgents();
  const ssrInstances = getInstances();
  const ssrProjects = getProjects();

  // Track if we've shown the error toast to avoid spamming
  let hasShownHubError = $state(false);

  // Sync SSR data to stores when available
  $effect(() => {
    // Handle errors from remote functions
    const error = ssrAgents.error || ssrInstances.error || ssrProjects.error;
    if (error && !hasShownHubError) {
      hasShownHubError = true;
      console.error('[Layout] Hub fetch error:', error);
      toast.error('Failed to load data from hub', {
        description: error.message,
        duration: 5000,
      });
    }

    // Sync data to stores when loaded (check for undefined, not just length)
    // An empty array [] is valid - means "loaded but no items"
    if (ssrAgents.current !== undefined) {
      agents.initializeFromSSR(ssrAgents.current);
    }
    if (ssrInstances.current !== undefined) {
      instances.initializeFromSSR(ssrInstances.current);
    }
    if (ssrProjects.current !== undefined) {
      projects.initializeFromSSR(ssrProjects.current);
    }
  });

  // ============================================
  // WebSocket Reconnection → Refresh Remote Functions
  // ============================================

  // Track previous connection status to detect reconnection
  let prevConnectionStatus = $state<string>('disconnected');

  $effect(() => {
    const currentStatus = connection.status;

    // Detect reconnection: was not 'connected', now is 'connected'
    if (prevConnectionStatus !== 'connected' && currentStatus === 'connected') {
      console.log('[Layout] WebSocket reconnected, refreshing remote function cache');

      // Clear error state
      hasShownHubError = false;

      // Refresh all remote function caches to sync with server
      ssrAgents.refresh();
      ssrInstances.refresh();
      ssrProjects.refresh();
    }

    prevConnectionStatus = currentStatus;
  });

  // ============================================
  // Permission Request Toasts
  // ============================================

  // Track seen permission IDs to show toasts only for new ones
  let seenPermissionIds = new Set<string>();

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
            onClick: () => tabs.open(perm.instanceId),
          },
          duration: 10000,
        });
      }
    }
  });

  // ============================================
  // View Transitions
  // ============================================

  onNavigate((navigation) => {
    // Skip if browser doesn't support View Transitions
    if (!document.startViewTransition) return;

    return new Promise((resolve) => {
      document.startViewTransition(async () => {
        resolve();
        await navigation.complete;
      });
    });
  });

  // ============================================
  // Keyboard Shortcuts & Lifecycle
  // ============================================

  onMount(() => {
    setupWSAndConnect(HUB_URL);

    // Restore tabs from localStorage
    tabs.restore();

    function handleKeydown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        if (e.key !== 'Escape') return;
      }

      const isMac = navigator.platform.includes('Mac');
      const cmdKey = isMac ? e.metaKey : e.ctrlKey;

      if (cmdKey && e.key === 'k') {
        e.preventDefault();
        ui.toggleCommandPalette();
        return;
      }

      if (cmdKey && e.key === 'n') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('agentdeck:new-instance'));
        return;
      }

      // Cmd+B — Toggle sidebar
      if (cmdKey && e.key === 'b') {
        e.preventDefault();
        ui.toggleSidebar();
        return;
      }
    }

    window.addEventListener('keydown', handleKeydown);

    return () => {
      window.removeEventListener('keydown', handleKeydown);
      disconnectWS();
    };
  });
</script>

<Toaster position="bottom-right" />
<AppShell>
  {#snippet workspace()}
    {@render children()}
  {/snippet}
</AppShell>
