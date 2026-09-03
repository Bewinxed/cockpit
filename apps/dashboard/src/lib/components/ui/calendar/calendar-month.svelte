<script lang="ts">
  import type { HTMLAttributes } from "svelte/elements";
  import { cn, type WithElementRef } from "$lib/utils.js";

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLElement>> = $props();
</script>

<div
  {...restProps}
  class={cn("flex w-full flex-col gap-4", className)}
  bind:this={ref}
>
  {@render children?.()}
</div>
