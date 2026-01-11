<script lang="ts">
  import { Monitor, Server } from 'lucide-svelte';
  import * as SidebarUI from '$lib/components/ui/sidebar';
  import type { Agent } from '$lib/stores/realtime.svelte';

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
</script>

<SidebarUI.SidebarMenuButton
  tooltipContent={collapsed ? agent.name : undefined}
  class="cursor-default"
>
  <!-- OS Icon -->
  <OsIcon class="size-4 flex-shrink-0" />

  <!-- Agent Name -->
  <span class="flex-1 truncate">
    {agent.name}
  </span>

  <!-- Status Dot -->
  <div class="size-2 rounded-full {statusColor}"></div>
</SidebarUI.SidebarMenuButton>
