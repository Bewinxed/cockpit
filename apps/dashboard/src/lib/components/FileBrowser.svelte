<script lang="ts">
  import type { FilesystemEntry, FilesystemListResult } from '@cockpit/core/protocol';
  import { api } from '$lib/api';
  import { extractErrorMessage } from '$lib/utils/error';
  import {
    ChevronUp,
    Home,
    RefreshCw,
    Folder,
    File,
    ChevronRight,
    Loader2,
    Link as LinkIcon,
    ArrowRight
  } from 'lucide-svelte';

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

<div class="flex flex-col h-full min-h-0 bg-bg">
  <!-- Navigation Bar -->
  <div class="flex items-center gap-2 p-3 border-b border-border bg-bg-subtle/50">
    <button
      type="button"
      onclick={navigateUp}
      disabled={!parentPath || loading}
      class="p-2 rounded-md hover:bg-surface-hover disabled:opacity-40 disabled:cursor-not-allowed transition-all"
      title="Go up"
    >
      <ChevronUp class="w-4 h-4 text-text-secondary" />
    </button>

    <button
      type="button"
      onclick={navigateHome}
      disabled={loading}
      class="p-2 rounded-md hover:bg-surface-hover disabled:opacity-40 disabled:cursor-not-allowed transition-all"
      title="Go to home directory"
    >
      <Home class="w-4 h-4 text-text-secondary" />
    </button>

    <button
      type="button"
      onclick={() => loadDirectory(currentPath)}
      disabled={loading}
      class="p-2 rounded-md hover:bg-surface-hover disabled:opacity-40 disabled:cursor-not-allowed transition-all"
      title="Refresh"
    >
      <RefreshCw class="w-4 h-4 text-text-secondary {loading ? 'animate-spin' : ''}" />
    </button>

    <form onsubmit={handleManualNavigate} class="flex-1 flex gap-2">
      <input
        type="text"
        bind:value={manualPath}
        placeholder="Enter path..."
        class="flex-1 px-3 py-1.5 rounded-md bg-bg border border-border text-sm text-text
               placeholder:text-text-muted focus:outline-none focus:border-text-muted focus:ring-1 focus:ring-primary/10
               font-mono transition-all"
      />
      <button
        type="submit"
        disabled={loading}
        class="px-3 py-1.5 rounded-md bg-primary text-white text-sm font-medium hover:bg-primary-hover transition-all"
      >
        Go
      </button>
    </form>
  </div>

  <!-- Current Path Display -->
  <div class="px-4 py-2 border-b border-border bg-bg-subtle/30">
    <div class="flex items-center gap-2 text-xs">
      <span class="text-text-muted uppercase tracking-wider font-bold">Path</span>
      <span class="font-mono text-text-secondary truncate">{currentPath}</span>
    </div>
  </div>

  <!-- Error Display -->
  {#if error}
    <div class="p-3 bg-error-light border-b border-error/20 text-error text-sm animate-fade-in">
      {error}
    </div>
  {/if}

  <!-- File List -->
  <div class="flex-1 overflow-y-auto min-h-0">
    {#if loading && entries.length === 0}
      <div class="flex flex-col items-center justify-center h-48 text-text-muted gap-3">
        <Loader2 class="w-6 h-6 animate-spin" />
        <span class="text-sm">Fetching files...</span>
      </div>
    {:else if entries.length === 0}
      <div class="flex flex-col items-center justify-center h-48 text-text-muted italic text-sm">
        Empty directory
      </div>
    {:else}
      <div class="divide-y divide-border/50">
        {#each entries as entry (entry.path)}
          <button
            type="button"
            onclick={() => navigateTo(entry)}
            disabled={!entry.isDirectory}
            class="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-surface-hover transition-colors text-left group
                   {entry.isDirectory ? 'cursor-pointer' : 'cursor-default opacity-60'}"
          >
            <!-- Icon -->
            <div class="flex-shrink-0">
              {#if entry.isDirectory}
                <Folder class="w-4 h-4 text-warning" fill="currentColor" fill-opacity="0.2" />
              {:else}
                <File class="w-4 h-4 text-text-muted" />
              {/if}
            </div>

            <!-- Name -->
            <div class="flex-1 min-w-0">
              <span class="font-mono text-sm text-text truncate block">
                {entry.name}
                {#if entry.isSymlink}
                  <LinkIcon class="inline w-3 h-3 text-text-muted ml-1" />
                {/if}
              </span>
            </div>

            <!-- Size (for files) -->
            {#if !entry.isDirectory && entry.size !== undefined}
              <span class="text-xs text-text-muted tabular-nums font-mono">
                {formatSize(entry.size)}
              </span>
            {/if}

            <!-- Navigate arrow for directories -->
            {#if entry.isDirectory}
              <ChevronRight class="w-3.5 h-3.5 text-text-muted opacity-0 group-hover:opacity-100 transition-opacity" />
            {/if}
          </button>
        {/each}
      </div>
    {/if}
  </div>

  <!-- Select Button -->
  {#if onSelect}
    <div class="p-4 border-t border-border bg-bg-subtle/50">
      <button
        type="button"
        onclick={selectCurrentPath}
        disabled={loading || !currentPath}
        class="btn btn-primary w-full shadow-sm"
      >
        <span class="flex-1">Select directory</span>
        <ArrowRight class="w-4 h-4 ml-2" />
      </button>
    </div>
  {/if}
</div>
