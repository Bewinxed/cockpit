<script lang="ts">
  import type { HTMLAttributes } from "svelte/elements";
  import { cn, type WithElementRef } from "$lib/utils.js";

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLUListElement>> = $props();
</script>

<ul
  class={cn("gap-1 flex items-center", className)}
  data-slot="pagination-content"
  bind:this={ref}
  {...restProps}
>
  {@render children?.()}
</ul>
