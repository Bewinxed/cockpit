<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { FileDiff, type FileContents } from '@pierre/diffs';
  import { Maximize2 } from 'lucide-svelte';
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

  // Unique ID for view transitions
  const viewTransitionId = `diff-${Math.random().toString(36).slice(2, 9)}`;

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

    const lang = getLanguageFromPath(filePath);
    const fileName = getFileName(filePath);

    const oldFile: FileContents = {
      name: fileName,
      contents: oldContent,
      lang: lang as any,
    };

    const newFile: FileContents = {
      name: fileName,
      contents: newContent,
      lang: lang as any,
    };

    diffInstance = new FileDiff({
      disableFileHeader: true,
    });

    diffInstance.render({
      oldFile,
      newFile,
      fileContainer: container,
    });
  });

  onDestroy(() => {
    if (diffInstance) {
      diffInstance.cleanUp();
      diffInstance = null;
    }
  });

  function openModal() {
    // Use View Transitions API if available
    if (document.startViewTransition) {
      document.startViewTransition(() => {
        showModal = true;
      });
    } else {
      showModal = true;
    }
  }

  function closeModal() {
    if (document.startViewTransition) {
      document.startViewTransition(() => {
        showModal = false;
      });
    } else {
      showModal = false;
    }
  }
</script>

<div
  class="diff-view-container"
  style="view-transition-name: {viewTransitionId}"
>
  <div class="diff-header">
    <span class="diff-path">{filePath}</span>
    <button
      onclick={openModal}
      class="expand-btn"
      title="Expand diff (full view)"
    >
      <Maximize2 class="w-3.5 h-3.5" />
    </button>
  </div>
  <div bind:this={container} class="diff-content"></div>
</div>

{#if showModal}
  <DiffModal
    {filePath}
    {oldContent}
    {newContent}
    onClose={closeModal}
    viewTransitionName={viewTransitionId}
  />
{/if}

<style>
  .diff-view-container {
    border-radius: 0.5rem;
    overflow: hidden;
    border: 1px solid var(--color-border);
    background: var(--color-bg-subtle);
  }

  .diff-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.5rem 0.75rem;
    background: var(--color-surface);
    border-bottom: 1px solid var(--color-border);
    font-family: var(--font-mono);
    font-size: 0.75rem;
    color: var(--color-text-secondary);
  }

  .diff-path {
    word-break: break-all;
    flex: 1;
    min-width: 0;
  }

  .expand-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0.375rem;
    margin-left: 0.5rem;
    border-radius: 0.375rem;
    color: var(--color-text-muted);
    background: transparent;
    border: none;
    cursor: pointer;
    transition: all 0.15s ease;
    flex-shrink: 0;
  }

  .expand-btn:hover {
    background: var(--color-surface-hover);
    color: var(--color-text);
  }

  .diff-content {
    overflow-x: auto;
    max-height: 400px;
  }

  /* Override @pierre/diffs default styles to match our theme */
  .diff-content :global(pre) {
    margin: 0;
    font-size: 0.75rem;
    line-height: 1.5;
  }

  .diff-content :global(.diffs-line-added) {
    background-color: rgba(var(--color-success-rgb), 0.15);
  }

  .diff-content :global(.diffs-line-removed) {
    background-color: rgba(var(--color-error-rgb), 0.15);
  }
</style>
