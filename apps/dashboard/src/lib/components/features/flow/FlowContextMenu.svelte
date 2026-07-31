<script lang="ts">
  import { Copy, RotateCcw, GitBranch, MessageSquare, type Icon } from '@lucide/svelte';
  import { onMount } from 'svelte';
  import { CONTEXT_MENU_CLICK_DELAY } from '$lib/utils/flow-constants';
  import type { ContextMenuAction } from '$lib/utils/flow-types';

  interface MenuItem {
    id: ContextMenuAction;
    label: string;
    icon: typeof Icon;
    description: string;
  }

  interface Props {
    x: number;
    y: number;
    onAction: (action: ContextMenuAction) => void;
    onClose: () => void;
  }

  let { x, y, onAction, onClose }: Props = $props();

  let menuRef = $state<HTMLDivElement | null>(null);

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      onClose();
    }
  }

  function handleClickOutside(event: MouseEvent) {
    if (menuRef && !menuRef.contains(event.target as Node)) {
      onClose();
    }
  }

  onMount(() => {
    const timer = setTimeout(() => {
      document.addEventListener('click', handleClickOutside);
      document.addEventListener('keydown', handleKeydown);
    }, CONTEXT_MENU_CLICK_DELAY);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('click', handleClickOutside);
      document.removeEventListener('keydown', handleKeydown);
    };
  });

  const menuItems: MenuItem[] = [
    { id: 'copy', label: 'Copy content', icon: Copy, description: 'Copy message content to clipboard' },
    { id: 'rewind', label: 'Rewind to here', icon: RotateCcw, description: 'Rewind conversation to this point' },
    { id: 'branch', label: 'Branch from here', icon: GitBranch, description: 'Create a new branch from this message' },
    { id: 'jump', label: 'Jump to chat view', icon: MessageSquare, description: 'Switch to chat view' },
  ];
</script>

<div
  bind:this={menuRef}
  role="menu"
  aria-label="Node actions"
  class="fixed z-50 min-w-[180px] rounded-md border border-border bg-popover p-1 shadow-lg animate-in fade-in-0 zoom-in-95"
  style="left: {x}px; top: {y}px;"
>
  {#each menuItems as item (item.id)}
    <button
      role="menuitem"
      aria-label={item.description}
      class="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-popover-foreground hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onclick={() => onAction(item.id)}
    >
      <item.icon class="h-4 w-4" aria-hidden="true" />
      <span>{item.label}</span>
    </button>
  {/each}
</div>
