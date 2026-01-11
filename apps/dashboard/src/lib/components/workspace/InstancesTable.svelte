<script lang="ts">
  import { ChevronUp, ChevronDown, Square, Trash2, Loader2 } from 'lucide-svelte';
  import { Button } from '$lib/components/ui/button';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import { populatedInstances, agents, type Instance } from '$lib/stores/realtime.svelte';
  import { openInstance } from '$lib/stores/url-sync.svelte';
  import { api } from '$lib/api';

  type SortKey = 'status' | 'name' | 'project' | 'agent' | 'model' | 'cost' | 'lastActivity';
  type SortDirection = 'asc' | 'desc';

  let sortKey = $state<SortKey>('lastActivity');
  let sortDirection = $state<SortDirection>('desc');
  let selectedIds = $state<Set<string>>(new Set());
  let stoppingIds = $state<Set<string>>(new Set());
  let deletingIds = $state<Set<string>>(new Set());

  // Sort instances
  const sortedInstances = $derived.by(() => {
    const items = [...$populatedInstances];

    items.sort((a, b) => {
      let comparison = 0;

      switch (sortKey) {
        case 'status':
          comparison = getStatusOrder(a.status) - getStatusOrder(b.status);
          break;
        case 'name':
          comparison = getDisplayName(a).localeCompare(getDisplayName(b));
          break;
        case 'project':
          comparison = (a.project || 'zzz').localeCompare(b.project || 'zzz');
          break;
        case 'agent':
          comparison = a.agent.localeCompare(b.agent);
          break;
        case 'model':
          comparison = (a.model || '').localeCompare(b.model || '');
          break;
        case 'cost':
          comparison = (a.totalCostUsd || 0) - (b.totalCostUsd || 0);
          break;
        case 'lastActivity':
          comparison = new Date(a.lastActivity).getTime() - new Date(b.lastActivity).getTime();
          break;
      }

      return sortDirection === 'asc' ? comparison : -comparison;
    });

    return items;
  });

  // Check if all are selected
  const allSelected = $derived(
    sortedInstances.length > 0 && selectedIds.size === sortedInstances.length
  );
  const someSelected = $derived(selectedIds.size > 0 && !allSelected);

  // Get selected instances that can be stopped
  const stoppableSelected = $derived(
    sortedInstances.filter(i =>
      selectedIds.has(i.id) &&
      (i.status === 'running' || i.status === 'starting')
    )
  );

  function getStatusOrder(status: Instance['status']): number {
    const order: Record<Instance['status'], number> = {
      running: 0,
      starting: 1,
      stopping: 2,
      sleeping: 3,
      error: 4,
      stopped: 5,
      disconnected: 6,
    };
    return order[status] ?? 99;
  }

  function getDisplayName(instance: Instance): string {
    if (instance.name && instance.name !== 'Instance') {
      return instance.name;
    }
    const parts = instance.cwd.split('/');
    return parts[parts.length - 1] || instance.id.slice(0, 8);
  }

  function getStatusColor(status: Instance['status']): string {
    switch (status) {
      case 'running': return 'bg-success';
      case 'starting': return 'bg-warning animate-pulse';
      case 'stopping': return 'bg-warning';
      case 'error': return 'bg-destructive';
      case 'sleeping': return 'bg-info';
      default: return 'bg-muted-foreground/40';
    }
  }

  function formatLastActivity(dateStr: string): string {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  }

  function formatCost(cost: number | undefined): string {
    if (!cost) return '-';
    return `$${cost.toFixed(3)}`;
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      sortKey = key;
      sortDirection = key === 'lastActivity' || key === 'cost' ? 'desc' : 'asc';
    }
  }

  function toggleSelectAll() {
    if (allSelected) {
      selectedIds = new Set();
    } else {
      selectedIds = new Set(sortedInstances.map(i => i.id));
    }
  }

  function toggleSelect(id: string) {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    selectedIds = newSet;
  }

  function handleRowClick(id: string, event: MouseEvent) {
    // Don't navigate if clicking checkbox or action buttons
    const target = event.target as HTMLElement;
    if (target.closest('[data-checkbox]') || target.closest('[data-action]')) {
      return;
    }
    openInstance(id, event.metaKey || event.ctrlKey);
  }

  async function stopSelected() {
    const toStop = stoppableSelected;
    const stopping = new Set(stoppingIds);

    for (const instance of toStop) {
      stopping.add(instance.id);
    }
    stoppingIds = stopping;

    try {
      await Promise.all(
        toStop.map(instance =>
          api.api.instances({ id: instance.id }).delete()
        )
      );
    } catch (error) {
      console.error('Failed to stop instances:', error);
    } finally {
      const stopped = new Set(stoppingIds);
      for (const instance of toStop) {
        stopped.delete(instance.id);
      }
      stoppingIds = stopped;
    }
  }

  async function deleteSelected() {
    // For now, delete is the same as stop
    // In the future, this could remove from the database
    const toDelete = [...selectedIds];
    const deleting = new Set(deletingIds);

    for (const id of toDelete) {
      deleting.add(id);
    }
    deletingIds = deleting;

    try {
      await Promise.all(
        toDelete.map(id =>
          api.api.instances({ id }).delete()
        )
      );
      selectedIds = new Set();
    } catch (error) {
      console.error('Failed to delete instances:', error);
    } finally {
      const deleted = new Set(deletingIds);
      for (const id of toDelete) {
        deleted.delete(id);
      }
      deletingIds = deleted;
    }
  }
