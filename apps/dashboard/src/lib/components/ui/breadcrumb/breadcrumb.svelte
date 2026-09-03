<script lang="ts">
  import type { HTMLAttributes } from "svelte/elements";
  import type { WithElementRef } from "$lib/utils.js";
  import { cn } from "$lib/utils.js";

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLElement>> = $props();
</script>

<nav
  aria-label="breadcrumb"
  class={cn("cn-breadcrumb", className)}
  data-slot="breadcrumb"
  bind:this={ref}
  {...restProps}
>
  {@render children?.()}
</nav>
