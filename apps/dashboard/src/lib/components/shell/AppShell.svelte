<script lang="ts">
  import Sidebar from './Sidebar.svelte';
  import TopBar from './TopBar.svelte';
  import StatusBar from './StatusBar.svelte';
  import WorkspaceEmpty from '../workspace/WorkspaceEmpty.svelte';
  import WorkspaceInstance from '../workspace/WorkspaceInstance.svelte';
  import CommandPalette from '../command-palette/CommandPalette.svelte';
  import NotificationCenter from '../notifications/NotificationCenter.svelte';
  import NewInstanceModal from '../NewInstanceModal.svelte';
  import {
    selectedInstanceId,
    splitViewState,
    commandPaletteOpen,
    notificationCenterOpen,
    sidebarCollapsed,
    toggleCommandPalette
  } from '$lib/stores/realtime.svelte';

  let showNewInstanceModal = $state(false);

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

  <div class="flex-1 flex overflow-hidden">
    <!-- Sidebar -->
    <Sidebar
      collapsed={$sidebarCollapsed}
      onNewInstance={() => showNewInstanceModal = true}
    />

    <!-- Main Workspace -->
    <main class="flex-1 flex flex-col overflow-hidden">
      {#if $selectedInstanceId}
        <WorkspaceInstance instanceId={$selectedInstanceId} />
      {:else}
        <WorkspaceEmpty onNewInstance={() => showNewInstanceModal = true} />
      {/if}
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
    <NewInstanceModal onClose={() => showNewInstanceModal = false} />
  {/if}
</div>
