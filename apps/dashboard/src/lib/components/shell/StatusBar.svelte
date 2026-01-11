<script lang="ts">
  import { Bell, Circle } from 'lucide-svelte';
  import { ThemeSwitcher } from '$lib/components/ui';
  import {
    stats,
    pendingPermissionCount,
    connectionStatus,
    toggleNotificationCenter
  } from '$lib/stores/realtime.svelte';

  const statusText = $derived(() => {
    switch ($connectionStatus) {
      case 'connected': return 'Connected';
      case 'connecting': return 'Connecting...';
      case 'error': return 'Connection error';
      default: return 'Disconnected';
    }
  });

  const statusColor = $derived(() => {
    switch ($connectionStatus) {
      case 'connected': return 'text-success';
      case 'connecting': return 'text-warning';
      case 'error': return 'text-error';
      default: return 'text-muted-foreground';
    }
  });
</script>

<footer class="h-9 flex items-center justify-between px-4 border-t border-border bg-card text-sm">
  <!-- Left: Status & Metrics -->
  <div class="flex items-center gap-4">
    <!-- Connection Status -->
    <div class="flex items-center gap-1.5 {statusColor()}">
      <Circle class="w-2 h-2 fill-current" />
      <span class="text-xs">{statusText()}</span>
    </div>

    <!-- Running Instances -->
    <span class="text-muted-foreground">
      <span class="font-medium text-foreground">{$stats.runningInstances}</span> running
    </span>

    <!-- Pending Permissions (clickable) -->
    {#if $pendingPermissionCount > 0}
      <button
        class="flex items-center gap-1.5 text-warning hover:text-warning/80 transition-colors"
        onclick={toggleNotificationCenter}
      >
        <Bell class="w-3.5 h-3.5" />
        <span>{$pendingPermissionCount} pending</span>
      </button>
    {/if}
  </div>

  <!-- Right: Cost & Settings -->
  <div class="flex items-center gap-4">
    <!-- Today's Cost -->
    <span class="text-muted-foreground font-mono text-xs">
      ${$stats.totalCostUsd.toFixed(2)} today
    </span>

    <!-- Theme Toggle -->
    <ThemeSwitcher />

    <!-- Version -->
    <span class="text-xs text-muted-foreground">v0.1.0</span>
  </div>
</footer>