</script>

<div class="flex flex-col h-full bg-background">
  <!-- Bulk Actions Bar -->
  {#if selectedIds.size > 0}
    <div class="flex items-center gap-3 px-4 py-2 bg-muted/50 border-b border-border">
      <span class="text-sm text-muted-foreground">
        {selectedIds.size} selected
      </span>

      {#if stoppableSelected.length > 0}
        <Button
          variant="outline"
          size="sm"
          onclick={stopSelected}
          disabled={stoppingIds.size > 0}
        >
          {#if stoppingIds.size > 0}
            <Loader2 class="size-4 animate-spin" />
          {:else}
            <Square class="size-4" />
          {/if}
          Stop Selected ({stoppableSelected.length})
        </Button>
      {/if}

      <Button
        variant="outline"
        size="sm"
        class="text-destructive hover:text-destructive"
        onclick={deleteSelected}
        disabled={deletingIds.size > 0}
      >
        {#if deletingIds.size > 0}
          <Loader2 class="size-4 animate-spin" />
        {:else}
          <Trash2 class="size-4" />
        {/if}
        Delete Selected
      </Button>
    </div>
  {/if}

  <!-- Table -->
  <div class="flex-1 overflow-auto">
    <table class="w-full text-sm">
      <thead class="sticky top-0 bg-card border-b border-border z-10">
        <tr class="text-left text-muted-foreground">
          <!-- Checkbox -->
          <th class="w-10 px-4 py-3">
            <div data-checkbox>
              <Checkbox
                checked={allSelected}
                indeterminate={someSelected}
                onCheckedChange={toggleSelectAll}
              />
            </div>
          </th>

          <!-- Status -->
          <th class="w-16 px-2 py-3">
            <button
              class="flex items-center gap-1 hover:text-foreground transition-colors"
              onclick={() => toggleSort('status')}
            >
              Status
              {#if sortKey === 'status'}
                {#if sortDirection === 'asc'}
                  <ChevronUp class="size-3" />
                {:else}
                  <ChevronDown class="size-3" />
                {/if}
              {/if}
            </button>
          </th>

          <!-- Name -->
          <th class="px-2 py-3 min-w-48">
            <button
              class="flex items-center gap-1 hover:text-foreground transition-colors"
              onclick={() => toggleSort('name')}
            >
              Name
              {#if sortKey === 'name'}
                {#if sortDirection === 'asc'}
                  <ChevronUp class="size-3" />
                {:else}
                  <ChevronDown class="size-3" />
                {/if}
              {/if}
            </button>
          </th>

          <!-- Project -->
          <th class="px-2 py-3 min-w-32">
            <button
              class="flex items-center gap-1 hover:text-foreground transition-colors"
              onclick={() => toggleSort('project')}
            >
              Project
              {#if sortKey === 'project'}
                {#if sortDirection === 'asc'}
                  <ChevronUp class="size-3" />
                {:else}
                  <ChevronDown class="size-3" />
                {/if}
              {/if}
            </button>
          </th>

          <!-- Agent -->
          <th class="px-2 py-3 min-w-32">
            <button
              class="flex items-center gap-1 hover:text-foreground transition-colors"
              onclick={() => toggleSort('agent')}
            >
              Agent
              {#if sortKey === 'agent'}
                {#if sortDirection === 'asc'}
                  <ChevronUp class="size-3" />
                {:else}
                  <ChevronDown class="size-3" />
                {/if}
              {/if}
            </button>
          </th>

          <!-- Model -->
          <th class="px-2 py-3 min-w-28">
            <button
              class="flex items-center gap-1 hover:text-foreground transition-colors"
              onclick={() => toggleSort('model')}
            >
              Model
              {#if sortKey === 'model'}
                {#if sortDirection === 'asc'}
                  <ChevronUp class="size-3" />
                {:else}
                  <ChevronDown class="size-3" />
                {/if}
              {/if}
            </button>
          </th>

          <!-- Cost -->
          <th class="px-2 py-3 w-24 text-right">
            <button
              class="flex items-center gap-1 hover:text-foreground transition-colors ml-auto"
              onclick={() => toggleSort('cost')}
            >
              Cost
              {#if sortKey === 'cost'}
                {#if sortDirection === 'asc'}
                  <ChevronUp class="size-3" />
                {:else}
                  <ChevronDown class="size-3" />
                {/if}
              {/if}
            </button>
          </th>

          <!-- Last Activity -->
          <th class="px-4 py-3 w-32 text-right">
            <button
              class="flex items-center gap-1 hover:text-foreground transition-colors ml-auto"
              onclick={() => toggleSort('lastActivity')}
            >
              Activity
              {#if sortKey === 'lastActivity'}
                {#if sortDirection === 'asc'}
                  <ChevronUp class="size-3" />
                {:else}
                  <ChevronDown class="size-3" />
                {/if}
              {/if}
            </button>
          </th>
        </tr>
      </thead>

      <tbody class="divide-y divide-border/50">
        {#each sortedInstances as instance (instance.id)}
          {@const isSelected = selectedIds.has(instance.id)}
          {@const isLoading = stoppingIds.has(instance.id) || deletingIds.has(instance.id)}
          <tr
            class="group hover:bg-muted/50 cursor-pointer transition-colors {isSelected ? 'bg-muted/30' : ''} {isLoading ? 'opacity-50' : ''}"
            onclick={(e) => handleRowClick(instance.id, e)}
          >
            <!-- Checkbox -->
            <td class="px-4 py-3">
              <div data-checkbox>
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={() => toggleSelect(instance.id)}
                />
              </div>
            </td>

            <!-- Status -->
            <td class="px-2 py-3">
              <div class="flex items-center gap-2">
                <div class="size-2 rounded-full {getStatusColor(instance.status)}"></div>
                <span class="text-xs text-muted-foreground capitalize hidden sm:inline">
                  {instance.status}
                </span>
              </div>
            </td>

            <!-- Name -->
            <td class="px-2 py-3">
              <div class="flex flex-col">
                <span class="font-medium text-foreground truncate max-w-64">
                  {getDisplayName(instance)}
                </span>
                <span class="text-xs text-muted-foreground truncate max-w-64">
                  {instance.cwd}
                </span>
              </div>
            </td>

            <!-- Project -->
            <td class="px-2 py-3">
              <span class="text-muted-foreground">
                {instance.project || '-'}
              </span>
            </td>

            <!-- Agent -->
            <td class="px-2 py-3">
              <span class="text-muted-foreground">
                {instance.agent}
              </span>
            </td>

            <!-- Model -->
            <td class="px-2 py-3">
              <span class="text-xs font-mono text-muted-foreground">
                {instance.model || '-'}
              </span>
            </td>

            <!-- Cost -->
            <td class="px-2 py-3 text-right">
              <span class="font-mono text-muted-foreground">
                {formatCost(instance.totalCostUsd)}
              </span>
            </td>

            <!-- Last Activity -->
            <td class="px-4 py-3 text-right">
              <span class="text-muted-foreground">
                {formatLastActivity(instance.lastActivity)}
              </span>
            </td>
          </tr>
        {:else}
          <tr>
            <td colspan="8" class="px-4 py-12 text-center text-muted-foreground">
              No instances found
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  <!-- Footer with count -->
  <div class="flex-shrink-0 px-4 py-2 border-t border-border bg-card/50 text-xs text-muted-foreground">
    {sortedInstances.length} instance{sortedInstances.length !== 1 ? 's' : ''}
  </div>
</div>
