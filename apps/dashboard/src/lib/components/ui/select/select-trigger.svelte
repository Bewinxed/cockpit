<script lang="ts">
  import { UnfoldMoreIcon } from "@hugeicons/core-free-icons";
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import { Select as SelectPrimitive } from "bits-ui";
  import { cn, type WithoutChild } from "$lib/utils.js";

  let {
    ref = $bindable(null),
    class: className,
    children,
    size = "default",
    ...restProps
  }: WithoutChild<SelectPrimitive.TriggerProps> & {
    size?: "sm" | "default";
  } = $props();
</script>

<SelectPrimitive.Trigger
  class={cn(
		"flex w-fit items-center justify-between gap-1.5 whitespace-nowrap rounded-[var(--radius-control)] border border-[var(--border-control)] bg-[var(--surface-raised)] px-3 py-2 text-[var(--ink-strong)] text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-[3px] aria-invalid:ring-destructive/20 data-[size=default]:h-[var(--c-nav-h)] data-[size=sm]:h-8 data-placeholder:text-muted-foreground *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-1.5 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 dark:hover:bg-input/50 [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
		className
	)}
  data-size={size}
  data-slot="select-trigger"
  bind:ref
  {...restProps}
>
  {@render children?.()}
  <HugeiconsIcon
    class="size-4 text-muted-foreground pointer-events-none"
    icon={UnfoldMoreIcon}
    strokeWidth={2}
  />
</SelectPrimitive.Trigger>
