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

<div
  class={cn("gap-1 group/field-content flex flex-1 flex-col leading-snug", className)}
  data-slot="field-content"
  bind:this={ref}
  {...restProps}
>
  {@render children?.()}
</div>
