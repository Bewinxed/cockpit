<script lang="ts">
  import type { HTMLTdAttributes } from "svelte/elements";
  import { cn, type WithElementRef } from "$lib/utils.js";

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLTdAttributes> = $props();
</script>

<td
  class={cn("p-3 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0", className)}
  data-slot="table-cell"
  bind:this={ref}
  {...restProps}
>
  {@render children?.()}
</td>
