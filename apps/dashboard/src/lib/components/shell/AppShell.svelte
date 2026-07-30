<script lang="ts">
  import type { Snippet } from 'svelte';
  import { page } from '$app/state';
  import Sidebar from './Sidebar.svelte';
  import { Provider as SidebarProvider } from '$lib/components/ui/sidebar';
  import HeaderBar from './HeaderBar.svelte';
  import WorkspaceContent from '../workspace/WorkspaceContent.svelte';
  import InstancesTable from '../workspace/InstancesTable.svelte';
  import CommandPalette from '../command-palette/CommandPalette.svelte';
  import NotificationCenter from '../notifications/NotificationCenter.svelte';
  import NewInstanceModal from '../NewInstanceModal.svelte';
  import { ui } from '$lib/stores';

  let { children, workspace }: { children?: Snippet; workspace?: Snippet } = $props();

  let showNewInstanceModal = $state(false);
  let showTableView = $state(false);

  function closeMobileSidebar() {
    if (typeof window !== 'undefined' && window.innerWidth < 1024) {
      ui.sidebarOpen = false;
    }
  }

  $effect(() => {
    const handler = () => {
      showNewInstanceModal = true;
    };
    window.addEventListener('agentdeck:new-instance', handler);
    return () => window.removeEventListener('agentdeck:new-instance', handler);
  });

  $effect(() => {
    const handler = () => {
      showTableView = true;
    };
    window.addEventListener('agentdeck:show-table-view', handler);
    return () => window.removeEventListener('agentdeck:show-table-view', handler);
  });

  $effect(() => {
    const handleKeydown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      const isMac = navigator.platform.includes('Mac');
      const cmdKey = isMac ? e.metaKey : e.ctrlKey;

      if (cmdKey && e.key === 'k') {
        e.preventDefault();
        ui.toggleCommandPalette();
      }

      if (cmdKey && e.key === 'n') {
        e.preventDefault();
        showNewInstanceModal = true;
      }
    };

    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  });
</script>

<div class="h-screen flex flex-col bg-background overflow-hidden">
  <!-- Header Bar (logo + inline tabs + search + connection) -->
  <HeaderBar onNewInstance={() => showNewInstanceModal = true} />

  <SidebarProvider class="flex-1 flex overflow-hidden relative min-h-0">
    <!-- Mobile Sidebar Backdrop -->
    {#if ui.sidebarOpen}
      <button
        type="button"
        class="fixed inset-0 bg-black/50 z-40 lg:hidden"
        onclick={closeMobileSidebar}
        aria-label="Close sidebar"
      ></button>
    {/if}

    <!-- Sidebar -->
    <div
      class="fixed inset-y-0 left-0 z-50 transition-transform duration-300 ease-in-out lg:relative lg:z-auto lg:translate-x-0 {ui.sidebarOpen ? 'translate-x-0' : '-translate-x-full'}"
    >
      <Sidebar
        collapsed={ui.sidebarCollapsed}
        onNewInstance={() => showNewInstanceModal = true}
      />
    </div>

    <!-- Main Workspace -->
    <main class="flex-1 flex flex-col overflow-hidden">
      {#if showTableView}
        <div class="flex-1 flex flex-col overflow-hidden">
          <div class="flex items-center justify-between px-4 py-2 border-b border-border bg-card/50">
            <h1 class="text-lg font-semibold">All Instances</h1>
            <button
              class="text-sm text-muted-foreground hover:text-foreground"
              onclick={() => showTableView = false}
            >
              Close Table View
            </button>
          </div>
          <InstancesTable />
        </div>
      {:else if page.route.id === '/'}
        <WorkspaceContent onNewInstance={() => showNewInstanceModal = true} />
      {:else}
        {@render (workspace ?? children)?.()}
      {/if}
    </main>
  </SidebarProvider>

  <!-- Overlays -->
  {#if ui.commandPaletteOpen}
    <CommandPalette />
  {/if}

  {#if ui.notificationCenterOpen}
    <NotificationCenter />
  {/if}

  {#if showNewInstanceModal}
    <NewInstanceModal open={showNewInstanceModal} onClose={() => showNewInstanceModal = false} />
  {/if}
</div>
