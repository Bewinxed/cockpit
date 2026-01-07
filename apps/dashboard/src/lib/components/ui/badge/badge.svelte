<script lang="ts" module>
	import { type VariantProps, tv } from "tailwind-variants";

	export const badgeVariants = tv({
		base: "inline-flex w-fit shrink-0 items-center justify-center gap-1.5 overflow-hidden rounded-sm border-none px-2 py-0.5 text-xs font-medium whitespace-nowrap [&>svg]:pointer-events-none [&>svg]:size-3",
		variants: {
			variant: {
				default: "bg-primary-light text-text",
				secondary: "bg-surface-hover text-text-secondary",
				success: "bg-success-light text-success",
				warning: "bg-warning-light text-warning",
				error: "bg-error-light text-error",
				info: "bg-info-light text-info",
				destructive: "bg-error-light text-error",
				outline: "bg-transparent border border-border text-text-secondary",
			},
		},
		defaultVariants: {
			variant: "default",
		},
	});

	export type BadgeVariant = VariantProps<typeof badgeVariants>["variant"];
</script>

<script lang="ts">
	import type { HTMLAnchorAttributes } from "svelte/elements";
	import { cn, type WithElementRef } from "$lib/utils.js";

	export type BadgeProps = WithElementRef<HTMLAnchorAttributes> & {
		variant?: BadgeVariant;
	};

	let {
		ref = $bindable(null),
		href,
		class: className,
		variant = "default",
		children,
		...restProps
	}: BadgeProps = $props();
</script>

<svelte:element
	this={href ? "a" : "span"}
	bind:this={ref}
	data-slot="badge"
	{href}
	class={cn(badgeVariants({ variant }), className)}
	{...restProps}
>
	{@render children?.()}
</svelte:element>
