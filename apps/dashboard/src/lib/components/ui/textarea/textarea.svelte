<script lang="ts">
  import type { HTMLTextareaAttributes } from "svelte/elements";
  import { cn, type WithElementRef, type WithoutChildren } from "$lib/utils.js";

  let {
    ref = $bindable(null),
    value = $bindable(),
    class: className,
    "data-slot": dataSlot = "textarea",
    ...restProps
  }: WithoutChildren<WithElementRef<HTMLTextareaAttributes>> = $props();
</script>

<textarea
  class={cn(
		"field-sizing-content flex min-h-16 w-full resize-none rounded-[var(--radius-control)] border border-[var(--border-control)] bg-[var(--surface-raised)] px-3 py-3 text-[var(--ink-strong)] text-base outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-[3px] aria-invalid:ring-destructive/20 md:text-sm dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
		className
	)}
  data-slot={dataSlot}
  bind:this={ref}
  bind:value
  {...restProps}
></textarea>
