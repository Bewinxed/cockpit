<script lang="ts">
  import { Zap } from 'lucide-svelte';
  import type { SubagentState } from '$lib/stores/realtime.svelte';
  import { getInstanceSubagents } from '$lib/stores/realtime.svelte';
  import SubagentBranch from './SubagentBranch.svelte';

  interface Props {
    instanceId: string;
  }

  let { instanceId }: Props = $props();

  // Get all subagents for this instance
  const allSubagents = $derived(getInstanceSubagents(instanceId));

  // Filter to only top-level subagents (no parent)
  const topLevelSubagents = $derived(
    $allSubagents.filter(s => !s.parentSubagentId)
  );

  // Group by status for parallel execution display
  const activeSubagents = $derived(
    topLevelSubagents.filter(s => s.status === 'starting' || s.status === 'running')
  );
  const completedSubagents = $derived(
    topLevelSubagents.filter(s => s.status === 'complete' || s.status === 'error')
  );

  // Check if there are multiple active subagents (parallel execution)
  const hasParallelExecution = $derived(activeSubagents.length > 1);
</script>

{#if topLevelSubagents.length > 0}
  <div class="space-y-3">
    <!-- Parallel execution indicator -->
    {#if hasParallelExecution}
      <div class="flex items-center gap-2 px-3 py-1.5 bg-info/10 rounded-lg border border-info/30">
        <Zap class="size-4 text-info" />
        <span class="text-sm font-medium text-info">
          Parallel Execution
        </span>
        <span class="text-xs text-muted-foreground">
          {activeSubagents.length} agents running
        </span>
      </div>
    {/if}

    <!-- Active subagents (side by side if parallel) -->
    {#if activeSubagents.length > 0}
      <div
        class="gap-3"
        class:grid={hasParallelExecution}
        class:grid-cols-1={hasParallelExecution}
        class:lg:grid-cols-2={hasParallelExecution}
        class:space-y-3={!hasParallelExecution}
      >
        {#each activeSubagents as subagent (subagent.toolUseId)}
          <SubagentBranch {subagent} />
        {/each}
      </div>
    {/if}

    <!-- Completed subagents -->
    {#if completedSubagents.length > 0}
      <div class="space-y-2">
        {#each completedSubagents as subagent (subagent.toolUseId)}
          <SubagentBranch {subagent} />
        {/each}
      </div>
    {/if}
  </div>
{/if}
