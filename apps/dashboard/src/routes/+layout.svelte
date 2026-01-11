<script lang="ts">
  import '../app.css';
  import { page } from '$app/state';
  import { onMount, onDestroy } from 'svelte';
  import { HUB_URL } from '$lib/config';
  import {
    connect,
    disconnect,
    initializeFromSSR,
    connectionStatus,
    stats
  } from '$lib/stores/realtime.svelte';
  import { getAgents, getInstances, getProjects } from '$lib/data.remote';
  import {
    LayoutDashboard,
    FolderKanban,
    Terminal,
    Server,
    ChevronRight,
    Loader2,
    Plus,
    ArrowUpRight,
    Hexagon
  } from 'lucide-svelte';
  import { ThemeSwitcher } from '$lib/components/ui';
  import '$lib/stores/theme';

  interface Props {
    children: import('svelte').Snippet;
  }

  let { children }: Props = $props();

  // Load data during SSR via remote functions
  const agentsData = await getAgents();
  const instancesData = await getInstances();
  const projectsData = await getProjects();

  // Initialize stores from SSR data and connect to real-time updates
  onMount(() => {
    initializeFromSSR(agentsData, instancesData, projectsData);
    connect(HUB_URL);
  });

  onDestroy(() => {
    disconnect();
  });

  const navItems = [
    { href: '/', label: 'Dashboard', icon: LayoutDashboard, shortcut: '1' },
    { href: '/projects', label: 'Projects', icon: FolderKanban, shortcut: '2' },
    { href: '/instances', label: 'Instances', icon: Terminal, shortcut: '3' },
    { href: '/agents', label: 'Agents', icon: Server, shortcut: '4' },
  ];

  function isActive(href: string): boolean {
    if (href === '/') {
      return page.url.pathname === '/';
    }
    return page.url.pathname.startsWith(href);
  }

  // Connection status config
  const statusConfig = $derived({
    connected: { color: 'text-success', label: 'Online' },
    connecting: { color: 'text-warning', label: 'Connecting' },
    error: { color: 'text-error', label: 'Error' },
    disconnected: { color: 'text-muted-foreground', label: 'Offline' },
  }[$connectionStatus] || { color: 'text-muted-foreground', label: 'Offline' });
</script>

