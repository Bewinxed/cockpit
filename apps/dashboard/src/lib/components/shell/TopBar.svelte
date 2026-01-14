<script lang="ts">
  import { Search, Bell, PanelLeft } from 'lucide-svelte';
  import { Button } from '$lib/components/ui/button';
  import { ui, permissions, connectionStatus } from '$lib/stores';

  const isMac = typeof navigator !== 'undefined' && navigator.platform.includes('Mac');
  const cmdKey = isMac ? '⌘' : 'Ctrl';
</script>

<header class="h-12 flex items-center justify-between px-4 border-b border-border bg-card/50 backdrop-blur-sm">
  <!-- Left: Logo & Sidebar Toggle -->
  <div class="flex items-center gap-3">
    <!-- Sidebar Toggle (visible on mobile or when sidebar is collapsed) -->
    <Button
      variant="ghost"
      size="icon"
      onclick={ui.toggleSidebar}
      class="lg:hidden"
      title={ui.sidebarCollapsed ? 'Open sidebar' : 'Close sidebar'}
    >
      <PanelLeft class="size-5" />
    </Button>

    <div class="flex items-center gap-2">
      <div class="size-7 bg-primary rounded-md flex items-center justify-center">
        <span class="text-primary-foreground font-bold text-sm">C</span>
      </div>
      <span class="font-semibold text-foreground hidden sm:inline">Cockpit</span>
    </div>
  </div>

  <!-- Center: Search -->
  <Button
    variant="outline"
    onclick={ui.toggleCommandPalette}
    class="flex items-center gap-2 px-3 py-1.5 bg-muted/50 hover:bg-muted min-w-[240px] justify-start"
  >
    <Search class="size-4" />
    <span class="text-sm flex-1 text-left text-muted-foreground">Search...</span>
    <kbd class="px-1.5 py-0.5 text-xs bg-background rounded border border-border font-mono">
      {cmdKey}K
    </kbd>
  </Button>

  <!-- Right: Actions -->
  <div class="flex items-center gap-2">
    <!-- Notifications -->
    <Button
      variant="ghost"
      size="icon"
      onclick={ui.toggleNotificationCenter}
      class="relative"
    >
      <Bell class="size-5 text-muted-foreground" />
      {#if permissions.count > 0}
        <span class="absolute top-1 right-1 size-4 bg-warning text-warning-foreground text-[10px] font-bold rounded-full flex items-center justify-center">
          {permissions.count}
        </span>
      {/if}
    </Button>

    <!-- Connection indicator -->
    <div class="flex items-center gap-1.5 px-2 py-1 rounded-lg">
      <div
        class="size-2 rounded-full"
        class:bg-success={connectionStatus === 'connected'}
        class:bg-warning={connectionStatus === 'connecting'}
        class:bg-error={connectionStatus === 'error'}
        class:bg-muted-foreground={connectionStatus === 'disconnected'}
        class:animate-pulse={connectionStatus === 'connecting'}
      ></div>
    </div>
  </div>
</header>
