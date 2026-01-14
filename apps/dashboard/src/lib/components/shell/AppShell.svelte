<script lang="ts">
  import Sidebar from './Sidebar.svelte';
  import TopBar from './TopBar.svelte';
  import StatusBar from './StatusBar.svelte';
  import WorkspaceTabs from '../workspace/WorkspaceTabs.svelte';
  import InstancesTable from '../workspace/InstancesTable.svelte';
  import CommandPalette from '../command-palette/CommandPalette.svelte';
  import NotificationCenter from '../notifications/NotificationCenter.svelte';
  import NewInstanceModal from '../NewInstanceModal.svelte';
  import { ui } from '$lib/stores';

  let showNewInstanceModal = $state(false);
  let showTableView = $state(false);

  // Close sidebar on mobile when clicking backdrop
  function closeMobileSidebar() {
    if (typeof window !== 'undefined' && window.innerWidth < 1024) {
      ui.sidebarOpen = false;
    }
  }

  // Listen for new instance event from keyboard shortcuts
  $effect(() => {
    const handler = () => {
      showNewInstanceModal = true;
    };
    window.addEventListener('cockpit:new-instance', handler);
    return () => window.removeEventListener('cockpit:new-instance', handler);
  });

  // Listen for table view toggle event
  $effect(() => {
    const handler = () => {
      showTableView = true;
    };
    window.addEventListener('cockpit:show-table-view', handler);
    return () => window.removeEventListener('cockpit:show-table-view', handler);
  });

  // Global keyboard shortcuts
  $effect(() => {
    const handleKeydown = (e: KeyboardEvent) => {
      // Ignore if in input/textarea
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      const isMac = navigator.platform.includes('Mac');
      const cmdKey = isMac ? e.metaKey : e.ctrlKey;

      // ⌘K - Command palette
      if (cmdKey && e.key === 'k') {
        e.preventDefault();
        ui.toggleCommandPalette();
      }

      // ⌘N - New instance
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
  <!-- Top Bar -->
  <TopBar />

  <div class="flex-1 flex overflow-hidden relative">
    <!-- Mobile Sidebar Backdrop -->
    {#if ui.sidebarOpen}
      <button
        type="button"
        class="fixed inset-0 bg-black/50 z-40 lg:hidden"
        onclick={closeMobileSidebar}
        aria-label="Close sidebar"
      ></button>
    {/if}

    <!-- Sidebar - fixed overlay on mobile, normal flow on desktop -->
    <div
      class="fixed inset-y-0 left-0 z-50 transition-transform duration-300 ease-in-out lg:relative lg:z-auto lg:translate-x-0 {ui.sidebarOpen ? 'translate-x-0' : '-translate-x-full'}"
    >
      <Sidebar
        collapsed={ui.sidebarCollapsed}
        onNewInstance={() => showNewInstanceModal = true}
      />
    </div>

    <!-- Main Workspace - Tabs with all open instances -->
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
      {:else}
        <WorkspaceTabs onNewInstance={() => showNewInstanceModal = true} />
      {/if}
    </main>
  </div>

  <!-- Status Bar -->
  <StatusBar />

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
