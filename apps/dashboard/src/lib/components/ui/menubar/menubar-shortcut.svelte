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
  class={cn("text-xs tracking-widest text-muted-foreground group-focus/menubar-item:text-accent-foreground ml-auto", className)}
  data-slot="menubar-shortcut"
  bind:this={ref}
  {...restProps}
>
  {@render children?.()}
</span>
