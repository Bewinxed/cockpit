<script lang="ts">
  import '../app.css';
  import '@xyflow/svelte/dist/style.css';
  import { onMount } from 'svelte';
  import { onNavigate } from '$app/navigation';
  import { toast } from 'svelte-sonner';
  import { HUB_URL } from '$lib/config';
  import { agents, instances, permissions, projects, ui, setupWSAndConnect, disconnectWS } from '$lib/stores';
  import { tabs } from '$lib/stores/tabs.svelte';
  import { getAgents, getInstances, getProjects } from '$lib/data.remote';
  import '$lib/stores/theme.svelte';
  import type { Snippet } from 'svelte';

  import AppShell from '$lib/components/shell/AppShell.svelte';
  import { Toaster } from '$lib/components/ui/sonner';

  let { children }: { children: Snippet } = $props();

  // ============================================
  // SSR Data Loading (remote functions)
  // ============================================

  // Call queries at top level - .current is available during SSR
  const agentsQuery = getAgents();
  const instancesQuery = getInstances();
  const projectsQuery = getProjects();

  // Sync SSR data to stores after hydration for WebSocket updates
  $effect(() => {
    if (agentsQuery.current?.length) {
      agents.initializeFromSSR(agentsQuery.current);
    }
  });

  $effect(() => {
    if (instancesQuery.current?.length) {
      instances.initializeFromSSR(instancesQuery.current);
    }
  });

  $effect(() => {
    if (projectsQuery.current?.length) {
      projects.initializeFromSSR(projectsQuery.current);
    }
  });

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
            onClick: () => tabs.open(perm.instanceId)
          },
          duration: 10000
        });
      }
    }
  });

  // View Transitions — wraps every client-side navigation with the browser's View Transition API
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