<div class="min-h-screen bg-background relative">
  <!-- Noise Overlay -->
  <div class="fixed inset-0 pointer-events-none z-50 opacity-[0.02] mix-blend-overlay">
    <svg class="w-full h-full">
      <filter id="noiseFilter">
        <feTurbulence type="fractalNoise" baseFrequency="0.6" numOctaves="3" stitchTiles="stitch" />
      </filter>
      <rect width="100%" height="100%" filter="url(#noiseFilter)" />
    </svg>
  </div>

  <!-- Grid Lines Overlay (subtle) -->
  <div class="fixed inset-0 pointer-events-none z-0 hidden lg:block">
    <div class="max-w-[1600px] mx-auto h-full border-x border-border/30"></div>
  </div>

  <div class="flex relative z-10">
    <!-- Sidebar - Swiss Industrial Style -->
    <aside class="fixed top-0 left-0 bottom-0 w-64 bg-card flex flex-col border-r border-border z-30">

      <!-- Logo Header -->
      <div class="p-6 border-b border-border">
        <div class="flex items-center gap-3 group cursor-pointer">
          <div class="relative">
            <div class="size-10 bg-primary flex items-center justify-center">
              <span class="text-primary-foreground font-sans font-bold text-xl italic">C</span>
            </div>
            <div class="absolute -top-1 -right-1 w-2 h-2 bg-info rounded-full animate-pulse"></div>
          </div>
          <div class="flex-1">
            <h1 class="text-lg font-sans font-bold tracking-tight text-foreground">
              Cockpit
            </h1>
            <span class="text-[10px] font-mono text-muted-foreground uppercase tracking-[0.2em]">
              Orchestration
            </span>
          </div>
        </div>
      </div>

      <!-- Tech Specs Banner -->
      <div class="px-6 py-4 border-b border-border bg-muted/50">
        <div class="flex items-center gap-2 mb-2">
          <div class="w-1.5 h-1.5 rounded-full {$connectionStatus === 'connected' ? 'bg-success animate-pulse' : 'bg-text-muted'}"></div>
          <span class="text-[10px] font-mono uppercase tracking-widest {statusConfig.color}">
            {statusConfig.label}
          </span>
        </div>
        {#if $connectionStatus === 'connected'}
          <div class="flex items-center gap-4 text-[11px] font-mono text-muted-foreground">
            <span><span class="text-muted-foreground font-bold">{$stats.onlineAgents}</span> {$stats.onlineAgents === 1 ? 'agent' : 'agents'}</span>
            <span class="text-border">·</span>
            <span><span class="text-muted-foreground font-bold">{$stats.runningInstances}</span> active</span>
          </div>
        {/if}
      </div>

      <!-- Navigation -->
      <nav class="flex-1 py-6 overflow-y-auto">
        <div class="px-4 mb-4">
          <span class="text-[10px] font-mono text-muted-foreground uppercase tracking-[0.2em]">Navigation</span>
        </div>

        <div class="space-y-1 px-3">
          {#each navItems as item}
            {@const active = isActive(item.href)}
            {@const Icon = item.icon}
            <a
              href={item.href}
              class="group flex items-center gap-3 px-4 py-3 transition-all duration-200 relative
                     {active
                       ? 'bg-primary text-primary-foreground'
                       : 'text-muted-foreground hover:bg-accent hover:text-foreground'}"
            >
              {#if active}
                <div class="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-info"></div>
              {/if}
              <Icon class="w-4 h-4 {active ? 'text-primary-foreground' : 'text-muted-foreground group-hover:text-foreground'} transition-colors" />
              <span class="flex-1 text-sm font-medium">{item.label}</span>
              <span class="text-[10px] font-mono {active ? 'text-primary-foreground/60' : 'text-muted-foreground'} opacity-0 group-hover:opacity-100 transition-opacity">
                {item.shortcut}
              </span>
              {#if active}
                <ArrowUpRight class="w-3.5 h-3.5 text-primary-foreground/60" />
              {/if}
            </a>
          {/each}
        </div>
      </nav>

      <!-- Footer -->
      <div class="border-t border-border">
        <!-- Stats Row -->
        {#if $connectionStatus === 'connected'}
          <div class="grid grid-cols-2 divide-x divide-border text-center">
            <div class="py-4">
              <div class="text-2xl font-bold text-foreground tracking-tight">{$stats.totalInstances}</div>
              <div class="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">{$stats.totalInstances === 1 ? 'Instance' : 'Instances'}</div>
            </div>
            <div class="py-4">
              <div class="text-2xl font-bold text-foreground tracking-tight">{$stats.totalProjects}</div>
              <div class="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">{$stats.totalProjects === 1 ? 'Project' : 'Projects'}</div>
            </div>
          </div>
        {/if}

        <!-- Bottom Bar -->
        <div class="px-4 py-4 border-t border-border bg-muted/50 flex items-center justify-between">
          <ThemeSwitcher />
          <span class="text-[10px] font-mono text-muted-foreground tracking-widest">v0.1.0</span>
        </div>
      </div>
    </aside>

    <!-- Main Content -->
    <main class="flex-1 ml-64 min-h-screen">
      {@render children()}
    </main>
  </div>
</div>

<style>
  /* Smooth sidebar transitions */
  aside {
    transition: width 300ms cubic-bezier(0.16, 1, 0.3, 1);
  }

  /* Navigation link hover underline effect */
  nav a::after {
    content: '';
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 1px;
    background: var(--color-border);
    transform: scaleX(0);
    transition: transform 200ms ease-out;
  }

  nav a:hover::after {
    transform: scaleX(1);
  }
</style>
