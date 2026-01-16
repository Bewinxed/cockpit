<script lang="ts">
  import { Copy, RotateCcw, GitBranch, MessageSquare } from 'lucide-svelte';
  import { onMount } from 'svelte';

  interface Props {
    x: number;
    y: number;
    onAction: (action: string) => void;
    onClose: () => void;
  }

  let { x, y, onAction, onClose }: Props = $props();

  let menuRef = $state<HTMLDivElement | null>(null);

  // Close on escape or click outside
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
    // Small delay to prevent immediate close from the same click
    const timer = setTimeout(() => {
      document.addEventListener('click', handleClickOutside);
      document.addEventListener('keydown', handleKeydown);
    }, 10);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('click', handleClickOutside);
      document.removeEventListener('keydown', handleKeydown);
    };
  });

  const menuItems = [
    { id: 'copy', label: 'Copy content', icon: Copy },
    { id: 'rewind', label: 'Rewind to here', icon: RotateCcw },
    { id: 'branch', label: 'Branch from here', icon: GitBranch },
    { id: 'jump', label: 'Jump to chat view', icon: MessageSquare },
  ];
</script>

<div
  bind:this={menuRef}
  class="fixed z-50 min-w-[180px] rounded-md border border-border bg-popover p-1 shadow-lg animate-in fade-in-0 zoom-in-95"
  style="left: {x}px; top: {y}px;"
>
  {#each menuItems as item}
    <button
      class="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-popover-foreground hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground focus:outline-none"
      onclick={() => onAction(item.id)}
    >
      <item.icon class="h-4 w-4" />
      <span>{item.label}</span>
    </button>
  {/each}
</div>
