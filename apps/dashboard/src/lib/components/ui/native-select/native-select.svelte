<script lang="ts">
  import { UnfoldMoreIcon } from "@hugeicons/core-free-icons";
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import type { HTMLSelectAttributes } from "svelte/elements";
  import { cn, type WithElementRef } from "$lib/utils.js";

  type NativeSelectProps = Omit<
    WithElementRef<HTMLSelectAttributes>,
    "size"
  > & {
    size?: "sm" | "default";
  };

  let {
    ref = $bindable(null),
    value = $bindable(),
    class: className,
    size = "default",
    children,
    ...restProps
  }: NativeSelectProps = $props();
</script>

<div
  class={cn(
		"cn-native-select-wrapper group/native-select relative w-fit has-[select:disabled]:opacity-50",
		className
	)}
  data-size={size}
  data-slot="native-select-wrapper"
>
  <select
    class="h-[var(--c-nav-h)] w-full min-w-0 appearance-none rounded-[var(--radius-control)] border border-[var(--border-control)] bg-[var(--surface-raised)] text-[var(--ink-strong)] py-1 pr-8 pl-3 text-sm transition-colors select-none selection:bg-primary selection:text-primary-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-[3px] aria-invalid:ring-destructive/20 data-[size=sm]:h-8 dark:bg-input/30 dark:hover:bg-input/50 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 outline-none disabled:pointer-events-none disabled:cursor-not-allowed"
    data-size={size}
    data-slot="native-select"
    bind:this={ref}
    bind:value
    {...restProps}
  >
    {@render children?.()}
  </select>
  <HugeiconsIcon
    aria-hidden
    class="top-1/2 right-3.5 size-4 -translate-y-1/2 text-muted-foreground pointer-events-none absolute select-none"
    data-slot="native-select-icon"
    icon={UnfoldMoreIcon}
    strokeWidth={2}
  />
</div>
