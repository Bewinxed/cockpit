<script lang="ts">
  import InstanceCard from '$lib/components/InstanceCard.svelte';
  import NewInstanceModal from '$lib/components/NewInstanceModal.svelte';
  import { Button, EmptyState } from '$lib/components/ui';
  import { populatedInstances } from '$lib/stores/realtime.svelte';
  import { getInstances } from '$lib/data.remote';
  import { Plus, Terminal, Search } from 'lucide-svelte';
  import { fly, fade } from 'svelte/transition';

  // Fetch instances during SSR
  const ssrInstances = await getInstances();

  let statusFilter = $state<'all' | 'running' | 'stopped'>('all');
  let searchQuery = $state('');
  let showNewInstanceModal = $state(false);

  // Merge SSR instances with realtime
  let instancesList = $derived.by(() => {
    const realtimeInstances = $populatedInstances;
    if (realtimeInstances.length > 0) return realtimeInstances;

    return ssrInstances.map((i) => ({
      id: i.id,
      name: i.lastPrompt?.slice(0, 40) || i.cwd?.split('/').pop() || 'Instance',
      status: i.status as 'running' | 'stopped' | 'starting' | 'stopping' | 'error' | 'disconnected' | 'sleeping',
      machineId: i.machineId,
      projectId: i.projectId,
      project: null,
      agent: null,
      cwd: i.cwd,
      lastActivity: i.createdAt || new Date().toISOString(),
      createdAt: i.createdAt,
    }));
  });

  let filteredInstances = $derived(
    instancesList
      .filter((i) => {
        const matchesSearch =
          !searchQuery ||
          (i.name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
          (i.cwd || '').toLowerCase().includes(searchQuery.toLowerCase());

        const matchesStatus =
          statusFilter === 'all' ||
          (statusFilter === 'running' && (i.status === 'running' || i.status === 'starting')) ||
          (statusFilter === 'stopped' && (i.status === 'stopped' || i.status === 'stopping'));

        return matchesSearch && matchesStatus;
      })
      .sort((a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime())
  );

  let runningCount = $derived(instancesList.filter((i) => i.status === 'running' || i.status === 'starting').length);
  let stoppedCount = $derived(instancesList.filter((i) => i.status === 'stopped' || i.status === 'stopping').length);
</script>

<svelte:head>
  <title>Instances | Cockpit</title>
</svelte:head>

<div class="min-h-screen p-6 md:p-10">
  <div class="max-w-4xl mx-auto space-y-8">

    <!-- Header -->
    <header class="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between" in:fly={{ y: -10, duration: 300 }}>
      <div>
        <h1 class="text-2xl font-semibold tracking-tight">Instances</h1>
        <p class="text-muted-foreground mt-1">
          {runningCount} running · {stoppedCount} stopped
        </p>
      </div>
      <Button onclick={() => showNewInstanceModal = true}>
        <Plus class="size-4" />
        New Instance
      </Button>
    </header>

    <NewInstanceModal bind:open={showNewInstanceModal} onClose={() => showNewInstanceModal = false} />

    <!-- Search & Filters -->
    <div class="flex flex-col gap-4 sm:flex-row sm:items-center" in:fly={{ y: -10, duration: 300, delay: 50 }}>
      <!-- Search -->
      <div class="relative flex-1 max-w-sm">
        <Search class="absolute left-4 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search instances..."
          bind:value={searchQuery}
          class="input pl-11"
        />
      </div>

      <!-- Status Tabs -->
      <div class="flex gap-1">
        <button
          onclick={() => statusFilter = 'all'}
          class="px-4 py-2 text-sm font-medium rounded-xl transition-colors
                 {statusFilter === 'all'
                   ? 'bg-primary text-primary-foreground'
                   : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'}"
        >
          All
        </button>
        <button
          onclick={() => statusFilter = 'running'}
          class="px-4 py-2 text-sm font-medium rounded-xl transition-colors flex items-center gap-2
                 {statusFilter === 'running'
                   ? 'bg-success/20 text-success'
                   : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'}"
        >
          <span class="size-2 rounded-full bg-current"></span>
          Running
        </button>
        <button
          onclick={() => statusFilter = 'stopped'}
          class="px-4 py-2 text-sm font-medium rounded-xl transition-colors
                 {statusFilter === 'stopped'
                   ? 'bg-secondary text-foreground'
                   : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'}"
        >
          Stopped
        </button>
      </div>
    </div>

    <!-- Instances List -->
    {#if filteredInstances.length > 0}
      <div class="space-y-3" in:fade={{ duration: 200 }}>
        {#each filteredInstances as instance, i (instance.id)}
          <div in:fly={{ y: 10, duration: 200, delay: Math.min(i * 30, 150) }}>
            <InstanceCard {instance} />
          </div>
        {/each}
      </div>
    {:else}
      <div class="py-20" in:fade={{ duration: 200 }}>
        <EmptyState
          icon={Terminal}
          title={searchQuery || statusFilter !== 'all' ? 'No matching instances' : 'No instances yet'}
          description={searchQuery || statusFilter !== 'all'
            ? 'Try adjusting your search or filter'
            : 'Create your first Claude Code instance to get started'}
          action={!searchQuery && statusFilter === 'all'
            ? { label: 'New Instance', onClick: () => showNewInstanceModal = true }
            : undefined}
        />
      </div>
    {/if}
  </div>
</div>
