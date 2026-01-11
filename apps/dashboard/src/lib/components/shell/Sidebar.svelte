<script lang="ts">
  import { Plus, ChevronDown, ChevronRight } from 'lucide-svelte';
  import SidebarInstanceItem from '../sidebar/SidebarInstanceItem.svelte';
  import SidebarAgentItem from '../sidebar/SidebarAgentItem.svelte';
  import {
    instancesByProject,
    agents,
    selectedInstanceId,
    toggleProjectCollapse,
    stats
  } from '$lib/stores/realtime.svelte';
  import { navigateToInstance } from '$lib/stores/url-sync.svelte';

  interface Props {
    collapsed?: boolean;
    onNewInstance?: () => void;
  }

  let { collapsed = false, onNewInstance }: Props = $props();
</script>

<aside
  class="h-full flex flex-col border-r border-border bg-card transition-all duration-200"
  class:w-64={!collapsed}
  class:w-12={collapsed}
>
  <!-- Scrollable Content -->
  <div class="flex-1 overflow-y-auto py-2">
    <!-- Instances Section -->
    <div class="px-2">
      {#if !collapsed}
        <div class="flex items-center justify-between px-2 py-1 mb-1">
          <span class="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Instances
          </span>
          <span class="text-xs text-muted-foreground">
            {$stats.runningInstances} running
          </span>
        </div>
      {/if}

      {#each $instancesByProject as group (group.project?.id ?? '__unassigned__')}
        <!-- Project Group Header -->
        <button
          class="w-full flex items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-accent/50 rounded-md transition-colors"
          onclick={() => toggleProjectCollapse(group.project?.id || null)}
        >
          {#if group.isCollapsed}
            <ChevronRight class="w-3.5 h-3.5 flex-shrink-0" />
          {:else}
            <ChevronDown class="w-3.5 h-3.5 flex-shrink-0" />
          {/if}
          {#if !collapsed}
            <span class="flex-1 text-left truncate">
              {group.project?.name || 'Unassigned'}
            </span>
            <span class="text-xs text-muted-foreground">
              {group.instances.length}
            </span>
          {/if}
        </button>

        <!-- Instance Items -->
        {#if !group.isCollapsed}
          <div class="ml-2 space-y-0.5">
            {#each group.instances as instance (instance.id)}
              <SidebarInstanceItem
                {instance}
                selected={$selectedInstanceId === instance.id}
                {collapsed}
                onSelect={() => navigateToInstance(instance.id, true)}
              />
            {/each}
          </div>
        {/if}
      {:else}
        {#if !collapsed}
          <div class="px-2 py-4 text-center text-sm text-muted-foreground">
            No instances yet
          </div>
        {/if}
      {/each}

      <!-- New Instance Button -->
      <button
        class="w-full flex items-center gap-2 px-2 py-1.5 mt-2 text-sm text-muted-foreground hover:text-foreground hover:bg-accent/50 rounded-md transition-colors"
        onclick={() => onNewInstance?.()}
      >
        <Plus class="w-4 h-4 flex-shrink-0" />
        {#if !collapsed}
          <span>New Instance</span>
        {/if}
      </button>
    </div>

    <!-- Agents Section -->
    <div class="px-2 mt-4 pt-4 border-t border-border">
      {#if !collapsed}
        <div class="flex items-center justify-between px-2 py-1 mb-1">
          <span class="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Agents
          </span>
          <span class="text-xs text-muted-foreground">
            {$stats.onlineAgents} online
          </span>
        </div>
      {/if}

      {#each Array.from($agents.values()) as agent (agent.machineId)}
        <SidebarAgentItem {agent} {collapsed} />
      {:else}
        {#if !collapsed}
          <div class="px-2 py-4 text-center text-sm text-muted-foreground">
            No agents connected
          </div>
        {/if}
      {/each}
    </div>
  </div>
</aside>
