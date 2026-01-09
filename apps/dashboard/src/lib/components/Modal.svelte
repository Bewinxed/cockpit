<script lang="ts">
  import { X } from 'lucide-svelte';
  import { Button } from '$lib/components/ui/button';

  interface Props {
    open: boolean;
    title: string;
    onClose: () => void;
    children: import('svelte').Snippet;
  }

  let { open = $bindable(), title, onClose, children }: Props = $props();

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
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
    onclick={handleBackdropClick}
    onkeydown={handleKeydown}
    role="dialog"
    aria-modal="true"
    aria-labelledby="modal-title"
    tabindex="-1"
  >
    <div class="bg-card rounded-2xl shadow-xl border border-border w-full max-w-md mx-4 overflow-hidden">
      <div class="flex items-center justify-between px-6 py-4 border-b border-border">
        <h2 id="modal-title" class="text-lg font-semibold text-foreground">{title}</h2>
        <Button
          variant="ghost"
          size="icon-sm"
          onclick={onClose}
        >
          <X class="w-5 h-5" />
        </Button>
      </div>
      <div class="p-6">
        {@render children()}
      </div>
    </div>
  </div>
{/if}
