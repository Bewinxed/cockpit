<script lang="ts">
  import { X } from 'lucide-svelte';
  import type { Snippet } from 'svelte';

  interface Props {
    open: boolean;
    onClose: () => void;
    title?: string;
    children: Snippet;
    footer?: Snippet;
    size?: 'sm' | 'md' | 'lg';
  }

  let {
    open,
    onClose,
    title,
    children,
    footer,
    size = 'md',
  }: Props = $props();

  const sizeClasses = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
  };

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      onClose();
    }
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
  <!-- Backdrop -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    class="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
    onclick={handleBackdropClick}
    onkeydown={(e) => e.key === 'Escape' && onClose()}
    role="dialog"
    aria-modal="true"
    tabindex="-1"
  >
    <!-- Modal -->
    <div 
      class="bg-paper rounded-xl shadow-xl w-full {sizeClasses[size]} animate-fade-in overflow-hidden"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
      role="document"
    >
      <!-- Header -->
      {#if title}
        <div class="flex items-center justify-between px-6 py-4 border-b border-border bg-surface/50">
          <h2 class="text-lg font-semibold text-text font-serif tracking-tight">{title}</h2>
          <button
            type="button"
            class="p-2 rounded-lg hover:bg-surface-hover transition-colors text-text-muted hover:text-text"
            onclick={onClose}
            aria-label="Close modal"
          >
            <X class="w-5 h-5" />
          </button>
        </div>
      {/if}

      <!-- Content -->
      <div class="px-6 py-6">
        {@render children()}
      </div>

      <!-- Footer -->
      {#if footer}
        <div class="px-6 py-4 border-t border-border bg-surface/50">
          {@render footer()}
        </div>
      {/if}
    </div>
  </div>
{/if}
