<script lang="ts">
  import type { HTMLAttributes } from "svelte/elements";
  import { cn, type WithElementRef, type WithoutChildren } from "$lib/utils.js";

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: WithoutChildren<WithElementRef<HTMLAttributes<HTMLDivElement>>> = $props();
</script>

<div
  class={cn("rounded-[var(--radius-control)] bg-muted animate-pulse", className)}
  data-slot="skeleton"
  bind:this={ref}
  {...restProps}
></div>
