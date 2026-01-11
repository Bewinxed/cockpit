<script lang="ts">
  import { Search, Bell, Command } from 'lucide-svelte';
  import {
    toggleCommandPalette,
    toggleNotificationCenter,
    pendingPermissionCount,
    connectionStatus
  } from '$lib/stores/realtime.svelte';

  const isMac = typeof navigator !== 'undefined' && navigator.platform.includes('Mac');
  const cmdKey = isMac ? '⌘' : 'Ctrl';
</script>

<header class="h-12 flex items-center justify-between px-4 border-b border-border bg-card/50 backdrop-blur-sm">
  <!-- Left: Logo -->
  <div class="flex items-center gap-3">
    <div class="flex items-center gap-2">
      <div class="size-7 bg-primary rounded-md flex items-center justify-center">
        <span class="text-primary-foreground font-bold text-sm">C</span>
      </div>
      <span class="font-semibold text-foreground">Cockpit</span>
    </div>
  </div>

  <!-- Center: Search -->
  <button
    class="flex items-center gap-2 px-3 py-1.5 bg-muted/50 hover:bg-muted rounded-lg text-muted-foreground hover:text-foreground transition-colors min-w-[240px]"
    onclick={toggleCommandPalette}
  >
    <Search class="w-4 h-4" />
    <span class="text-sm flex-1 text-left">Search...</span>
    <kbd class="px-1.5 py-0.5 text-xs bg-background rounded border border-border font-mono">
      {cmdKey}K
    </kbd>
  </button>

  <!-- Right: Actions -->
  <div class="flex items-center gap-2">
    <!-- Notifications -->
    <button
      class="relative p-2 rounded-lg hover:bg-muted transition-colors"
      onclick={toggleNotificationCenter}
    >
      <Bell class="w-5 h-5 text-muted-foreground" />
      {#if $pendingPermissionCount > 0}
        <span class="absolute top-1 right-1 size-4 bg-warning text-warning-foreground text-[10px] font-bold rounded-full flex items-center justify-center">
          {$pendingPermissionCount}
        </span>
      {/if}
    </button>

    <!-- Connection indicator -->
    <div class="flex items-center gap-1.5 px-2 py-1 rounded-lg">
      <div
        class="size-2 rounded-full"
        class:bg-success={$connectionStatus === 'connected'}
        class:bg-warning={$connectionStatus === 'connecting'}
        class:bg-error={$connectionStatus === 'error'}
        class:bg-muted-foreground={$connectionStatus === 'disconnected'}
        class:animate-pulse={$connectionStatus === 'connecting'}
      ></div>
    </div>
  </div>
</header>
