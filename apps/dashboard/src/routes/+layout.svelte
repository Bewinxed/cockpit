<script lang="ts">
  import '../app.css';
  import { page } from '$app/state';
  import { onMount, onDestroy } from 'svelte';
  import { HUB_URL } from '$lib/config';
  import {
    connect,
    disconnect,
    fetchAgents,
    fetchInstances,
    fetchProjects,
    connectionStatus,
    stats
  } from '$lib/stores/realtime';
  import {
    LayoutDashboard,
    FolderKanban,
    Terminal,
    Server,
    Sparkles,
    Settings,
    HelpCircle,
    Wifi,
    WifiOff,
    Loader2
  } from 'lucide-svelte';
  import Badge from '$lib/components/ui/Badge.svelte';

  interface Props {
    children: import('svelte').Snippet;
  }

  let { children }: Props = $props();

  // Connect to hub on mount
  onMount(() => {
    connect(HUB_URL);
    fetchAgents();
    fetchInstances();
    fetchProjects();
  });

  onDestroy(() => {
    disconnect();
  });

  const navItems = [
    { href: '/', label: 'Dashboard', icon: LayoutDashboard },
    { href: '/projects', label: 'Projects', icon: FolderKanban },
    { href: '/instances', label: 'Instances', icon: Terminal },
    { href: '/agents', label: 'Agents', icon: Server },
  ];

  function isActive(href: string): boolean {
    if (href === '/') {
      return page.url.pathname === '/';
    }
    return page.url.pathname.startsWith(href);
  }
</script>

<div class="flex min-h-screen bg-bg">
  <!-- Sidebar -->
  <aside class="fixed top-0 left-0 bottom-0 w-60 bg-surface border-r border-border flex flex-col">
    <!-- Logo -->
    <div class="flex items-center gap-2.5 px-5 py-5 border-b border-border">
      <div class="flex items-center justify-center w-8 h-8 rounded-lg bg-primary">
        <Sparkles class="w-4 h-4 text-white" />
      </div>
      <span class="text-lg font-semibold text-text">Cockpit</span>
    </div>

    <!-- Navigation -->
    <nav class="flex-1 px-3 py-4">
      <div class="space-y-1">
        {#each navItems as item}
          {@const active = isActive(item.href)}
          <a
            href={item.href}
            class="nav-item {active ? 'nav-item-active' : ''}"
          >
            <item.icon class="w-5 h-5" />
            <span>{item.label}</span>
          </a>
        {/each}
      </div>
    </nav>

    <!-- Footer -->
    <div class="px-4 py-4 border-t border-border space-y-3">
      <!-- Connection Status -->
      <div class="flex items-center gap-2">
        {#if $connectionStatus === 'connected'}
          <div class="relative">
            <Wifi class="w-4 h-4 text-success" />
            <span class="absolute -top-0.5 -right-0.5 w-2 h-2 bg-success rounded-full animate-pulse-soft"></span>
          </div>
          <span class="text-sm text-success font-medium">Connected</span>
        {:else if $connectionStatus === 'connecting'}
          <Loader2 class="w-4 h-4 text-warning animate-spin" />
          <span class="text-sm text-warning">Connecting...</span>
        {:else if $connectionStatus === 'error'}
          <WifiOff class="w-4 h-4 text-error" />
          <span class="text-sm text-error">Error</span>
        {:else}
          <WifiOff class="w-4 h-4 text-text-muted" />
          <span class="text-sm text-text-muted">Disconnected</span>
        {/if}
      </div>

      <!-- Stats Summary -->
      {#if $connectionStatus === 'connected'}
        <div class="flex items-center gap-3 text-xs text-text-secondary">
          <div class="flex items-center gap-1.5">
            <Server class="w-3.5 h-3.5" />
            <span>{$stats.onlineAgents} agents</span>
          </div>
          <span class="text-border">·</span>
          <div class="flex items-center gap-1.5">
            <Terminal class="w-3.5 h-3.5" />
            <span>{$stats.runningInstances} running</span>
          </div>
        </div>
      {/if}
    </div>
  </aside>

  <!-- Main content -->
  <main class="flex-1 ml-60 min-h-screen">
    <div class="p-8">
      {@render children()}
    </div>
  </main>
</div>
