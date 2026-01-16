<script lang="ts">
  import { Square, Columns2, LoaderCircle, MessageSquare, GitBranch } from 'lucide-svelte';
  import { Button } from '$lib/components/ui/button';
  import { Badge } from '$lib/components/ui/badge';
  import { instances, ui, stopInstance as wsStopInstance, type Instance } from '$lib/stores';

  interface Props {
    instance: Instance;
  }

  let { instance }: Props = $props();

  const viewMode = $derived(ui.getViewMode(instance.id));

  const streamingState = $derived(instances.getStreamingState(instance.id));
  let stopping = $state(false);

  async function stopInstance() {
    stopping = true;
    try {
      await wsStopInstance({ instanceId: instance.id });
    } catch (error) {
      console.error('Failed to stop instance:', error);
    } finally {
      stopping = false;
    }
  }
</script>

<header class="h-10 flex items-center justify-end px-4 border-b border-border bg-card/30">
  <!-- Stats & Actions -->
  <div class="flex items-center gap-4">
    <!-- Token counts -->
    {#if streamingState}
      <div class="flex items-center gap-3 text-xs font-mono text-muted-foreground">
        <span title="Session input tokens">
          {(streamingState.sessionInputTokens / 1000).toFixed(1)}K in
        </span>
        <span title="Session output tokens">
          {(streamingState.sessionOutputTokens / 1000).toFixed(1)}K out
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
      <!-- View Mode Toggle -->
      <div class="flex items-center border border-border rounded-md p-0.5">
        <Button
          variant={viewMode === 'chat' ? 'secondary' : 'ghost'}
          size="icon-sm"
          title="Chat view"
          onclick={() => ui.setViewMode(instance.id, 'chat')}
        >
          <MessageSquare class="w-4 h-4" />
        </Button>
        <Button
          variant={viewMode === 'flow' ? 'secondary' : 'ghost'}
          size="icon-sm"
          title="Flow view (Ctrl+G)"
          onclick={() => ui.setViewMode(instance.id, 'flow')}
        >
          <GitBranch class="w-4 h-4" />
        </Button>
      </div>

      <!-- Split View -->
      <Button
        variant="ghost"
        size="icon-sm"
        title="Open in split view"
        onclick={() => ui.enableSplitView(instance.id)}
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
            <LoaderCircle class="w-4 h-4 animate-spin" />
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
