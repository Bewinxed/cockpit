<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { FileDiff, type FileContents } from '@pierre/diffs';
  import { X, Columns, AlignJustify, Copy, Check } from 'lucide-svelte';

  interface Props {
    filePath: string;
    oldContent: string;
    newContent: string;
    onClose: () => void;
  }

  let { filePath, oldContent, newContent, onClose }: Props = $props();
  let container: HTMLDivElement;
  let diffInstance: FileDiff | null = null;
  let diffStyle = $state<'unified' | 'split'>('unified');
  let copied = $state(false);

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

  function clearContainer() {
    // Safely clear container by removing all children
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }
  }

  function renderDiff() {
    if (!container) return;

    // Clean up existing instance
    if (diffInstance) {
      diffInstance.cleanUp();
    }

    // Clear container safely
    clearContainer();

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
      diffStyle: diffStyle,
      expandUnchanged: true,
      hunkSeparators: 'line-info',
    });

    // Pass container as containerWrapper, not fileContainer
    // The library creates its own diffs-container custom element with shadowRoot
    diffInstance.render({
      oldFile,
      newFile,
      containerWrapper: container,
    });
  }

  onMount(() => {
    renderDiff();

    // Handle escape key
    function handleKeydown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose();
      }
    }
    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  });

  onDestroy(() => {
    if (diffInstance) {
      diffInstance.cleanUp();
      diffInstance = null;
    }
  });

  // Re-render when diff style changes
  $effect(() => {
    if (container && diffStyle) {
      renderDiff();
    }
  });

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }

  async function copyPath() {
    await navigator.clipboard.writeText(filePath);
    copied = true;
    setTimeout(() => copied = false, 2000);
  }

  // Calculate stats
  const stats = $derived(() => {
    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');

    // Simple line-based diff stats
    let additions = 0;
    let deletions = 0;

    // Count lines that changed
    const maxLen = Math.max(oldLines.length, newLines.length);
    for (let i = 0; i < maxLen; i++) {
      if (oldLines[i] !== newLines[i]) {
        if (i < oldLines.length && oldLines[i]) deletions++;
        if (i < newLines.length && newLines[i]) additions++;
      }
    }

    return { additions, deletions };
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
  class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in"
  onclick={handleBackdropClick}
>
  <div
    class="relative w-[95vw] h-[90vh] max-w-7xl bg-bg rounded-xl shadow-2xl border border-border flex flex-col overflow-hidden animate-scale-in"
  >
    <!-- Header -->
    <div class="flex items-center justify-between px-4 py-3 border-b border-border bg-surface">
      <div class="flex items-center gap-3 min-w-0">
        <div class="flex items-center gap-2 min-w-0">
          <span class="font-mono text-sm text-text truncate">{filePath}</span>
          <button
            onclick={copyPath}
            class="p-1 rounded hover:bg-surface-hover transition-colors flex-shrink-0"
            title="Copy path"
          >
            {#if copied}
              <Check class="w-3.5 h-3.5 text-success" />
            {:else}
              <Copy class="w-3.5 h-3.5 text-text-muted" />
            {/if}
          </button>
        </div>
        <div class="flex items-center gap-2 text-xs">
          <span class="text-success">+{stats().additions}</span>
          <span class="text-error">-{stats().deletions}</span>
        </div>
      </div>

      <div class="flex items-center gap-2">
        <!-- Diff style toggle -->
        <div class="flex items-center bg-bg-subtle rounded-lg p-0.5 border border-border">
          <button
            onclick={() => diffStyle = 'unified'}
            class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors {diffStyle === 'unified' ? 'bg-surface text-text shadow-sm' : 'text-text-muted hover:text-text'}"
            title="Unified view"
          >
            <AlignJustify class="w-3.5 h-3.5" />
            <span>Unified</span>
          </button>
          <button
            onclick={() => diffStyle = 'split'}
            class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors {diffStyle === 'split' ? 'bg-surface text-text shadow-sm' : 'text-text-muted hover:text-text'}"
            title="Split view"
          >
            <Columns class="w-3.5 h-3.5" />
            <span>Split</span>
          </button>
        </div>

        <!-- Close button -->
        <button
          onclick={onClose}
          class="p-2 rounded-lg hover:bg-surface-hover transition-colors text-text-muted hover:text-text"
          title="Close (Esc)"
        >
          <X class="w-5 h-5" />
        </button>
      </div>
    </div>

    <!-- Diff content -->
    <div class="flex-1 overflow-auto">
      <div bind:this={container} class="diff-modal-content"></div>
    </div>
  </div>
</div>

<style>
  @keyframes fade-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes scale-in {
    from {
      opacity: 0;
      transform: scale(0.95);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }

  .animate-fade-in {
    animation: fade-in 0.15s ease-out;
  }

  .animate-scale-in {
    animation: scale-in 0.2s ease-out;
  }

  .diff-modal-content {
    min-height: 100%;
  }

  /* Override @pierre/diffs styles for modal */
  .diff-modal-content :global(pre) {
    margin: 0;
    font-size: 0.8125rem;
    line-height: 1.6;
  }

  .diff-modal-content :global(.diffs-line-added) {
    background-color: rgba(var(--color-success-rgb), 0.15);
  }

  .diff-modal-content :global(.diffs-line-removed) {
    background-color: rgba(var(--color-error-rgb), 0.15);
  }

  .diff-modal-content :global(.diffs-hunk-separator) {
    background-color: var(--color-surface-hover);
    color: var(--color-text-muted);
    font-size: 0.75rem;
    padding: 0.5rem 1rem;
  }
</style>
