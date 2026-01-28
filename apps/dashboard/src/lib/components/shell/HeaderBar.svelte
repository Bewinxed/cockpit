<script lang="ts">
  import { page } from '$app/state';
  import { X, Search, Bell, PanelLeft, Plus } from 'lucide-svelte';
  import * as ContextMenu from '$lib/components/ui/context-menu';
  import { Button } from '$lib/components/ui/button';
  import { instances, ui, permissions, connection } from '$lib/stores';
  import { switchToTab, closeTab, closeOtherTabs, closeAllTabs } from '$lib/stores/url-sync.svelte';

  interface Props {
    onNewInstance?: () => void;
  }

  let { onNewInstance }: Props = $props();

  const isMac = typeof navigator !== 'undefined' && navigator.platform.includes('Mac');
  const cmdKey = isMac ? '⌘' : 'Ctrl';

  // Parse tabs from URL reactively
  const tabsParam = $derived(page.url.searchParams.get('tabs'));
  const tabIds = $derived(tabsParam ? tabsParam.split(',').filter(Boolean) : []);
  const activeId = $derived(page.url.searchParams.get('active') ?? tabIds[0] ?? null);

  function getTabName(instanceId: string): string {
    const instance = instances.get(instanceId);
    if (instance?.name && instance.name !== 'Instance') {
      return instance.name.slice(0, 20);
    }
    if (instance?.cwd) {
      const parts = instance.cwd.split('/');
      return parts[parts.length - 1] || 'Instance';
    }
    return instanceId.slice(0, 8);
  }

  function getStatusColor(instanceId: string): string {
    const instance = instances.get(instanceId);
    switch (instance?.status) {
      case 'running': return 'bg-success';
      case 'starting': return 'bg-warning animate-pulse';
      case 'error': return 'bg-destructive';
      case 'sleeping': return 'bg-info';
      default: return 'bg-muted-foreground/30';
    }
  }

  function handleCloseTab(e: MouseEvent, id: string) {
    e.stopPropagation();
    e.preventDefault();
    closeTab(id);
  }

  function copyInstancePath(id: string) {
    const instance = instances.get(id);
    if (instance?.cwd) {
      navigator.clipboard.writeText(instance.cwd);
    }
  }
</script>

<header class="h-10 flex items-center border-b border-border bg-card/50 backdrop-blur-sm shrink-0">
  <!-- Left: Logo & Sidebar Toggle -->
  <div class="flex items-center gap-2 px-3 shrink-0">
    <Button
      variant="ghost"
      size="icon-sm"
      onclick={ui.toggleSidebar}
      class="lg:hidden"
      title={ui.sidebarCollapsed ? 'Open sidebar' : 'Close sidebar'}
    >
      <PanelLeft class="size-4" />
    </Button>

    <div class="flex items-center gap-1.5">
      <div class="size-6 bg-primary rounded-md flex items-center justify-center">
        <span class="text-primary-foreground font-bold text-xs">C</span>
      </div>
      <span class="font-semibold text-foreground text-sm hidden sm:inline">Cockpit</span>
    </div>

    <!-- Divider -->
    <div class="w-px h-5 bg-border ml-1"></div>
  </div>

  <!-- Center: Inline Tabs -->
  <div class="flex-1 flex items-center overflow-x-auto scrollbar-none gap-0 min-w-0">
    {#each tabIds as id (id)}
      <ContextMenu.Root>
        <ContextMenu.Trigger>
          <button
            class="group relative flex items-center gap-1.5 h-10 px-3 text-sm border-r border-border transition-colors shrink-0
              {id === activeId ? 'bg-background text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}"
            onclick={() => switchToTab(id)}
          >
            <!-- Status dot -->
            <div class="size-1.5 rounded-full {getStatusColor(id)} shrink-0"></div>

            <!-- Tab name -->
            <span class="truncate max-w-28">
              {getTabName(id)}
            </span>

            <!-- Close button -->
            <span
              role="button"
              tabindex="-1"
              class="inline-flex items-center justify-center size-4 rounded-sm opacity-0 group-hover:opacity-100 {id === activeId ? 'opacity-100' : ''} ml-0.5 hover:bg-muted shrink-0"
              onclick={(e: MouseEvent) => handleCloseTab(e, id)}
              onkeydown={(e: KeyboardEvent) => e.key === 'Enter' && handleCloseTab(e as unknown as MouseEvent, id)}
            >
              <X class="size-3" />
            </span>

            <!-- Active indicator line -->
            {#if id === activeId}
              <div class="absolute bottom-0 left-0 right-0 h-0.5 bg-primary"></div>
            {/if}
          </button>
        </ContextMenu.Trigger>

        <ContextMenu.Content class="w-48">
          <ContextMenu.Item onclick={() => ui.enableSplitView(id)}>
            Open in Split View
          </ContextMenu.Item>
          <ContextMenu.Item onclick={() => copyInstancePath(id)}>
            Copy Path
          </ContextMenu.Item>
          <ContextMenu.Separator />
          <ContextMenu.Item onclick={() => closeTab(id)}>
            Close Tab
          </ContextMenu.Item>
          <ContextMenu.Item onclick={() => closeOtherTabs(id)}>
            Close Other Tabs
          </ContextMenu.Item>
          <ContextMenu.Item class="text-destructive focus:text-destructive" onclick={closeAllTabs}>
            Close All Tabs
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Root>
    {/each}

    <!-- New tab button -->
    <button
      class="flex items-center justify-center size-10 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors shrink-0"
      onclick={() => onNewInstance?.()}
      title="New Instance"
    >
      <Plus class="size-4" />
    </button>
  </div>

  <!-- Right: Actions -->
  <div class="flex items-center gap-1.5 px-3 shrink-0">
    <!-- Search -->
    <Button
      variant="ghost"
      size="sm"
      onclick={ui.toggleCommandPalette}
      class="hidden sm:flex items-center gap-1.5 h-7 px-2 text-muted-foreground"
    >
      <Search class="size-3.5" />
      <kbd class="px-1 py-0.5 text-[10px] bg-muted rounded border border-border font-mono">
        {cmdKey}K
      </kbd>
    </Button>

    <!-- Notifications -->
    <Button
      variant="ghost"
      size="icon-sm"
      onclick={ui.toggleNotificationCenter}
      class="relative"
    >
      <Bell class="size-4 text-muted-foreground" />
      {#if permissions.count > 0}
        <span class="absolute -top-0.5 -right-0.5 size-3.5 bg-warning text-warning-foreground text-[9px] font-bold rounded-full flex items-center justify-center">
          {permissions.count}
        </span>
      {/if}
    </Button>

    <!-- Connection indicator -->
    <div
      class="size-2 rounded-full shrink-0"
      class:bg-success={connection.status === 'connected'}
      class:bg-warning={connection.status === 'connecting'}
      class:bg-error={connection.status === 'error'}
      class:bg-muted-foreground={connection.status === 'disconnected'}
      class:animate-pulse={connection.status === 'connecting'}
      title={connection.status}
    ></div>
  </div>
</header>

<style>
  .scrollbar-none {
    scrollbar-width: none;
    -ms-overflow-style: none;
  }
  .scrollbar-none::-webkit-scrollbar {
    display: none;
  }
</style>
