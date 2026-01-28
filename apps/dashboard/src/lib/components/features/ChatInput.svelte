<script lang="ts">
  import { LoaderCircle, Send } from 'lucide-svelte';
  import CommandPalette from './CommandPalette.svelte';

  interface AvailableCommand {
    name: string;
    type: 'builtin' | 'custom' | 'skill' | 'mcp';
    description?: string;
    source?: string;
  }

  interface Props {
    disabled?: boolean;
    loading?: boolean;
    streaming?: boolean;
    placeholder?: string;
    commands?: AvailableCommand[];
    onSend: (message: string) => void | Promise<void>;
    onInterrupt?: () => void | Promise<void>;
  }

  let {
    disabled = false,
    loading = false,
    streaming = false,
    placeholder = 'Type a message...',
    commands = [],
    onSend,
    onInterrupt,
  }: Props = $props();

  let message = $state('');
  let textareaRef = $state<HTMLTextAreaElement | null>(null);
  let showPalette = $state(false);
  let selectedIndex = $state(0);
  let commandSelected = $state(false); // Track if a command was just selected

  // Check if we should show command palette
  $effect(() => {
    // Don't reopen palette immediately after selecting a command
    if (commandSelected) return;

    // Show palette when message starts with / and has commands
    const shouldShow = message.startsWith('/') && commands.length > 0 && !loading;
    showPalette = shouldShow;

    // Reset selection when filter changes
    if (shouldShow) {
      selectedIndex = 0;
    }
  });

  // Get filtered commands count for navigation bounds
  let filteredCommands = $derived(
    commands.filter((cmd) => {
      const searchTerm = message.toLowerCase().replace(/^\//, '');
      return cmd.name.toLowerCase().includes(searchTerm) ||
        (cmd.description?.toLowerCase().includes(searchTerm) ?? false);
    })
  );

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

    // Capture and clear immediately for fluidity
    const msgToSend = trimmed;
    message = '';
    showPalette = false;

    // Reset textarea height
    if (textareaRef) {
      textareaRef.style.height = 'auto';
    }

    await onSend(msgToSend);
  }

  function handleCommandSelect(command: AvailableCommand) {
    // Replace the current input with the command
    message = command.name + ' ';
    showPalette = false;
    commandSelected = true; // Prevent palette from reopening

    // Focus back on textarea
    textareaRef?.focus();
  }

  function handleKeydown(e: KeyboardEvent) {
    // Handle palette navigation
    if (showPalette && filteredCommands.length > 0) {
      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault();
          selectedIndex = selectedIndex > 0 ? selectedIndex - 1 : filteredCommands.length - 1;
          return;
        case 'ArrowDown':
          e.preventDefault();
          selectedIndex = selectedIndex < filteredCommands.length - 1 ? selectedIndex + 1 : 0;
          return;
        case 'Enter':
          if (!e.shiftKey && !e.metaKey && !e.ctrlKey) {
            e.preventDefault();
            const selected = filteredCommands[selectedIndex];
            if (selected) {
              handleCommandSelect(selected);
            }
            return;
          }
          break;
        case 'Escape':
          e.preventDefault();
          showPalette = false;
          return;
        case 'Tab': {
          e.preventDefault();
          const selected = filteredCommands[selectedIndex];
          if (selected) {
            handleCommandSelect(selected);
          }
          return;
        }
      }
    }

    // Enter without modifiers: submit when palette is closed
    if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !showPalette) {
      e.preventDefault();
      commandSelected = false; // Reset for next time
      handleSubmit();
      return;
    }

    // Ctrl/Cmd + Enter: Interrupt if streaming, otherwise submit
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      if (streaming && onInterrupt) {
        onInterrupt();
      } else {
        // If palette is open, select the highlighted command first before submitting
        if (showPalette && filteredCommands.length > 0) {
          const selected = filteredCommands[selectedIndex];
          if (selected) {
            message = selected.name;
          }
        }
        commandSelected = false;
        handleSubmit();
      }
    }
  }
</script>

<div class="border-t border-border px-4 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
  <form class="max-w-3xl mx-auto" onsubmit={handleSubmit}>
    <!-- Command Palette -->
    <CommandPalette
      {commands}
      filter={message}
      {selectedIndex}
      onSelect={handleCommandSelect}
      visible={showPalette}
    />

    <div class="flex items-end gap-2 bg-background border border-input rounded-lg
                focus-within:ring-2 focus-within:ring-ring/20 focus-within:border-ring
                transition-colors"
    >
      <textarea
        bind:this={textareaRef}
        bind:value={message}
        {placeholder}
        disabled={disabled || loading}
        rows={1}
        class="flex-1 resize-none min-h-10 max-h-[200px] py-2.5 pl-3
               bg-transparent border-none
               text-sm leading-5 overflow-y-hidden
               placeholder:text-muted-foreground
               focus:outline-none
               disabled:opacity-50 disabled:cursor-not-allowed"
        oninput={handleInput}
        onkeydown={handleKeydown}
      ></textarea>

      <button
        type="submit"
        disabled={disabled || loading || !message.trim()}
        class="shrink-0 size-7 m-1.5 rounded-md
               bg-primary text-primary-foreground
               flex items-center justify-center
               hover:bg-primary/90
               active:scale-95
               disabled:opacity-30 disabled:cursor-not-allowed
               transition-all"
        title="Send message"
        aria-label={loading ? 'Sending message' : 'Send message'}
      >
        {#if loading}
          <LoaderCircle class="size-3.5 animate-spin" />
        {:else}
          <Send size={14} />
        {/if}
      </button>
    </div>
  </form>
</div>
