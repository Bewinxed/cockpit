<script lang="ts">
  import { Send, Loader2 } from 'lucide-svelte';
  import { Button } from '$lib/components/ui';

  interface Props {
    disabled?: boolean;
    loading?: boolean;
    placeholder?: string;
    onSend: (message: string) => void | Promise<void>;
  }

  let {
    disabled = false,
    loading = false,
    placeholder = 'Type a message...',
    onSend,
  }: Props = $props();

  let message = $state('');
  let textareaRef = $state<HTMLTextAreaElement | null>(null);

  // Auto-resize textarea
  function handleInput(e: Event) {
    const target = e.target as HTMLTextAreaElement;
    target.style.height = 'auto';
    target.style.height = Math.min(target.scrollHeight, 200) + 'px';
  }

  async function handleSubmit(e?: Event) {
    e?.preventDefault();

    const trimmed = message.trim();
    if (!trimmed || disabled || loading) return;

    await onSend(trimmed);
    message = '';

    // Reset textarea height
    if (textareaRef) {
      textareaRef.style.height = 'auto';
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    // Submit on Cmd/Ctrl + Enter
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
  }
</script>

<form class="flex gap-3 p-4 bg-surface border-t border-border" onsubmit={handleSubmit}>
  <div class="flex-1 relative">
    <textarea
      bind:this={textareaRef}
      bind:value={message}
      {placeholder}
      disabled={disabled || loading}
      rows={1}
      class="input resize-none min-h-[42px] max-h-[200px] py-2.5 pr-12 disabled:bg-surface-hover disabled:cursor-not-allowed"
      oninput={handleInput}
      onkeydown={handleKeydown}
    ></textarea>

    <!-- Character hint -->
    <div class="absolute right-3 bottom-2 text-[10px] text-text-muted pointer-events-none">
      {#if message.length > 0}
        ⌘↵ to send
      {/if}
    </div>
  </div>

  <Button
    type="submit"
    variant="primary"
    size="md"
    disabled={disabled || loading || !message.trim()}
    class="self-end"
  >
    {#snippet icon()}
      {#if loading}
        <Loader2 class="w-4 h-4 animate-spin" />
      {:else}
        <Send class="w-4 h-4" />
      {/if}
    {/snippet}
    {#snippet children()}
      Send
    {/snippet}
  </Button>
</form>
