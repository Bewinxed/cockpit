<script lang="ts">
  import { onMount } from 'svelte';

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
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
    onclick={handleBackdropClick}
  >
    <div class="bg-bg-1 rounded-2xl shadow-xl border border-ui-1 w-full max-w-md mx-4 overflow-hidden">
      <div class="flex items-center justify-between px-6 py-4 border-b border-ui-1">
        <h2 class="text-lg font-semibold text-tx-1">{title}</h2>
        <button
          onclick={onClose}
          class="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-bg-3 text-tx-2 hover:text-tx-1 transition-colors"
        >
          <span class="text-xl">&times;</span>
        </button>
      </div>
      <div class="p-6">
        {@render children()}
      </div>
    </div>
  </div>
{/if}
