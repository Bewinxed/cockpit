<script lang="ts">
  import { onMount } from "svelte";
  import { IconChat, IconCopy } from "$lib/icons";
  import { CONTEXT_MENU_CLICK_DELAY } from "$lib/utils/flow-constants";
  import type { ContextMenuAction } from "$lib/utils/flow-types";

  interface MenuItem {
    description: string;
    icon: typeof IconCopy;
    id: ContextMenuAction;
    label: string;
  }

  interface Props {
    onAction: (action: ContextMenuAction) => void;
    onClose: () => void;
    x: number;
    y: number;
  }

  let { x, y, onAction, onClose }: Props = $props();

  let menuRef = $state<HTMLDivElement | null>(null);

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
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
      document.addEventListener("click", handleClickOutside);
      document.addEventListener("keydown", handleKeydown);
    }, CONTEXT_MENU_CLICK_DELAY);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("click", handleClickOutside);
      document.removeEventListener("keydown", handleKeydown);
    };
  });

  const menuItems: MenuItem[] = [
    {
      id: "copy",
      label: "Copy content",
      icon: IconCopy,
      description: "Copy message content to clipboard",
    },
    {
      id: "jump",
      label: "Jump to chat view",
      icon: IconChat,
      description: "Switch to chat view",
    },
  ];
</script>

<div
  aria-label="Node actions"
  class="fixed z-50 min-w-[180px] rounded-[var(--radius-panel)] border border-border bg-popover p-1 shadow-xl material-panel animate-in fade-in-0 zoom-in-95"
  role="menu"
  style="left: {x}px; top: {y}px;"
  bind:this={menuRef}
>
  {#each menuItems as item (item.id)}
    <button
      aria-label={item.description}
      class="flex w-full items-center gap-2 rounded-[var(--radius-card)] px-2 py-1.5 text-sm text-popover-foreground hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onclick={() => onAction(item.id)}
      role="menuitem"
    >
      <item.icon aria-hidden="true" class="h-4 w-4" />
      <span>{item.label}</span>
    </button>
  {/each}
</div>
