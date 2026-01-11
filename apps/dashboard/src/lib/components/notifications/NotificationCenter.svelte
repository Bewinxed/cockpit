<script lang="ts">
  import { Bell, X, Terminal, Shield } from 'lucide-svelte';
  import { Button } from '$lib/components/ui/button';
  import {
    allPendingPermissions,
    pendingPermissionCount,
    toggleNotificationCenter,
    instances
  } from '$lib/stores/realtime.svelte';
  import { navigateToInstance } from '$lib/stores/url-sync.svelte';
  import PermissionNotification from './PermissionNotification.svelte';

  function handlePermissionClick(instanceId: string) {
    navigateToInstance(instanceId, true);
    toggleNotificationCenter();
  }

  function getInstanceName(instanceId: string): string {
    const instance = $instances.get(instanceId);
    if (!instance) return 'Unknown Instance';
    if (instance.name && instance.name !== 'Instance') {
      return instance.name;
    }
    const parts = instance.cwd.split('/');
    return parts[parts.length - 1] || 'Instance';
  }
</script>

<!-- Backdrop -->
<div
  class="fixed inset-0 z-40"
  onclick={toggleNotificationCenter}
  onkeydown={(e) => e.key === 'Escape' && toggleNotificationCenter()}
  role="button"
  tabindex="-1"
></div>

<!-- Notification Panel -->
<div class="fixed top-12 right-4 w-96 max-h-[calc(100vh-6rem)] bg-card border border-border rounded-xl shadow-2xl z-50 overflow-hidden flex flex-col">
  <!-- Header -->
  <div class="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
    <div class="flex items-center gap-2">
      <Bell class="w-4 h-4 text-muted-foreground" />
      <span class="font-medium text-foreground">Notifications</span>
      {#if $pendingPermissionCount > 0}
        <span class="px-1.5 py-0.5 text-xs bg-warning text-warning-foreground rounded-full">
          {$pendingPermissionCount}
        </span>
      {/if}
    </div>
    <Button variant="ghost" size="icon-sm" onclick={toggleNotificationCenter}>
      <X class="w-4 h-4" />
    </Button>
  </div>

  <!-- Content -->
  <div class="flex-1 overflow-y-auto">
    {#if $allPendingPermissions.length === 0}
      <!-- Empty State -->
      <div class="flex flex-col items-center justify-center py-12 px-4 text-center">
        <div class="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
          <Shield class="w-6 h-6 text-muted-foreground" />
        </div>
        <p class="text-sm font-medium text-foreground">All caught up!</p>
        <p class="text-xs text-muted-foreground mt-1">
          No pending permission requests
        </p>
      </div>
    {:else}
      <!-- Permission Requests -->
      <div class="divide-y divide-border">
        {#each $allPendingPermissions as permission (permission.requestId)}
          <PermissionNotification
            {permission}
            instanceName={getInstanceName(permission.instanceId)}
            onClick={() => handlePermissionClick(permission.instanceId)}
          />
        {/each}
      </div>
    {/if}
  </div>

  <!-- Footer -->
  {#if $allPendingPermissions.length > 0}
    <div class="px-4 py-2 border-t border-border bg-muted/30">
      <p class="text-xs text-muted-foreground text-center">
        Click a request to jump to that instance
      </p>
    </div>
  {/if}
</div>
