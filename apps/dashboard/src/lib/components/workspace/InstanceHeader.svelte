<script lang="ts">
  import { Square, Columns2, LoaderCircle, MessageSquare, GitBranch, Folder, Brain, BrainCircuit, Zap } from 'lucide-svelte';
  import { Button } from '$lib/components/ui/button';
  import { Badge } from '$lib/components/ui/badge';
  import { instances, projects, ui, stopInstance as wsStopInstance, updateInstancePreferences, setInstanceThinking, type Instance } from '$lib/stores';

  interface Props {
    instance: Instance;
  }

  let { instance }: Props = $props();

  const viewMode = $derived(ui.getViewMode(instance.id));
  const streamingState = $derived(instances.getStreamingState(instance.id));
  const project = $derived(instance.projectId ? projects.get(instance.projectId) : null);

  const instanceName = $derived.by(() => {
    if (instance.cwd) {
      const parts = instance.cwd.split('/');
      return parts[parts.length - 1] || 'Instance';
    }
    return 'Instance';
  });

  let stopping = $state(false);

  // Thinking mode: cycle off -> think -> ultrathink
  const thinkingMode = $derived(instance.thinkingMode ?? 'ultrathink');
  const thinkingModes = ['off', 'think', 'ultrathink'] as const;
  const isLive = $derived(instance.status === 'running' || instance.status === 'starting');

  async function cycleThinkingMode() {
    const currentIndex = thinkingModes.indexOf(thinkingMode as typeof thinkingModes[number]);
    const nextMode = thinkingModes[(currentIndex + 1) % thinkingModes.length];
    instances.setThinkingMode(instance.id, nextMode);
    if (isLive) {
      try {
        await setInstanceThinking({ instanceId: instance.id, mode: nextMode });
      } catch (error) {
        console.error('Failed to set thinking mode:', error);
        instances.setThinkingMode(instance.id, thinkingMode as typeof thinkingModes[number]);
      }
    }
  }

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

<header class="h-10 flex items-center justify-between px-4 border-b border-border bg-card/30">
  <!-- Left: Instance name + project -->
  <div class="flex items-center gap-2 min-w-0">
    <span class="text-sm font-medium text-foreground truncate">
      {instanceName}
    </span>
    {#if project}
      <Badge variant="outline" class="text-xs gap-1 shrink-0">
        <Folder class="size-3" />
        {project.name}
      </Badge>
    {/if}
  </div>

  <!-- Right: Stats & Actions -->
  <div class="flex items-center gap-2 shrink-0">
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

    <!-- Thinking Mode Toggle — right next to model, before action buttons -->
    <button
      onclick={cycleThinkingMode}
      title="{thinkingMode === 'off' ? 'Thinking off' : thinkingMode === 'think' ? 'Thinking' : 'Ultra thinking'} (Alt+T)"
      class="flex items-center justify-center gap-1 h-6 min-w-16 px-2 rounded-md border text-xs font-medium transition-colors cursor-pointer
        {thinkingMode === 'off' ? 'border-border text-muted-foreground hover:text-foreground hover:border-foreground/30' : ''}
        {thinkingMode === 'think' ? 'border-blue-500/30 text-blue-400 bg-blue-500/10 hover:bg-blue-500/20' : ''}
        {thinkingMode === 'ultrathink' ? 'border-violet-500/30 text-violet-400 bg-violet-500/10 hover:bg-violet-500/20' : ''}"
    >
      {#if thinkingMode === 'off'}
        <Brain class="size-3.5" />
        <span>off</span>
      {:else if thinkingMode === 'think'}
        <Brain class="size-3.5" />
        <span>think</span>
      {:else}
        <BrainCircuit class="size-3.5" />
        <span>ultra</span>
      {/if}
    </button>

    <!-- Actions -->
    <div class="flex items-center gap-1">
      <!-- View Mode Toggle -->
      <div class="flex items-center border border-border rounded-md p-0.5">
        <Button
          variant={viewMode === 'chat' ? 'secondary' : 'ghost'}
          size="icon-sm"
          title="Chat view"
          onclick={() => updateInstancePreferences({ instanceId: instance.id, viewMode: 'chat' })}
        >
          <MessageSquare class="w-4 h-4" />
        </Button>
        <Button
          variant={viewMode === 'flow' ? 'secondary' : 'ghost'}
          size="icon-sm"
          title="Flow view (Ctrl+G)"
          onclick={() => updateInstancePreferences({ instanceId: instance.id, viewMode: 'flow' })}
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
    </div>
  </div>
</header>
