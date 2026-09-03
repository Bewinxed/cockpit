<script lang="ts">
  import type { HTMLAttributes } from "svelte/elements";
  import { cn, type WithElementRef } from "$lib/utils.js";

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLSpanElement>> = $props();
</script>

<span
  class={cn("ml-auto text-muted-foreground text-xs tracking-widest group-focus/menubar-item:text-accent-foreground", className)}
  data-slot="menubar-shortcut"
  bind:this={ref}
  {...restProps}
>
  {@render children?.()}
</span>
