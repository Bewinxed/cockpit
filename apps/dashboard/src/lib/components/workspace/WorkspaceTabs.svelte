<script lang="ts">
  import { page } from '$app/state';
  import { X, Columns2, XCircle, Copy } from 'lucide-svelte';
  import * as Tabs from '$lib/components/ui/tabs';
  import * as ContextMenu from '$lib/components/ui/context-menu';
  import { Button } from '$lib/components/ui/button';
  import { instances, ui } from '$lib/stores';
  import { switchToTab, closeTab, closeOtherTabs, closeAllTabs } from '$lib/stores/url-sync.svelte';
  import WorkspaceInstance from './WorkspaceInstance.svelte';
  import WorkspaceEmpty from './WorkspaceEmpty.svelte';
  import WorkspaceSplit from './WorkspaceSplit.svelte';

  interface Props {
    onNewInstance?: () => void;
  }

  let { onNewInstance }: Props = $props();

  // Parse tabs from URL reactively
  const tabsParam = $derived(page.url.searchParams.get('tabs'));
  const tabIds = $derived(tabsParam ? tabsParam.split(',').filter(Boolean) : []);
  const activeId = $derived(page.url.searchParams.get('active') ?? tabIds[0] ?? null);

  // Get display name for tab
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

  // Get status color for tab indicator
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

{#if tabIds.length === 0}
  <WorkspaceEmpty {onNewInstance} />
{:else}
  <div class="flex-1 flex flex-col overflow-hidden">
    <!-- Tab Bar -->
    <Tabs.Root value={activeId} onValueChange={switchToTab} class="flex-1 flex flex-col overflow-hidden">
      <div class="flex-shrink-0 border-b border-border bg-card/50">
        <Tabs.List class="h-10 bg-transparent p-0 gap-0">
          {#each tabIds as id (id)}
            <ContextMenu.Root>
              <ContextMenu.Trigger>
                <Tabs.Trigger
                  value={id}
                  class="group relative h-10 px-3 rounded-none border-r border-border data-[state=active]:bg-background data-[state=active]:shadow-none gap-2"
                >
                  <!-- Status dot -->
                  <div class="size-2 rounded-full {getStatusColor(id)}"></div>

                  <!-- Tab name -->
                  <span class="truncate max-w-32 text-sm">
                    {getTabName(id)}
                  </span>

                  <!-- Close button - using span to avoid nested buttons -->
                  <span
                    role="button"
                    tabindex="-1"
                    class="inline-flex items-center justify-center size-5 rounded-sm opacity-0 group-hover:opacity-100 group-data-[state=active]:opacity-100 ml-1 hover:bg-muted"
                    onclick={(e: MouseEvent) => handleCloseTab(e, id)}
                    onkeydown={(e: KeyboardEvent) => e.key === 'Enter' && handleCloseTab(e as unknown as MouseEvent, id)}
                  >
                    <X class="size-3" />
                  </span>

                  <!-- Active indicator -->
                  <div class="absolute bottom-0 left-0 right-0 h-0.5 bg-primary opacity-0 data-[state=active]:opacity-100 group-data-[state=active]:opacity-100"></div>
                </Tabs.Trigger>
              </ContextMenu.Trigger>

              <ContextMenu.Content class="w-48">
                <ContextMenu.Item onclick={() => ui.enableSplitView(id)}>
                  <Columns2 class="mr-2 h-4 w-4" />
                  Open in Split View
                </ContextMenu.Item>

                <ContextMenu.Item onclick={() => copyInstancePath(id)}>
                  <Copy class="mr-2 h-4 w-4" />
                  Copy Path
                </ContextMenu.Item>

                <ContextMenu.Separator />

                <ContextMenu.Item onclick={() => closeTab(id)}>
                  <X class="mr-2 h-4 w-4" />
                  Close Tab
                </ContextMenu.Item>

                <ContextMenu.Item onclick={() => closeOtherTabs(id)}>
                  <XCircle class="mr-2 h-4 w-4" />
                  Close Other Tabs
                </ContextMenu.Item>

                <ContextMenu.Item class="text-destructive focus:text-destructive" onclick={closeAllTabs}>
                  <XCircle class="mr-2 h-4 w-4" />
                  Close All Tabs
                </ContextMenu.Item>
              </ContextMenu.Content>
            </ContextMenu.Root>
          {/each}
        </Tabs.List>
      </div>

      <!-- Tab Content - ALL tabs stay mounted for live updates -->
      <!-- Split view or regular tabs -->
      {#if ui.splitView.enabled && ui.splitView.secondInstanceId && activeId}
        <WorkspaceSplit
          primaryInstanceId={activeId}
          secondaryInstanceId={ui.splitView.secondInstanceId}
        />
      {:else}
        <!-- Using forceMount to keep inactive tabs in DOM, CSS hidden for switching -->
        <div class="flex-1 overflow-hidden relative">
          {#each tabIds as id (id)}
            <div
              class="absolute inset-0 flex flex-col"
              class:hidden={id !== activeId}
            >
              <WorkspaceInstance instanceId={id} />
            </div>
          {/each}
        </div>
      {/if}
    </Tabs.Root>
  </div>
{/if}
