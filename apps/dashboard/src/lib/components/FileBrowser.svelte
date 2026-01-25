<script lang="ts">
  import type { FilesystemEntry, FilesystemListResult } from '@agentdeck/core/protocol';
  import { api } from '$lib/api';
  import { extractErrorMessage } from '$lib/utils/error';
  import { Button } from '$lib/components/ui/button';
  import {
    ChevronUp,
    House,
    RefreshCw,
    Folder,
    File,
    ChevronRight,
    LoaderCircle,
    Link as LinkIcon,
    ArrowRight
  } from 'lucide-svelte';

  interface Props {
    machineId: string;
    initialPath?: string;
    onSelect?: (path: string) => void;
  }

  let { machineId, initialPath, onSelect }: Props = $props();

  let currentPath = $state('');
  let parentPath = $state<string | null>(null);
  let homePath = $state('');
  let entries = $state<FilesystemEntry[]>([]);
  let loading = $state(false);
  let error = $state('');
  let manualPath = $state('');

  // Load initial directory
  $effect(() => {
    if (machineId) {
      loadDirectory(initialPath);
    }
  });

  async function loadDirectory(path?: string) {
    loading = true;
    error = '';

    try {
      const { data, error: apiError } = await api.api.agents({ machineId }).filesystem.get({
        query: path ? { path } : {}
      });

      if (apiError) {
        error = extractErrorMessage(apiError);
        return;
      }

      if (!data?.success) {
        error = (data && 'error' in data && typeof data.error === 'string')
          ? data.error
          : 'Failed to load directory';
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

<div class="flex flex-col h-full min-h-0 bg-background">
  <!-- Navigation Bar -->
  <div class="flex items-center gap-2 p-3 border-b border-border bg-muted/50">
    <Button
      variant="ghost"
      size="icon-sm"
      onclick={navigateUp}
      disabled={!parentPath || loading}
      title="Go up"
    >
      <ChevronUp class="w-4 h-4" />
    </Button>

    <Button
      variant="ghost"
      size="icon-sm"
      onclick={navigateHome}
      disabled={loading}
      title="Go to home directory"
    >
      <House class="w-4 h-4" />
    </Button>

    <Button
      variant="ghost"
      size="icon-sm"
      onclick={() => loadDirectory(currentPath)}
      disabled={loading}
      title="Refresh"
    >
      <RefreshCw class="w-4 h-4 {loading ? 'animate-spin' : ''}" />
    </Button>

    <form onsubmit={handleManualNavigate} class="flex-1 flex gap-2">
      <input
        type="text"
        bind:value={manualPath}
        placeholder="Enter path..."
        class="input flex-1 text-sm py-1.5 font-mono"
      />
      <Button
        type="submit"
        size="sm"
        disabled={loading}
      >
        Go
      </Button>
    </form>
  </div>

  <!-- Current Path Display -->
  <div class="px-4 py-2 border-b border-border bg-muted/30">
    <div class="flex items-center gap-2 text-xs">
      <span class="text-muted-foreground uppercase tracking-wider font-bold">Path</span>
      <span class="font-mono text-muted-foreground truncate">{currentPath}</span>
    </div>
  </div>

  <!-- Error Display -->
  {#if error}
    <div class="p-3 bg-error/10 border-b border-error/20 text-error text-sm animate-fade-in">
      {error}
    </div>
  {/if}

  <!-- File List -->
  <div class="flex-1 overflow-y-auto min-h-0">
    {#if loading && entries.length === 0}
      <div class="flex flex-col items-center justify-center h-48 text-muted-foreground gap-3">
        <LoaderCircle class="w-6 h-6 animate-spin" />
        <span class="text-sm">Fetching files...</span>
      </div>
    {:else if entries.length === 0}
      <div class="flex flex-col items-center justify-center h-48 text-muted-foreground italic text-sm">
        Empty directory
      </div>
    {:else}
      <div class="divide-y divide-border/50">
        {#each entries as entry (entry.path)}
          <button
            type="button"
            onclick={() => navigateTo(entry)}
            disabled={!entry.isDirectory}
            class="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-accent transition-colors text-left group
                   {entry.isDirectory ? 'cursor-pointer' : 'cursor-default opacity-60'}"
          >
            <!-- Icon -->
            <div class="shrink-0">
              {#if entry.isDirectory}
                <Folder class="w-4 h-4 text-warning" fill="currentColor" fill-opacity="0.2" />
              {:else}
                <File class="w-4 h-4 text-muted-foreground" />
              {/if}
            </div>

            <!-- Name -->
            <div class="flex-1 min-w-0">
              <span class="font-mono text-sm text-foreground truncate block">
                {entry.name}
                {#if entry.isSymlink}
                  <LinkIcon class="inline w-3 h-3 text-muted-foreground ml-1" />
                {/if}
              </span>
            </div>

            <!-- Size (for files) -->
            {#if !entry.isDirectory && entry.size !== undefined}
              <span class="text-xs text-muted-foreground tabular-nums font-mono">
                {formatSize(entry.size)}
              </span>
            {/if}

            <!-- Navigate arrow for directories -->
            {#if entry.isDirectory}
              <ChevronRight class="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
            {/if}
          </button>
        {/each}
      </div>
    {/if}
  </div>

  <!-- Select Button -->
  {#if onSelect}
    <div class="p-4 border-t border-border bg-muted/50">
      <Button
        onclick={selectCurrentPath}
        disabled={loading || !currentPath}
        class="w-full shadow-sm"
      >
        <span class="flex-1">Select directory</span>
        <ArrowRight class="w-4 h-4 ml-2" />
      </Button>
    </div>
  {/if}
</div>
