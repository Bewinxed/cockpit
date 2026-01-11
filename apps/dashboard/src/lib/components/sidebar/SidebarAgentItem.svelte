<script lang="ts">
  import { Monitor, Server } from 'lucide-svelte';
  import type { Agent } from '$lib/stores/realtime.svelte';

  interface Props {
    agent: Agent;
    collapsed?: boolean;
  }

  let { agent, collapsed = false }: Props = $props();

  const statusColor = $derived(() => {
    switch (agent.status) {
      case 'online': return 'bg-success';
      case 'reconnecting': return 'bg-warning animate-pulse';
      default: return 'bg-muted-foreground/30';
    }
  });

  const OsIcon = $derived(() => {
    switch (agent.os) {
      case 'darwin': return Monitor; // macOS
      case 'windows': return Monitor;
      default: return Server; // Linux and others
    }
  });
</script>

<div
  class="flex items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground rounded-md"
  title={collapsed ? agent.name : undefined}
>
  <!-- OS Icon -->
  <div class="flex-shrink-0">
    <svelte:component this={OsIcon()} class="w-4 h-4" />
  </div>

  {#if !collapsed}
    <!-- Agent Name -->
    <span class="flex-1 truncate">
      {agent.name}
    </span>

    <!-- Status Dot -->
    <div class="w-2 h-2 rounded-full {statusColor()}"></div>
  {:else}
    <!-- Just status dot when collapsed -->
    <div class="w-2 h-2 rounded-full {statusColor()}"></div>
  {/if}
</div>
