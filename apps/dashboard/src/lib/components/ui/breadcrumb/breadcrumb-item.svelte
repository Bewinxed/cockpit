<script lang="ts">
  import type { HTMLLiAttributes } from "svelte/elements";
  import { cn, type WithElementRef } from "$lib/utils.js";

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLLiAttributes> = $props();
</script>

<li
  class={cn("inline-flex items-center gap-1.5", className)}
  data-slot="breadcrumb-item"
  bind:this={ref}
  {...restProps}
>
  {@render children?.()}
</li>
