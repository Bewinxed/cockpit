<script lang="ts">
  import '../app.css';
  import { page } from '$app/stores';
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

  interface Props {
    children: import('svelte').Snippet;
  }

  let { children }: Props = $props();

  // Connect to hub on mount
  onMount(() => {
    connect(HUB_URL);
    // Fetch initial data using Eden Treaty (type-safe)
    fetchAgents();
    fetchInstances();
    fetchProjects();
  });

  onDestroy(() => {
    disconnect();
  });

  const navItems = [
    { href: '/', label: 'Dashboard', icon: '◈' },
    { href: '/projects', label: 'Projects', icon: '◇' },
    { href: '/instances', label: 'Instances', icon: '○' },
    { href: '/agents', label: 'Agents', icon: '●' },
  ];
</script>

<div class="flex min-h-screen">
  <!-- Sidebar -->
  <aside class="fixed top-0 left-0 bottom-0 w-60 bg-bg-2 border-r border-ui-1 flex flex-col p-5">
    <div class="flex items-center gap-3 py-2 mb-8">
      <span class="text-2xl text-primary">✧</span>
      <span class="text-xl font-semibold text-tx-1">Cockpit</span>
    </div>

    <nav class="flex flex-col gap-1 flex-1">
      {#each navItems as item}
        <a
          href={item.href}
          class="flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-150
            {$page.url.pathname === item.href ||
            (item.href !== '/' && $page.url.pathname.startsWith(item.href))
              ? 'bg-primary text-white shadow-md'
              : 'text-tx-2 hover:bg-bg-3 hover:text-tx-1'}"
        >
          <span class="text-base w-5 text-center">{item.icon}</span>
          <span>{item.label}</span>
        </a>
      {/each}
    </nav>

    <div class="pt-4 border-t border-ui-1">
      {#if $connectionStatus === 'connected'}
        <div class="flex items-center gap-2 text-sm text-flexoki-green">
          <span class="w-2 h-2 rounded-full bg-flexoki-green animate-pulse"></span>
          <span>Connected</span>
        </div>
        <div class="mt-2 text-xs text-tx-3">
          {$stats.onlineAgents} agents · {$stats.runningInstances} running
        </div>
      {:else if $connectionStatus === 'connecting'}
        <div class="flex items-center gap-2 text-sm text-yellow-500">
          <span class="w-2 h-2 rounded-full bg-yellow-500 animate-pulse"></span>
          <span>Connecting...</span>
        </div>
      {:else if $connectionStatus === 'error'}
        <div class="flex items-center gap-2 text-sm text-red-500">
          <span class="w-2 h-2 rounded-full bg-red-500"></span>
          <span>Connection error</span>
        </div>
      {:else}
        <div class="flex items-center gap-2 text-sm text-tx-3">
          <span class="w-2 h-2 rounded-full bg-tx-3"></span>
          <span>Disconnected</span>
        </div>
      {/if}
    </div>
  </aside>

  <!-- Main content -->
  <main class="flex-1 ml-60 p-8 min-h-screen">
    {@render children()}
  </main>
</div>
