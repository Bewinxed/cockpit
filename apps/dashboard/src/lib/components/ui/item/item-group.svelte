<script lang="ts">
  import type { HTMLAttributes } from "svelte/elements";
  import { cn, type WithElementRef } from "$lib/utils.js";

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLDivElement>> = $props();
</script>

<!-- biome-ignore lint/a11y/useSemanticElements: <ul>/<ol> impose default list-style/margin this component resets everywhere it's used; the div + role="list" combo keeps the a11y semantics without the visual reset -->
<div
  class={cn("group/item-group flex w-full flex-col gap-4 has-data-[size=sm]:gap-2.5 has-data-[size=xs]:gap-2", className)}
  data-slot="item-group"
  role="list"
  bind:this={ref}
  {...restProps}
>
  {@render children?.()}
</div>
