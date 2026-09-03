<script lang="ts">
  import type { WithElementRef } from "bits-ui";
  import type { HTMLAttributes } from "svelte/elements";
  import { cn } from "$lib/utils.js";

  let {
    ref = $bindable(null),
    inset,
    children,
    class: className,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLElement>> & {
    inset?: boolean;
  } = $props();
</script>

<div
  class={cn("px-3.5 py-2.5 text-muted-foreground text-xs data-inset:pl-9.5", className)}
  data-inset={inset}
  data-slot="menubar-label"
  bind:this={ref}
  {...restProps}
>
  {@render children?.()}
</div>
