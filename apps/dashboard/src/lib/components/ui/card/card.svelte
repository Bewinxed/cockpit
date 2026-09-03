<script lang="ts">
  import type { HTMLAttributes } from "svelte/elements";
  import { cn, type WithElementRef } from "$lib/utils.js";

  let {
    ref = $bindable(null),
    class: className,
    children,
    size = "default",
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLDivElement>> & {
    size?: "default" | "sm";
  } = $props();
</script>

<div
  class={cn("group/card flex flex-col gap-(--card-spacing) overflow-hidden rounded-[var(--radius-card)] bg-card py-(--card-spacing) text-card-foreground text-sm ring-1 ring-foreground/10 [--card-spacing:--spacing(6)] has-[>img:first-child]:pt-0 data-[size=sm]:[--card-spacing:--spacing(4)] *:[img:first-child]:rounded-t-[var(--radius-card)] *:[img:last-child]:rounded-b-[var(--radius-card)]", className)}
  data-size={size}
  data-slot="card"
  bind:this={ref}
  {...restProps}
>
  {@render children?.()}
</div>
