<script lang="ts">
  import InstanceCard from '$lib/components/InstanceCard.svelte';
  import NewInstanceModal from '$lib/components/NewInstanceModal.svelte';
  import { Button, Input, EmptyState } from '$lib/components/ui';
  import { populatedInstances, adhocInstances, projectInstances } from '$lib/stores/realtime.svelte';
  import { Plus, Search, Terminal, Folder, Zap } from 'lucide-svelte';

  let statusFilter = $state<'all' | 'running' | 'stopped' | 'error'>('all');
  let typeFilter = $state<'all' | 'adhoc' | 'project'>('all');
  let searchQuery = $state('');
  let showNewInstanceModal = $state(false);

  // Get instances as array from Map store
  let instancesList = $derived($populatedInstances);

  let filteredInstances = $derived(
    instancesList
      .filter((i) => {
        const matchesSearch =
          (i.name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
          (i.agent || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
          (i.cwd || '').toLowerCase().includes(searchQuery.toLowerCase());

        const matchesStatus =
          statusFilter === 'all' ||
          (statusFilter === 'running' && (i.status === 'running' || i.status === 'starting')) ||
          (statusFilter === 'stopped' && (i.status === 'stopped' || i.status === 'stopping')) ||
          (statusFilter === 'error' && i.status === 'error');

        const matchesType =
          typeFilter === 'all' ||
          (typeFilter === 'adhoc' && !i.projectId) ||
          (typeFilter === 'project' && i.projectId);

        return matchesSearch && matchesStatus && matchesType;
      })
      .sort((a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime())
  );

  let runningCount = $derived(instancesList.filter((i) => i.status === 'running' || i.status === 'starting').length);
  let stoppedCount = $derived(instancesList.filter((i) => i.status === 'stopped').length);
  let adhocCount = $derived($adhocInstances.length);
  let projectCount = $derived($projectInstances.length);

  const filterButtons = $derived([
    { value: 'all' as const, label: 'All', count: instancesList.length },
    { value: 'running' as const, label: 'Running', count: runningCount },
    { value: 'stopped' as const, label: 'Stopped', count: stoppedCount },
  ]);

  const typeButtons = $derived([
    { value: 'all' as const, label: 'All', count: instancesList.length, icon: Terminal },
    { value: 'adhoc' as const, label: 'Ad-hoc', count: adhocCount, icon: Zap },
    { value: 'project' as const, label: 'Project', count: projectCount, icon: Folder },
  ]);
</script>

<svelte:head>
  <title>Instances | Cockpit</title>
</svelte:head>

<div class="p-8 max-w-[1400px] mx-auto animate-fade-in">
  <!-- Header -->
  <header class="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-10">
    <div>
      <span class="text-[10px] font-mono text-text-muted uppercase tracking-[0.2em] mb-2 block">Management</span>
      <h1 class="text-4xl font-serif font-bold text-text tracking-tight">Instances</h1>
      <div class="flex items-center gap-4 mt-2">
        <div class="flex items-center gap-2">
          <span class="w-2 h-2 rounded-full bg-success animate-pulse"></span>
          <span class="text-sm text-text-secondary">{runningCount} running</span>
        </div>
        <span class="text-border">|</span>
        <div class="flex items-center gap-2">
          <span class="w-2 h-2 rounded-full bg-text-muted"></span>
          <span class="text-sm text-text-secondary">{stoppedCount} stopped</span>
        </div>
      </div>
    </div>
    <Button variant="primary" onclick={() => showNewInstanceModal = true}>
      <Plus class="size-4" />
      New Instance
    </Button>
  </header>

  <NewInstanceModal bind:open={showNewInstanceModal} onClose={() => showNewInstanceModal = false} />

  <!-- Filters Section -->
  <div class="bg-surface border border-border mb-6">
    <div class="p-4 border-b border-border">
      <span class="text-[10px] font-mono text-text-muted uppercase tracking-[0.15em]">Filters</span>
    </div>

    <div class="p-4 space-y-4">
      <!-- Search -->
      <div class="max-w-md">
        <Input
          type="text"
          placeholder="Search instances..."
          bind:value={searchQuery}
        />
      </div>

      <!-- Status Filter -->
      <div class="flex flex-wrap gap-2">
        <span class="text-[10px] font-mono text-text-muted uppercase tracking-wider self-center mr-2">Status:</span>
        {#each filterButtons as filter}
          <button
            class="px-4 py-2 text-xs font-mono uppercase tracking-wider transition-all duration-150 flex items-center gap-2
                   {statusFilter === filter.value
                     ? 'bg-primary text-text-inverse'
                     : 'bg-bg-subtle border border-border text-text-secondary hover:border-primary/50 hover:text-text'}"
            onclick={() => statusFilter = filter.value}
          >
            {#if filter.value === 'running'}
              <span class="w-1.5 h-1.5 rounded-full bg-success {statusFilter === filter.value ? '' : 'animate-pulse'}"></span>
            {:else if filter.value === 'stopped'}
              <span class="w-1.5 h-1.5 rounded-full {statusFilter === filter.value ? 'bg-text-inverse/60' : 'bg-text-muted'}"></span>
            {/if}
            {filter.label}
            <span class="opacity-60">({filter.count})</span>
          </button>
        {/each}
      </div>

      <!-- Type Filter -->
      <div class="flex flex-wrap gap-2">
        <span class="text-[10px] font-mono text-text-muted uppercase tracking-wider self-center mr-2">Type:</span>
        {#each typeButtons as type}
          {@const Icon = type.icon}
          <button
            class="px-4 py-2 text-xs font-mono uppercase tracking-wider transition-all duration-150 flex items-center gap-2
                   {typeFilter === type.value
                     ? 'bg-secondary text-text-inverse'
                     : 'bg-bg-subtle border border-border text-text-secondary hover:border-secondary/50 hover:text-text'}"
            onclick={() => typeFilter = type.value}
          >
            <Icon class="w-3.5 h-3.5" />
            {type.label}
            <span class="opacity-60">({type.count})</span>
          </button>
        {/each}
      </div>
    </div>
  </div>

  <!-- Instances List -->
  <div class="bg-surface border border-border">
    <div class="p-4 border-b border-border flex items-center justify-between">
      <div class="flex items-center gap-3">
        <div class="w-1.5 h-1.5 rounded-full bg-primary"></div>
        <span class="text-[10px] font-mono text-text-muted uppercase tracking-[0.15em]">
          {filteredInstances.length} {filteredInstances.length === 1 ? 'Instance' : 'Instances'}
        </span>
      </div>
    </div>

    <div class="divide-y divide-border">
      {#each filteredInstances as instance (instance.id)}
        <div class="p-4 hover:bg-surface-hover/50 transition-colors">
          <InstanceCard {instance} />
        </div>
      {:else}
        <div class="p-12">
          <EmptyState
            icon={Terminal}
            title={searchQuery || statusFilter !== 'all' ? 'No instances found' : 'No instances yet'}
            description={searchQuery || statusFilter !== 'all'
              ? 'Try adjusting your filters or search query'
              : 'Start a new Claude Code instance to begin working'}
            action={!searchQuery && statusFilter === 'all'
              ? { label: 'New Instance', onClick: () => showNewInstanceModal = true }
              : undefined}
          />
        </div>
      {/each}
    </div>
  </div>
</div>
