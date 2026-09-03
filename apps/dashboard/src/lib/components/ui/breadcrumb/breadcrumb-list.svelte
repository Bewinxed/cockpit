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
  class={cn("gap-1.5 text-sm text-muted-foreground sm:gap-2.5 flex flex-wrap items-center wrap-break-word", className)}
  data-slot="breadcrumb-list"
  bind:this={ref}
  {...restProps}
>
  {@render children?.()}
</ol>
