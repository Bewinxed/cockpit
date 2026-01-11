<script lang="ts">
  import { Square, MoreHorizontal, Columns2, Loader2 } from 'lucide-svelte';
  import { Button } from '$lib/components/ui/button';
  import { Badge } from '$lib/components/ui/badge';
  import type { Instance } from '$lib/stores/realtime.svelte';
  import { getStreamingState, enableSplitView } from '$lib/stores/realtime.svelte';
  import { api } from '$lib/api';

  interface Props {
    instance: Instance;
  }

  let { instance }: Props = $props();

  const streamingState = $derived(getStreamingState(instance.id));
  let stopping = $state(false);

  // Map status to valid badge variant + custom class for colors
  const statusBadgeVariant = $derived.by(() => {
    switch (instance.status) {
      case 'running': return 'default'; // Will use custom class for green
      case 'starting': return 'secondary'; // Yellow
      case 'error': return 'destructive'; // Red
      case 'sleeping': return 'outline'; // Blue
      default: return 'secondary';
    }
  });

  const statusBadgeClass = $derived.by(() => {
    switch (instance.status) {
      case 'running': return 'bg-success text-success-foreground border-success';
      case 'starting': return 'bg-warning/20 text-warning-foreground border-warning';
      case 'sleeping': return 'bg-info/20 text-info-foreground border-info';
      default: return '';
    }
  });

  const displayName = $derived(() => {
    if (instance.name && instance.name !== 'Instance') {
      return instance.name;
    }
    const parts = instance.cwd.split('/');
    return parts[parts.length - 1] || 'Instance';
  });

  async function stopInstance() {
    stopping = true;
    try {
      await api.api.instances({ id: instance.id }).delete();
    } catch (error) {
      console.error('Failed to stop instance:', error);
    } finally {
      stopping = false;
    }
  }
</script>

<header class="h-14 flex items-center justify-between px-4 border-b border-border bg-card/50">
  <!-- Left: Instance Info -->
  <div class="flex items-center gap-3 min-w-0">
    <!-- Status indicator -->
    <div
      class="w-2.5 h-2.5 rounded-full flex-shrink-0"
      class:bg-success={instance.status === 'running'}
      class:bg-warning={instance.status === 'starting'}
      class:bg-error={instance.status === 'error'}
      class:bg-info={instance.status === 'sleeping'}
      class:bg-muted-foreground={instance.status === 'stopped'}
      class:animate-pulse={instance.status === 'starting' || $streamingState?.isStreaming}
    ></div>

    <!-- Name -->
    <h1 class="text-sm font-medium text-foreground truncate">
      {displayName()}
    </h1>

    <!-- Status Badge -->
    <Badge variant={statusBadgeVariant} class={statusBadgeClass}>
      {instance.status}
    </Badge>

    <!-- Project -->
    {#if instance.project}
      <span class="text-xs text-muted-foreground">
        in {instance.project}
      </span>
    {/if}
  </div>

  <!-- Right: Stats & Actions -->
  <div class="flex items-center gap-4">
    <!-- Token counts -->
    {#if $streamingState}
      <div class="flex items-center gap-3 text-xs font-mono text-muted-foreground">
        <span title="Session input tokens">
          {($streamingState.sessionInputTokens / 1000).toFixed(1)}K in
        </span>
        <span title="Session output tokens">
          {($streamingState.sessionOutputTokens / 1000).toFixed(1)}K out
        </span>
      </div>
    {/if}

    <!-- Cost -->
    {#if instance.totalCostUsd}
      <span class="text-xs font-mono text-muted-foreground">
        ${instance.totalCostUsd.toFixed(3)}
      </span>
    {/if}

    <!-- Model -->
    {#if instance.model}
      <Badge variant="secondary" class="text-xs">
        {instance.model}
      </Badge>
    {/if}

    <!-- Actions -->
    <div class="flex items-center gap-1">
      <!-- Split View -->
      <Button
        variant="ghost"
        size="icon-sm"
        title="Open in split view"
        onclick={() => enableSplitView(instance.id)}
      >
        <Columns2 class="w-4 h-4" />
      </Button>

      <!-- Stop -->
      {#if instance.status === 'running' || instance.status === 'starting'}
        <Button
          variant="ghost"
          size="icon-sm"
          title="Stop instance"
          onclick={stopInstance}
          disabled={stopping}
        >
          {#if stopping}
            <Loader2 class="w-4 h-4 animate-spin" />
          {:else}
            <Square class="w-4 h-4" />
          {/if}
        </Button>
      {/if}

      <!-- More options (future) -->
      <!-- <Button variant="ghost" size="icon-sm">
        <MoreHorizontal class="w-4 h-4" />
      </Button> -->
    </div>
  </div>
</header>
