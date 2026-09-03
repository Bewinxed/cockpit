<script lang="ts">
  import type { HTMLOlAttributes } from "svelte/elements";
  import { cn, type WithElementRef } from "$lib/utils.js";

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLOlAttributes> = $props();
</script>

<ol
  class={cn("wrap-break-word flex flex-wrap items-center gap-1.5 text-muted-foreground text-sm sm:gap-2.5", className)}
  data-slot="breadcrumb-list"
  bind:this={ref}
  {...restProps}
>
  {@render children?.()}
</ol>
