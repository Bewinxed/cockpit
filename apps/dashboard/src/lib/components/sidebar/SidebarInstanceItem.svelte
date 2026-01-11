<script lang="ts">
  import { page } from '$app/state';
  import * as SidebarUI from '$lib/components/ui/sidebar';
  import type { Instance } from '$lib/stores/realtime.svelte';
  import { getStreamingState } from '$lib/stores/realtime.svelte';
  import { openInstance, getTabsFromUrl } from '$lib/stores/url-sync.svelte';

  interface Props {
    instance: Instance;
    collapsed?: boolean;
  }

  let { instance, collapsed = false }: Props = $props();

  // Check if this instance is the active tab
  const activeId = $derived(page.url.searchParams.get('active'));
  const tabsParam = $derived(page.url.searchParams.get('tabs'));
  const isActiveTab = $derived(activeId === instance.id);
  const isOpenTab = $derived(tabsParam?.split(',').includes(instance.id) ?? false);

  const streamingState = $derived(getStreamingState(instance.id));

  const statusColor = $derived.by(() => {
    switch (instance.status) {
      case 'running': return 'bg-success';
      case 'starting': return 'bg-warning animate-pulse';
      case 'error': return 'bg-destructive';
      case 'sleeping': return 'bg-info';
      default: return 'bg-muted-foreground/30';
    }
  });

  // Extract short name from cwd or lastPrompt
  const displayName = $derived.by(() => {
    if (instance.name && instance.name !== 'Instance') {
      return instance.name.slice(0, 30);
    }
    // Fallback to last path segment of cwd
    const parts = instance.cwd.split('/');
    return parts[parts.length - 1] || 'Instance';
  });

  function handleClick(e: MouseEvent) {
    e.preventDefault();
    // Cmd+Click (Mac) or Ctrl+Click (Windows/Linux) opens new tab
    const newTab = e.metaKey || e.ctrlKey;
    openInstance(instance.id, newTab);
  }
</script>

<SidebarUI.SidebarMenuSubButton
  href="/?tabs={instance.id}&active={instance.id}"
  onclick={handleClick}
  isActive={isActiveTab}
  title={collapsed ? displayName : undefined}
>
  <!-- Status Dot -->
  <div class="relative flex-shrink-0">
    <div class="size-2 rounded-full {statusColor}"></div>
    {#if $streamingState?.isStreaming}
      <div class="absolute -top-0.5 -right-0.5 size-1.5 bg-info rounded-full animate-ping"></div>
    {/if}
  </div>

  <span class="flex-1 truncate">
    {displayName}
  </span>

  <!-- Indicate if open but not active -->
  {#if isOpenTab && !isActiveTab}
    <div class="size-1.5 rounded-full bg-primary/50"></div>
  {/if}

  <!-- Cost (if running) -->
  {#if instance.status === 'running' && instance.totalCostUsd}
    <span class="text-xs opacity-60 font-mono">
      ${instance.totalCostUsd.toFixed(2)}
    </span>
  {/if}
</SidebarUI.SidebarMenuSubButton>
