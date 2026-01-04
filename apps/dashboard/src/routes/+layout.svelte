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
    ChevronRight,
    Wifi,
    WifiOff,
    Loader2,
    Circle
  } from 'lucide-svelte';

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
    { href: '/', label: 'Dashboard', icon: LayoutDashboard, emoji: '🏠' },
    { href: '/projects', label: 'Projects', icon: FolderKanban, emoji: '📁' },
    { href: '/instances', label: 'Instances', icon: Terminal, emoji: '💻' },
    { href: '/agents', label: 'Agents', icon: Server, emoji: '🤖' },
  ];

  function isActive(href: string): boolean {
    if (href === '/') {
      return page.url.pathname === '/';
    }
    return page.url.pathname.startsWith(href);
  }

  // Connection status helpers
  const statusConfig = $derived({
    connected: { color: 'text-success', bg: 'bg-success', label: 'Connected' },
    connecting: { color: 'text-warning', bg: 'bg-warning', label: 'Connecting...' },
    error: { color: 'text-error', bg: 'bg-error', label: 'Error' },
    disconnected: { color: 'text-text-muted', bg: 'bg-text-muted', label: 'Offline' },
  }[$connectionStatus] || { color: 'text-text-muted', bg: 'bg-text-muted', label: 'Offline' });
</script>

<div class="flex min-h-screen bg-bg">
  <!-- Sidebar - Notion-inspired -->
  <aside class="fixed top-0 left-0 bottom-0 w-56 bg-surface flex flex-col border-r border-border">
    <!-- Logo & Workspace -->
    <div class="flex items-center gap-2.5 px-3 py-3 hover:bg-surface-hover transition-colors cursor-pointer rounded-lg mx-2 mt-2">
      <div class="flex items-center justify-center w-7 h-7 rounded-md bg-primary text-text-inverse text-sm font-bold">
        C
      </div>
      <div class="flex-1 min-w-0">
        <span class="text-sm font-semibold text-text block truncate">Cockpit</span>
        <span class="text-xs text-text-muted block truncate">AI Orchestration</span>
      </div>
      <ChevronRight class="w-4 h-4 text-text-muted flex-shrink-0" />
    </div>

    <!-- Navigation -->
    <nav class="flex-1 px-2 py-3 overflow-y-auto">
      <div class="space-y-0.5">
        {#each navItems as item}
          {@const active = isActive(item.href)}
          <a
            href={item.href}
            class="group flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-sm transition-all duration-100
                   {active
                     ? 'bg-primary-light text-primary font-medium'
                     : 'text-text-secondary hover:bg-surface-hover hover:text-text'}"
          >
            <span class="text-base leading-none">{item.emoji}</span>
            <span class="flex-1">{item.label}</span>
            {#if active}
              <div class="w-1.5 h-1.5 rounded-full bg-primary"></div>
            {/if}
          </a>
        {/each}
      </div>
    </nav>

    <!-- Footer Stats -->
    <div class="px-3 py-3 border-t border-border">
      <!-- Connection Status -->
      <div class="flex items-center gap-2 mb-2">
        <div class="relative">
          {#if $connectionStatus === 'connected'}
            <Circle class="w-2 h-2 fill-success text-success" />
            <span class="absolute inset-0 rounded-full bg-success animate-pulse-soft"></span>
          {:else if $connectionStatus === 'connecting'}
            <Loader2 class="w-3 h-3 text-warning animate-spin" />
          {:else}
            <Circle class="w-2 h-2 fill-text-muted text-text-muted" />
          {/if}
        </div>
        <span class="text-xs {statusConfig.color} font-medium">
          {statusConfig.label}
        </span>
      </div>

      <!-- Quick Stats -->
      {#if $connectionStatus === 'connected'}
        <div class="flex items-center gap-3 text-xs text-text-muted">
          <div class="flex items-center gap-1">
            <span class="font-medium text-text-secondary">{$stats.onlineAgents}</span>
            <span>agents</span>
          </div>
          <span class="text-border">•</span>
          <div class="flex items-center gap-1">
            <span class="font-medium text-text-secondary">{$stats.runningInstances}</span>
            <span>running</span>
          </div>
        </div>
      {/if}
    </div>
  </aside>

  <!-- Main content -->
  <main class="flex-1 ml-56 min-h-screen">
    <div class="p-6">
      {@render children()}
    </div>
  </main>
</div>

<style>
  /* Subtle hover states */
  aside {
    transition: background-color 150ms ease;
  }

  /* Smooth navigation link transitions */
  nav a {
    will-change: background-color;
  }
</style>
