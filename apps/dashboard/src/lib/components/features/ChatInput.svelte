<script lang="ts">
  import { Send, Loader2 } from 'lucide-svelte';
  import { Button } from '$lib/components/ui';
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
        case 'Tab':
          e.preventDefault();
          const selected = filteredCommands[selectedIndex];
          if (selected) {
            handleCommandSelect(selected);
          }
          return;
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

<form class="bg-card/80 backdrop-blur-lg border-t border-border px-4 py-4" onsubmit={handleSubmit}>
  <div class="max-w-4xl mx-auto flex items-end gap-3">
    <div class="flex-1 relative group">
      <!-- Command Palette -->
      <CommandPalette
        {commands}
        filter={message}
        {selectedIndex}
        onSelect={handleCommandSelect}
        visible={showPalette}
      />

      <div class="relative">
        <textarea
          bind:this={textareaRef}
          bind:value={message}
          {placeholder}
          disabled={disabled || loading}
          rows={1}
          class="w-full resize-none min-h-[52px] max-h-[200px] py-3.5 px-4 pr-24
                 bg-background border border-input rounded-2xl
                 text-sm leading-relaxed
                 placeholder:text-muted-foreground
                 focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-ring
                 disabled:opacity-50 disabled:cursor-not-allowed
                 transition-all duration-200"
          oninput={handleInput}
          onkeydown={handleKeydown}
        ></textarea>

        <!-- Keyboard hints inside textarea -->
        <div class="absolute right-3 bottom-3.5 flex items-center gap-2 text-[10px] text-muted-foreground pointer-events-none opacity-0 group-focus-within:opacity-100 transition-opacity">
          {#if streaming}
            <kbd class="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 font-medium border border-amber-500/20">⌘↵ interrupt</kbd>
          {:else if message.length > 0}
            {#if showPalette}
              <span class="text-muted-foreground">↵ select</span>
            {:else}
              <kbd class="px-1.5 py-0.5 rounded bg-muted font-medium border border-border">↵ send</kbd>
            {/if}
          {/if}
        </div>
      </div>
    </div>

    <button
      type="submit"
      disabled={disabled || loading || !message.trim()}
      class="flex-shrink-0 w-11 h-11 rounded-xl
             bg-primary text-primary-foreground
             flex items-center justify-center
             hover:bg-primary/90 hover:scale-105
             active:scale-95
             disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100
             transition-all duration-200 shadow-sm"
      title="Send message"
    >
      {#if loading}
        <Loader2 class="size-5 animate-spin" />
      {:else}
        <Send class="size-5 translate-x-0.5" />
      {/if}
    </button>
  </div>
</form>
