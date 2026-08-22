<script lang="ts">
	import { HugeiconsIcon } from "@hugeicons/svelte"
	import { UnfoldMoreIcon } from '@hugeicons/core-free-icons';
	import { cn, type WithElementRef } from "$lib/utils.js";
	import type { HTMLSelectAttributes } from "svelte/elements";

	type NativeSelectProps = Omit<WithElementRef<HTMLSelectAttributes>, "size"> & {
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
	data-slot="native-select-wrapper"
	data-size={size}
>
	<select
		bind:value
		bind:this={ref}
		data-slot="native-select"
		data-size={size}
		class="h-9 w-full min-w-0 appearance-none rounded-[var(--radius-control)] border border-input bg-input/30 py-1 pr-8 pl-3 text-sm transition-colors select-none selection:bg-primary selection:text-primary-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-[3px] aria-invalid:ring-destructive/20 data-[size=sm]:h-8 dark:bg-input/30 dark:hover:bg-input/50 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 outline-none disabled:pointer-events-none disabled:cursor-not-allowed"
		{...restProps}
	>
		{@render children?.()}
	</select>
	<HugeiconsIcon icon={UnfoldMoreIcon} strokeWidth={2} class="top-1/2 right-3.5 size-4 -translate-y-1/2 text-muted-foreground pointer-events-none absolute select-none" aria-hidden data-slot="native-select-icon" />
</div>
