<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { FileDiff, type FileContents } from '@pierre/diffs';
  import { Maximize2, CircleAlert, LoaderCircle } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import DiffModal from './DiffModal.svelte';

  interface Props {
    filePath: string;
    oldContent: string;
    newContent: string;
  }

  let { filePath, oldContent, newContent }: Props = $props();
  let container: HTMLDivElement;
  let diffInstance: FileDiff | null = null;
  let showModal = $state(false);
  let loading = $state(true);
  let error = $state<string | null>(null);

  // Get file extension for syntax highlighting
  function getLanguageFromPath(path: string): string | undefined {
    const ext = path.split('.').pop()?.toLowerCase();
    const langMap: Record<string, string> = {
      'ts': 'typescript',
      'tsx': 'tsx',
      'js': 'javascript',
      'jsx': 'jsx',
      'svelte': 'svelte',
      'vue': 'vue',
      'py': 'python',
      'rb': 'ruby',
      'go': 'go',
      'rs': 'rust',
      'java': 'java',
      'kt': 'kotlin',
      'swift': 'swift',
      'c': 'c',
      'cpp': 'cpp',
      'h': 'c',
      'hpp': 'cpp',
      'cs': 'csharp',
      'php': 'php',
      'html': 'html',
      'css': 'css',
      'scss': 'scss',
      'less': 'less',
      'json': 'json',
      'yaml': 'yaml',
      'yml': 'yaml',
      'xml': 'xml',
      'md': 'markdown',
      'sql': 'sql',
      'sh': 'bash',
      'bash': 'bash',
      'zsh': 'bash',
      'dockerfile': 'dockerfile',
      'toml': 'toml',
    };
    return ext ? langMap[ext] : undefined;
  }

  function getFileName(path: string): string {
    return path.split('/').pop() || path;
  }

  onMount(async () => {
    if (!container) return;

    try {
      const lang = getLanguageFromPath(filePath);
      const fileName = getFileName(filePath);

      // The library accepts any string for lang (or undefined for auto-detect)
      const oldFile: FileContents = {
        name: fileName,
        contents: oldContent,
        lang: lang as FileContents['lang'],
      };

      const newFile: FileContents = {
        name: fileName,
        contents: newContent,
        lang: lang as FileContents['lang'],
      };

      diffInstance = new FileDiff({
        disableFileHeader: true,
      });

      // Pass container as containerWrapper, not fileContainer
      // The library creates its own diffs-container custom element with shadowRoot
      diffInstance.render({
        oldFile,
        newFile,
        containerWrapper: container,
      });

      loading = false;
    } catch (e) {
      console.error('[DiffView] Failed to render diff:', e);
      error = e instanceof Error ? e.message : 'Failed to render diff';
      loading = false;
    }
  });

  onDestroy(() => {
    if (diffInstance) {
      diffInstance.cleanUp();
      diffInstance = null;
    }
  });

  function openModal() {
    showModal = true;
  }

  function closeModal() {
    showModal = false;
  }
</script>

<div class="rounded-lg overflow-hidden border border-border bg-muted">
  <div class="flex items-center justify-between px-3 py-2 bg-card border-b border-border font-mono text-xs text-muted-foreground">
    <span class="break-all flex-1 min-w-0">{filePath}</span>
    <Button
      variant="ghost"
      size="icon-sm"
      onclick={openModal}
      class="h-6 w-6 ml-2 shrink-0"
      title="Expand diff (full view)"
      disabled={loading || !!error}
    >
      <Maximize2 class="w-3.5 h-3.5" />
    </Button>
  </div>

  {#if loading}
    <div class="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
      <LoaderCircle class="w-5 h-5 animate-spin" />
      <span>Loading diff...</span>
    </div>
  {:else if error}
    <div class="flex items-center justify-center gap-2 p-8 text-sm text-error">
      <CircleAlert class="w-5 h-5" />
      <span>{error}</span>
    </div>
  {/if}

  <div bind:this={container} class="diff-content overflow-x-auto max-h-[400px]" class:hidden={loading || !!error}></div>
</div>

{#if showModal}
  <DiffModal
    {filePath}
    {oldContent}
    {newContent}
    onClose={closeModal}
  />
{/if}

<style>
  .diff-content.hidden {
    display: none;
  }
</style>
