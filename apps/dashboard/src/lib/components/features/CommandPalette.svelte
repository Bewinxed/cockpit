<script lang="ts">
  import { Command, Zap, Settings, FileCode } from 'lucide-svelte';

  interface AvailableCommand {
    name: string;
    type: 'builtin' | 'custom' | 'skill' | 'mcp';
    description?: string;
    source?: string;
  }

  interface Props {
    commands: AvailableCommand[];
    filter: string;
    selectedIndex: number;
    onSelect: (command: AvailableCommand) => void;
    visible: boolean;
  }

  let {
    commands,
    filter,
    selectedIndex,
    onSelect,
    visible,
  }: Props = $props();

  let itemRefs: HTMLButtonElement[] = [];

  // Scroll selected item into view when index changes
  $effect(() => {
    if (visible && itemRefs[selectedIndex]) {
      itemRefs[selectedIndex].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  });

  // Filter commands based on input
  let filteredCommands = $derived(
    commands.filter((cmd) => {
      const searchTerm = filter.toLowerCase().replace(/^\//, '');
      return cmd.name.toLowerCase().includes(searchTerm) ||
        (cmd.description?.toLowerCase().includes(searchTerm) ?? false);
    })
  );

  function getCommandIcon(type: AvailableCommand['type']) {
    switch (type) {
      case 'builtin':
        return Command;
      case 'custom':
        return FileCode;
      case 'skill':
        return Zap;
      case 'mcp':
        return Settings;
      default:
        return Command;
    }
  }

  function getTypeLabel(type: AvailableCommand['type']) {
    switch (type) {
      case 'builtin':
        return 'Built-in';
      case 'custom':
        return 'Custom';
      case 'skill':
        return 'Skill';
      case 'mcp':
        return 'MCP';
      default:
        return type;
    }
  }

  function getTypeColor(type: AvailableCommand['type']) {
    switch (type) {
      case 'builtin':
        return 'bg-primary/20 text-primary';
      case 'custom':
        return 'bg-success/20 text-success';
      case 'skill':
        return 'bg-warning/20 text-warning';
      case 'mcp':
        return 'bg-secondary/20 text-secondary';
      default:
        return 'bg-text-muted/20 text-text-muted';
    }
  }
</script>

{#if visible && filteredCommands.length > 0}
  <div
    class="absolute bottom-full left-0 right-0 mb-2 bg-surface border border-border rounded-lg shadow-lg max-h-64 overflow-y-auto z-50"
  >
    <div class="p-2 border-b border-border">
      <span class="text-xs text-text-muted">
        Available commands ({filteredCommands.length})
      </span>
    </div>
    <div class="py-1">
      {#each filteredCommands as command, index (command.name)}
        {@const Icon = getCommandIcon(command.type)}
        <button
          bind:this={itemRefs[index]}
          type="button"
          class="w-full px-3 py-2 flex items-center gap-3 hover:bg-surface-hover transition-colors text-left
                 {index === selectedIndex ? 'bg-surface-hover' : ''}"
          onclick={() => onSelect(command)}
        >
          <Icon class="w-4 h-4 text-text-muted flex-shrink-0" />
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <span class="font-medium text-text">{command.name}</span>
              <span class="text-[10px] px-1.5 py-0.5 rounded {getTypeColor(command.type)}">
                {getTypeLabel(command.type)}
              </span>
            </div>
            {#if command.description}
              <p class="text-xs text-text-muted truncate">
                {command.description}
              </p>
            {/if}
          </div>
        </button>
      {/each}
    </div>
    <div class="p-2 border-t border-border text-xs text-text-muted flex gap-4">
      <span><kbd class="px-1 bg-surface-hover rounded">↑↓</kbd> navigate</span>
      <span><kbd class="px-1 bg-surface-hover rounded">↵</kbd> select</span>
      <span><kbd class="px-1 bg-surface-hover rounded">esc</kbd> close</span>
    </div>
  </div>
{/if}
