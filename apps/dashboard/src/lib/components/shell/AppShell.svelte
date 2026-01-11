<script lang="ts">
  import Sidebar from './Sidebar.svelte';
  import TopBar from './TopBar.svelte';
  import StatusBar from './StatusBar.svelte';
  import WorkspaceTabs from '../workspace/WorkspaceTabs.svelte';
  import CommandPalette from '../command-palette/CommandPalette.svelte';
  import NotificationCenter from '../notifications/NotificationCenter.svelte';
  import NewInstanceModal from '../NewInstanceModal.svelte';
  import {
    commandPaletteOpen,
    notificationCenterOpen,
    sidebarCollapsed,
    sidebarOpen,
    toggleCommandPalette,
    toggleSidebar
  } from '$lib/stores/realtime.svelte';

  let showNewInstanceModal = $state(false);

  // Close sidebar on mobile when clicking backdrop
  function closeMobileSidebar() {
    if (typeof window !== 'undefined' && window.innerWidth < 1024) {
      sidebarOpen.set(false);
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
        toggleCommandPalette();
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
    {#if $sidebarOpen}
      <button
        type="button"
        class="fixed inset-0 bg-black/50 z-40 lg:hidden"
        onclick={closeMobileSidebar}
        aria-label="Close sidebar"
      ></button>
    {/if}

    <!-- Sidebar - fixed overlay on mobile, normal flow on desktop -->
    <div
      class="fixed inset-y-0 left-0 z-50 transition-transform duration-300 ease-in-out lg:relative lg:z-auto lg:translate-x-0 {$sidebarOpen ? 'translate-x-0' : '-translate-x-full'}"
    >
      <Sidebar
        collapsed={$sidebarCollapsed}
        onNewInstance={() => showNewInstanceModal = true}
      />
    </div>

    <!-- Main Workspace - Tabs with all open instances -->
    <main class="flex-1 flex flex-col overflow-hidden">
      <WorkspaceTabs onNewInstance={() => showNewInstanceModal = true} />
    </main>
  </div>

  <!-- Status Bar -->
  <StatusBar />

  <!-- Overlays -->
  {#if $commandPaletteOpen}
    <CommandPalette />
  {/if}

  {#if $notificationCenterOpen}
    <NotificationCenter />
  {/if}

  {#if showNewInstanceModal}
    <NewInstanceModal open={showNewInstanceModal} onClose={() => showNewInstanceModal = false} />
  {/if}
</div>
