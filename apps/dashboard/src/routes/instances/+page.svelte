<script lang="ts">
  import InstanceCard from '$lib/components/InstanceCard.svelte';
  import NewInstanceModal from '$lib/components/NewInstanceModal.svelte';
  import { Button, Input, EmptyState } from '$lib/components/ui';
  import { instances, adhocInstances, projectInstances } from '$lib/stores/realtime.svelte';
  import { Plus, Search, Terminal, Folder, Zap } from 'lucide-svelte';

  let statusFilter = $state<'all' | 'running' | 'stopped' | 'error'>('all');
  let typeFilter = $state<'all' | 'adhoc' | 'project'>('all');
  let searchQuery = $state('');
  let showNewInstanceModal = $state(false);

  // Get instances as array from Map store
  let instancesList = $derived(Array.from($instances.values()));

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

<div class="page-container animate-fade-in">
  <!-- Header -->
  <header class="page-header">
    <div>
      <h1 class="page-title">Instances</h1>
      <p class="page-description">
        {runningCount} running, {stoppedCount} stopped
      </p>
    </div>
    <Button variant="default" onclick={() => showNewInstanceModal = true}>
      <Plus class="size-4" />
      New Instance
    </Button>
  </header>

  <NewInstanceModal bind:open={showNewInstanceModal} onClose={() => showNewInstanceModal = false} />

  <!-- Filters -->
  <div class="flex flex-col gap-4 mb-6">
    <div class="flex flex-col sm:flex-row gap-4">
      <div class="flex-1 max-w-md">
        <Input
          type="text"
          placeholder="Search instances..."
          bind:value={searchQuery}
          icon={Search}
        />
      </div>

      <div class="flex gap-2">
        {#each filterButtons as filter}
          <button
            class="px-4 py-2 rounded-lg text-sm font-medium transition-all duration-150 flex items-center gap-2
                   {statusFilter === filter.value
                     ? 'bg-primary text-white'
                     : 'bg-surface border border-border text-text-secondary hover:bg-surface-hover hover:text-text'}"
            onclick={() => statusFilter = filter.value}
          >
            {#if filter.value === 'running'}
              <span class="status-dot status-dot-pulse bg-success"></span>
            {:else if filter.value === 'stopped'}
              <span class="status-dot bg-text-muted"></span>
            {/if}
            {filter.label}
            <span class="text-xs opacity-60">({filter.count})</span>
          </button>
        {/each}
      </div>
    </div>

    <!-- Type Filter -->
    <div class="flex gap-2">
      {#each typeButtons as type}
        {@const Icon = type.icon}
        <button
          class="px-4 py-2 rounded-lg text-sm font-medium transition-all duration-150 flex items-center gap-2
                 {typeFilter === type.value
                   ? 'bg-secondary text-white'
                   : 'bg-surface border border-border text-text-secondary hover:bg-surface-hover hover:text-text'}"
          onclick={() => typeFilter = type.value}
        >
          <Icon class="w-4 h-4" />
          {type.label}
          <span class="text-xs opacity-60">({type.count})</span>
        </button>
      {/each}
    </div>
  </div>

  <!-- Instances List -->
  <div class="space-y-3">
    {#each filteredInstances as instance (instance.id)}
      <InstanceCard {instance} />
    {:else}
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
    {/each}
  </div>
</div>
