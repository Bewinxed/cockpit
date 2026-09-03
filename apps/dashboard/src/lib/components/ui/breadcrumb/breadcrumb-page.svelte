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
  aria-current="page"
  aria-disabled="true"
  class={cn("font-normal text-foreground", className)}
  data-slot="breadcrumb-page"
  role="link"
  bind:this={ref}
  {...restProps}
>
  {@render children?.()}
</span>
