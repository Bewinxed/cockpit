<script lang="ts">
  import { Monitor, Server, X } from 'lucide-svelte';
  import * as SidebarUI from '$lib/components/ui/sidebar';
  import { ui, type Agent } from '$lib/stores';

  interface Props {
    agent: Agent;
    collapsed?: boolean;
  }

  let { agent, collapsed = false }: Props = $props();

  const statusColor = $derived.by(() => {
    switch (agent.status) {
      case 'online': return 'bg-success';
      case 'reconnecting': return 'bg-warning animate-pulse';
      default: return 'bg-muted-foreground/30';
    }
  });

  const OsIcon = $derived.by(() => {
    switch (agent.os) {
      case 'darwin': return Monitor; // macOS
      case 'windows': return Monitor;
      default: return Server; // Linux and others
    }
  });

  // Check if this agent is currently being filtered
  const isFiltered = $derived(
    ui.sidebarFilter.type === 'agent' && ui.sidebarFilter.agentId === agent.machineId
  );

  function handleClick() {
    if (isFiltered) {
      // Clear filter
      ui.toggleSidebarFilter('all');
    } else {
      // Filter to this agent
      ui.filterByAgent(agent.machineId);
    }
  }
</script>

<SidebarUI.SidebarMenuButton
  tooltipContent={collapsed ? agent.name : undefined}
  onclick={handleClick}
  class={isFiltered ? 'bg-primary/10 text-primary' : ''}
>
  <!-- OS Icon -->
  <OsIcon class="size-4 shrink-0" />

  <!-- Agent Name -->
  <span class="flex-1 truncate">
    {agent.name}
  </span>

  <!-- Clear filter indicator or Status Dot -->
  {#if isFiltered}
    <X class="size-3 text-primary" />
  {:else}
    <div class="size-2 rounded-full {statusColor}"></div>
  {/if}
</SidebarUI.SidebarMenuButton>
