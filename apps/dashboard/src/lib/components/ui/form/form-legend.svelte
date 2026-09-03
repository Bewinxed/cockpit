<script lang="ts">
  import { Legend, type LegendProps } from "formsnap";
  import { cn, type WithoutChild } from "$lib/utils.js";

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: WithoutChild<LegendProps> = $props();
</script>

<Legend
  class={cn("font-medium text-sm leading-none data-[fs-error]:text-destructive", className)}
  bind:ref
  {...restProps}
/>
