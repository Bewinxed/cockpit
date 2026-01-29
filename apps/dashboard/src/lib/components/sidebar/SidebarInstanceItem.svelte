<script lang="ts">
  import { page } from '$app/state';
  import { Square, Copy, Trash2, Columns2 } from 'lucide-svelte';
  import * as SidebarUI from '$lib/components/ui/sidebar';
  import * as ContextMenu from '$lib/components/ui/context-menu';
  import { instances, ui, stopInstance as wsStopInstance, type Instance } from '$lib/stores';
  import { openInstance, closeTab } from '$lib/stores/url-sync.svelte';

  interface Props {
    instance: Instance;
    collapsed?: boolean;
  }

  let { instance, collapsed = false }: Props = $props();

  let isMenuOpen = $state(false);

  async function stopInstance() {
    try {
      await wsStopInstance({ instanceId: instance.id });
    } catch (error) {
      console.error('Failed to stop instance:', error);
    }
  }

  async function deleteInstance() {
    // Close tab if open
    closeTab(instance.id);
    // Stop the instance
    await stopInstance();
  }

  function openInSplitView() {
    ui.enableSplitView(instance.id);
  }

  // Check if this instance is the active tab
  const activeId = $derived(page.url.searchParams.get('active'));
  const tabsParam = $derived(page.url.searchParams.get('tabs'));
  const isActiveTab = $derived(activeId === instance.id);
  const isOpenTab = $derived(tabsParam?.split(',').includes(instance.id) ?? false);

  const streamingState = $derived(instances.getStreamingState(instance.id));

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

<ContextMenu.Root bind:open={isMenuOpen}>
  <ContextMenu.Trigger>
    {#snippet child({ props: contextProps })}
      <SidebarUI.SidebarMenuSubButton
        isActive={isActiveTab}
        title={collapsed ? displayName : undefined}
      >
        {#snippet child({ props: buttonProps })}
          {@const mergedClass = [buttonProps.class, contextProps.class].filter(Boolean).join(' ')}
          <a
            href="/instance/{instance.id}"
            data-sveltekit-preload-data="hover"
            {...buttonProps}
            {...contextProps}
            class={mergedClass}
            onclick={handleClick}
          >
            <!-- Status Dot -->
            <div class="relative shrink-0">
              <div class="size-2 rounded-full {statusColor}"></div>
              {#if streamingState?.isStreaming}
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
          </a>
        {/snippet}
      </SidebarUI.SidebarMenuSubButton>
    {/snippet}
  </ContextMenu.Trigger>

  <ContextMenu.Content class="w-48">
    <!-- Open in Split View -->
    <ContextMenu.Item onclick={openInSplitView}>
      <Columns2 class="mr-2 h-4 w-4" />
      Open in Split View
    </ContextMenu.Item>

    <!-- Copy Path -->
    <ContextMenu.Item onclick={() => navigator.clipboard.writeText(instance.cwd)}>
      <Copy class="mr-2 h-4 w-4" />
      Copy Path
    </ContextMenu.Item>

    <ContextMenu.Separator />

    <!-- Stop Instance (only if running) -->
    {#if instance.status === 'running' || instance.status === 'starting'}
      <ContextMenu.Item onclick={stopInstance}>
        <Square class="mr-2 h-4 w-4" />
        Stop Instance
      </ContextMenu.Item>
    {/if}

    <!-- Delete / Close -->
    <ContextMenu.Item class="text-destructive focus:text-destructive" onclick={deleteInstance}>
      <Trash2 class="mr-2 h-4 w-4" />
      Remove Instance
    </ContextMenu.Item>
  </ContextMenu.Content>
</ContextMenu.Root>
