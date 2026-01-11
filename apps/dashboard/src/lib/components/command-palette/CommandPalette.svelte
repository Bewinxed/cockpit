<script lang="ts">
  import { Search, Terminal, Plus, Square } from 'lucide-svelte';
  import {
    populatedInstances,
    toggleCommandPalette,
    commandPaletteOpen
  } from '$lib/stores/realtime.svelte';
  import { navigateToInstance } from '$lib/stores/url-sync.svelte';

  let query = $state('');
  let selectedIndex = $state(0);
  let inputEl: HTMLInputElement | null = $state(null);

  interface CommandItem {
    id: string;
    type: 'instance' | 'action' | 'navigation';
    label: string;
    description?: string;
    icon: typeof Terminal;
    action: () => void;
  }

  const items = $derived.by(() => {
    const results: CommandItem[] = [];

    // Search instances
    const q = query.toLowerCase();
    for (const instance of $populatedInstances) {
      const name = instance.name || '';
      const cwd = instance.cwd || '';
      const project = instance.project || '';

      if (
        name.toLowerCase().includes(q) ||
        cwd.toLowerCase().includes(q) ||
        project.toLowerCase().includes(q)
      ) {
        results.push({
          id: instance.id,
          type: 'instance',
          label: name || cwd.split('/').pop() || 'Instance',
          description: cwd,
          icon: Terminal,
          action: () => {
            navigateToInstance(instance.id, true);
            toggleCommandPalette();
          },
        });
      }
    }

    // Static actions (always shown when query matches or empty)
    if ('new instance'.includes(q) || q === '') {
      results.push({
        id: 'new-instance',
        type: 'action',
        label: 'New Instance',
        description: 'Create a new Claude session',
        icon: Plus,
        action: () => {
          window.dispatchEvent(new CustomEvent('cockpit:new-instance'));
          toggleCommandPalette();
        },
      });
    }

    if ('stop all'.includes(q)) {
      results.push({
        id: 'stop-all',
        type: 'action',
        label: 'Stop All Instances',
        description: 'Stop all running instances',
        icon: Square,
        action: () => {
          // TODO: Implement stop all
          toggleCommandPalette();
        },
      });
    }

    return results.slice(0, 10); // Limit results
  });

  // Reset selection when query changes
  $effect(() => {
    query; // Dependency
    selectedIndex = 0;
  });

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIndex = Math.min(selectedIndex + 1, items.length - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIndex = Math.max(selectedIndex - 1, 0);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = items[selectedIndex];
      if (item) item.action();
    } else if (e.key === 'Escape') {
      toggleCommandPalette();
    }
  }

  // Focus input when palette opens
  $effect(() => {
    if ($commandPaletteOpen && inputEl) {
      inputEl.focus();
    }
  });
</script>

<!-- Backdrop -->
<div
  class="fixed inset-0 bg-black/50 z-50"
  onclick={toggleCommandPalette}
  onkeydown={handleKeydown}
  role="button"
  tabindex="-1"
></div>

<!-- Palette -->
<div class="fixed top-[20%] left-1/2 -translate-x-1/2 w-full max-w-lg bg-card border border-border rounded-xl shadow-2xl z-50 overflow-hidden">
  <!-- Search Input -->
  <div class="flex items-center gap-3 px-4 py-3 border-b border-border">
    <Search class="w-5 h-5 text-muted-foreground" />
    <input
      bind:this={inputEl}
      bind:value={query}
      type="text"
      placeholder="Search instances, actions..."
      class="flex-1 bg-transparent text-foreground placeholder:text-muted-foreground focus:outline-none"
      onkeydown={handleKeydown}
    />
    <kbd class="px-2 py-0.5 text-xs bg-muted text-muted-foreground rounded">ESC</kbd>
  </div>

  <!-- Results -->
  <div class="max-h-80 overflow-y-auto">
    {#each items as item, index (item.id)}
      {@const Icon = item.icon}
      <button
        class="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors"
        class:bg-accent={index === selectedIndex}
        onclick={item.action}
        onmouseenter={() => selectedIndex = index}
      >
        <Icon class="w-4 h-4 text-muted-foreground" />
        <div class="flex-1 min-w-0">
          <div class="text-sm font-medium text-foreground truncate">{item.label}</div>
          {#if item.description}
            <div class="text-xs text-muted-foreground truncate">{item.description}</div>
          {/if}
        </div>
        <span class="text-xs text-muted-foreground capitalize">{item.type}</span>
      </button>
    {/each}

    {#if items.length === 0}
      <div class="px-4 py-8 text-center text-muted-foreground">
        No results for "{query}"
      </div>
    {/if}
  </div>
</div>
