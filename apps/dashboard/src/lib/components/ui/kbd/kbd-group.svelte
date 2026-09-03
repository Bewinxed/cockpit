<script lang="ts">
  import type { HTMLAttributes } from "svelte/elements";
  import { cn, type WithElementRef } from "$lib/utils.js";

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLElement>> = $props();
</script>

<kbd
  class={cn("gap-1 inline-flex items-center", className)}
  data-slot="kbd-group"
  bind:this={ref}
  {...restProps}
>
  {@render children?.()}
</kbd>
