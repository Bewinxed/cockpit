<script lang="ts">
  import { onDestroy } from 'svelte';
  import { fade, scale } from 'svelte/transition';
  import { quintOut } from 'svelte/easing';
  import { Dialog } from 'bits-ui';
  import { FileDiff, parseDiffFromFile, type FileContents } from '@pierre/diffs';
  import { X, Columns2, TextAlignStart } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import { CopyButton } from '$lib/components/ui/copy-button';

  interface Props {
    filePath: string;
    oldContent: string;
    newContent: string;
    onClose: () => void;
  }

  let { filePath, oldContent, newContent, onClose }: Props = $props();
  // The parent unmounts us on `onClose`, so the close runs through bits first
  // and only hands back once the exit transition has finished.
  let open = $state(true);
  let container = $state<HTMLDivElement | null>(null);
  let diffInstance: FileDiff | null = null;
  let diffStyle = $state<'unified' | 'split'>('unified');

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

  function renderDiff() {
    if (!container) return;

    // Clean up existing instance (though {#key} handles container recreation)
    if (diffInstance) {
      diffInstance.cleanUp();
      diffInstance = null;
    }

    const lang = getLanguageFromPath(filePath);
    const fileName = getFileName(filePath);

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

  // Calculate stats
  const stats = $derived(() => {
    const fileName = getFileName(filePath);
    const fileDiff = parseDiffFromFile(
      { name: fileName, contents: oldContent },
      { name: fileName, contents: newContent }
    );

    let additions = 0;
    let deletions = 0;
    for (const hunk of fileDiff.hunks) {
      additions += hunk.additionLines;
      deletions += hunk.deletionLines;
    }

    return { additions, deletions };
  });
</script>

<Dialog.Root bind:open onOpenChangeComplete={(isOpen) => !isOpen && onClose()}>
  <Dialog.Portal>
    <Dialog.Overlay forceMount>
      {#snippet child({ props, open: isOpen })}
        {#if isOpen}
          <div
            {...props}
            class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
            in:fade={{ duration: 200 }}
            out:fade={{ duration: 150 }}
          ></div>
        {/if}
      {/snippet}
    </Dialog.Overlay>

    <Dialog.Content forceMount aria-label={`Diff: ${filePath}`}>
      {#snippet child({ props, open: isOpen })}
        {#if isOpen}
          <div
            {...props}
            class="fixed top-1/2 left-1/2 z-50 w-[95vw] h-[90vh] max-w-7xl -translate-x-1/2 -translate-y-1/2 bg-background rounded-xl shadow-2xl border border-border flex flex-col overflow-hidden"
            in:scale={{ duration: 200, start: 0.96, easing: quintOut }}
            out:scale={{ duration: 150, start: 0.96, easing: quintOut }}
          >
            <!-- Header -->
            <div class="flex items-center justify-between px-4 py-3 border-b border-border bg-card">
              <div class="flex items-center gap-3 min-w-0">
                <div class="flex items-center gap-2 min-w-0">
                  <span class="font-mono text-sm text-foreground truncate">{filePath}</span>
                  <CopyButton
                    text={filePath}
                    variant="ghost"
                    size="icon-sm"
                    class="h-6 w-6"
                  />
                </div>
                <div class="flex items-center gap-2 text-xs">
                  <span class="text-success">+{stats().additions}</span>
                  <span class="text-error">-{stats().deletions}</span>
                </div>
              </div>

              <div class="flex items-center gap-2">
                <!-- Diff style toggle -->
                <div
                  class="flex items-center bg-muted rounded-lg p-0.5 border border-border"
                  role="group"
                  aria-label="Diff layout"
                >
                  <Button
                    variant={diffStyle === 'unified' ? 'outline' : 'ghost'}
                    size="sm"
                    onclick={() => diffStyle = 'unified'}
                    class="h-7 rounded-[14px] text-xs {diffStyle === 'unified'
                      ? 'bg-background border-border shadow-sm'
                      : ''}"
                    aria-pressed={diffStyle === 'unified'}
                    title="Unified view"
                  >
                    <TextAlignStart class="w-3.5 h-3.5" />
                    <span>Unified</span>
                  </Button>
                  <Button
                    variant={diffStyle === 'split' ? 'outline' : 'ghost'}
                    size="sm"
                    onclick={() => diffStyle = 'split'}
                    class="h-7 rounded-[14px] text-xs {diffStyle === 'split'
                      ? 'bg-background border-border shadow-sm'
                      : ''}"
                    aria-pressed={diffStyle === 'split'}
                    title="Split view"
                  >
                    <Columns2 class="w-3.5 h-3.5" />
                    <span>Split</span>
                  </Button>
                </div>

                <!-- Close button -->
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onclick={() => (open = false)}
                  title="Close (Esc)"
                  aria-label="Close diff modal"
                >
                  <X class="size-5" />
                </Button>
              </div>
            </div>

            <!-- Diff content -->
            <div class="flex-1 overflow-auto">
              {#key diffStyle}
                <div bind:this={container} class="diff-modal-content"></div>
              {/key}
            </div>
          </div>
        {/if}
      {/snippet}
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>

<style>
  /* @pierre/diffs renders into a shadowRoot, so it can only be themed through
     the inherited custom properties it documents in its core stylesheet. */
  .diff-modal-content {
    min-height: 100%;
    --diffs-font-size: 0.8125rem;
    --diffs-line-height: 1.6;
    --diffs-bg-addition-override: color-mix(in srgb, var(--color-success) 15%, transparent);
    --diffs-bg-deletion-override: color-mix(in srgb, var(--color-error) 15%, transparent);
    --diffs-bg-separator-override: var(--muted);
  }
</style>
