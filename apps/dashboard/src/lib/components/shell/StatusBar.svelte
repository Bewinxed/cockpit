<script lang="ts">
  import { Bell, Circle } from 'lucide-svelte';
  import { Button } from '$lib/components/ui/button';
  import { ThemeSwitcher } from '$lib/components/ui';
  import {
    stats,
    pendingPermissionCount,
    connectionStatus,
    toggleNotificationCenter,
    sidebarFilter,
    toggleSidebarFilter
  } from '$lib/stores/realtime.svelte';

  const isFilteringRunning = $derived($sidebarFilter.type === 'running');

  const statusText = $derived.by(() => {
    switch ($connectionStatus) {
      case 'connected': return 'Connected';
      case 'connecting': return 'Connecting...';
      case 'error': return 'Connection error';
      default: return 'Disconnected';
    }
  });

  const statusColor = $derived.by(() => {
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
    <div class="flex items-center gap-1.5 {statusColor}">
      <Circle class="size-2 fill-current" />
      <span class="text-xs">{statusText}</span>
    </div>

    <!-- Running Instances (clickable to filter) -->
    <Button
      variant="ghost"
      size="sm"
      onclick={() => toggleSidebarFilter('running')}
      class="h-auto py-0.5 px-1.5 {isFilteringRunning ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'}"
      title={isFilteringRunning ? 'Show all instances' : 'Filter to running only'}
    >
      <span class="font-medium {isFilteringRunning ? '' : 'text-foreground'}">{$stats.runningInstances}</span>
      <span class="ml-1">running</span>
      {#if isFilteringRunning}
        <span class="ml-1 text-xs">(filtered)</span>
      {/if}
    </Button>

    <!-- Pending Permissions (clickable) -->
    {#if $pendingPermissionCount > 0}
      <Button
        variant="ghost"
        size="sm"
        onclick={toggleNotificationCenter}
        class="flex items-center gap-1.5 text-warning hover:text-warning/80 h-auto py-0.5 px-1.5"
      >
        <Bell class="size-3.5" />
        <span>{$pendingPermissionCount} pending</span>
      </Button>
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
