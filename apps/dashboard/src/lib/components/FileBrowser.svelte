<script lang="ts">
  import type { FilesystemEntry, FilesystemListResult } from '@cockpit/core/protocol';
  import { api } from '$lib/api';
  import { extractErrorMessage } from '$lib/utils/error';

  interface Props {
    agentId: string;
    initialPath?: string;
    onSelect?: (path: string) => void;
  }

  let { agentId, initialPath, onSelect }: Props = $props();

  let currentPath = $state('');
  let parentPath = $state<string | null>(null);
  let homePath = $state('');
  let entries = $state<FilesystemEntry[]>([]);
  let loading = $state(false);
  let error = $state('');
  let manualPath = $state('');

  // Load initial directory
  $effect(() => {
    if (agentId) {
      loadDirectory(initialPath);
    }
  });

  async function loadDirectory(path?: string) {
    loading = true;
    error = '';

    try {
      const { data, error: apiError } = await api.api.agents({ id: agentId }).filesystem.get({
        query: path ? { path } : {}
      });

      if (apiError) {
        error = extractErrorMessage(apiError);
        return;
      }

      if (!data?.success) {
        error = (data as any)?.error || 'Failed to load directory';
        return;
      }

      const result = data.data as FilesystemListResult;
      currentPath = result.path;
      parentPath = result.parent;
      homePath = result.home;
      entries = result.entries;
      manualPath = result.path;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to load directory';
    } finally {
      loading = false;
    }
  }

  function navigateTo(entry: FilesystemEntry) {
    if (entry.isDirectory) {
      loadDirectory(entry.path);
    }
  }

  function navigateUp() {
    if (parentPath) {
      loadDirectory(parentPath);
    }
  }

  function navigateHome() {
    loadDirectory(homePath);
  }

  function handleManualNavigate(e: SubmitEvent) {
    e.preventDefault();
    if (manualPath) {
      loadDirectory(manualPath);
    }
  }

  function selectCurrentPath() {
    onSelect?.(currentPath);
  }

  function formatSize(bytes?: number): string {
    if (bytes === undefined) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }
</script>

<div class="flex flex-col h-full min-h-0">
  <!-- Navigation Bar -->
  <div class="flex items-center gap-2 p-3 border-b border-ui-1 bg-bg-2">
    <button
      type="button"
      onclick={navigateUp}
      disabled={!parentPath || loading}
      class="p-1.5 rounded-lg hover:bg-bg-3 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      title="Go up"
    >
      <svg class="w-4 h-4 text-tx-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 10l7-7m0 0l7 7m-7-7v18" />
      </svg>
    </button>

    <button
      type="button"
      onclick={navigateHome}
      disabled={loading}
      class="p-1.5 rounded-lg hover:bg-bg-3 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      title="Go to home directory"
    >
      <svg class="w-4 h-4 text-tx-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    </button>

    <button
      type="button"
      onclick={() => loadDirectory(currentPath)}
      disabled={loading}
      class="p-1.5 rounded-lg hover:bg-bg-3 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      title="Refresh"
    >
      <svg class="w-4 h-4 text-tx-2 {loading ? 'animate-spin' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
      </svg>
    </button>

    <form onsubmit={handleManualNavigate} class="flex-1 flex gap-2">
      <input
        type="text"
        bind:value={manualPath}
        placeholder="Enter path..."
        class="flex-1 px-3 py-1.5 rounded-lg bg-bg-1 border border-ui-1 text-sm text-tx-1
               placeholder:text-tx-3 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20
               font-mono"
      />
      <button
        type="submit"
        disabled={loading}
        class="px-3 py-1.5 rounded-lg bg-bg-3 text-sm text-tx-2 hover:bg-ui-1 transition-colors"
      >
        Go
      </button>
    </form>
  </div>

  <!-- Current Path Display -->
  <div class="px-3 py-2 border-b border-ui-1 bg-bg-1">
    <div class="flex items-center gap-2 text-sm">
      <span class="text-tx-3">Current:</span>
      <span class="font-mono text-tx-1 truncate">{currentPath}</span>
    </div>
  </div>

  <!-- Error Display -->
  {#if error}
    <div class="p-3 bg-red-500/10 border-b border-red-500/20 text-red-600 text-sm">
      {error}
    </div>
  {/if}

  <!-- File List -->
  <div class="flex-1 overflow-y-auto min-h-0">
    {#if loading && entries.length === 0}
      <div class="flex items-center justify-center h-32 text-tx-3">
        <svg class="w-5 h-5 animate-spin mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
        Loading...
      </div>
    {:else if entries.length === 0}
      <div class="flex items-center justify-center h-32 text-tx-3 text-sm">
        Empty directory
      </div>
    {:else}
      <div class="divide-y divide-ui-1">
        {#each entries as entry}
          <button
            type="button"
            onclick={() => navigateTo(entry)}
            disabled={!entry.isDirectory}
            class="w-full flex items-center gap-3 px-3 py-2 hover:bg-bg-2 transition-colors text-left
                   {entry.isDirectory ? 'cursor-pointer' : 'cursor-default opacity-60'}"
          >
            <!-- Icon -->
            <div class="flex-shrink-0">
              {#if entry.isDirectory}
                <svg class="w-5 h-5 text-flexoki-yellow" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                </svg>
              {:else}
                <svg class="w-5 h-5 text-tx-3" fill="currentColor" viewBox="0 0 20 20">
                  <path fill-rule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clip-rule="evenodd" />
                </svg>
              {/if}
            </div>

            <!-- Name -->
            <div class="flex-1 min-w-0">
              <span class="font-mono text-sm text-tx-1 truncate block">
                {entry.name}
                {#if entry.isSymlink}
                  <span class="text-tx-3 ml-1">(link)</span>
                {/if}
              </span>
            </div>

            <!-- Size (for files) -->
            {#if !entry.isDirectory && entry.size !== undefined}
              <span class="text-xs text-tx-3 flex-shrink-0">
                {formatSize(entry.size)}
              </span>
            {/if}

            <!-- Navigate arrow for directories -->
            {#if entry.isDirectory}
              <svg class="w-4 h-4 text-tx-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
              </svg>
            {/if}
          </button>
        {/each}
      </div>
    {/if}
  </div>

  <!-- Select Button -->
  {#if onSelect}
    <div class="p-3 border-t border-ui-1 bg-bg-2">
      <button
        type="button"
        onclick={selectCurrentPath}
        disabled={loading || !currentPath}
        class="w-full px-4 py-2.5 rounded-xl bg-primary text-white font-medium
               hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Select This Directory
      </button>
    </div>
  {/if}
</div>
