<script lang="ts">
  import type { HTMLAttributes } from "svelte/elements";
  import { Skeleton } from "$lib/components/ui/skeleton/index.js";
  import { cn, type WithElementRef } from "$lib/utils.js";

  let {
    ref = $bindable(null),
    class: className,
    showIcon = false,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLElement>> & {
    showIcon?: boolean;
  } = $props();

  // Random width between 50% and 90%
  const width = `${Math.floor(Math.random() * 40) + 50}%`;
</script>

<div
  class={cn("h-8 gap-2 rounded-[var(--radius-control)] px-2 flex items-center", className)}
  data-sidebar="menu-skeleton"
  data-slot="sidebar-menu-skeleton"
  bind:this={ref}
  {...restProps}
>
  {#if showIcon}
    <Skeleton
      class="size-4 rounded-[var(--radius-mark)]"
      data-sidebar="menu-skeleton-icon"
    />
  {/if}
  <Skeleton
    class="h-4 max-w-(--skeleton-width) flex-1"
    data-sidebar="menu-skeleton-text"
    style="--skeleton-width: {width};"
  />
  {@render children?.()}
</div>
