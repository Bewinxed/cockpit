<script lang="ts" module>
	import { getContext, setContext } from "svelte";
	import type { VariantProps } from "tailwind-variants";
	import { toggleVariants } from "$lib/components/ui/toggle/index.js";

	type ToggleVariants = VariantProps<typeof toggleVariants>;

	interface ToggleGroupContext extends ToggleVariants {
		spacing?: number;
	}

	export function setToggleGroupCtx(props: ToggleGroupContext) {
		setContext("toggleGroup", props);
	}

	export function getToggleGroupCtx() {
		return getContext<Required<ToggleGroupContext>>("toggleGroup");
	}
</script>

<script lang="ts">
	import { ToggleGroup as ToggleGroupPrimitive } from "bits-ui";
	import { cn } from "$lib/utils.js";

	let {
		ref = $bindable(null),
		value = $bindable(),
		class: className,
		size = "default",
		spacing = 0,
		variant = "default",
		...restProps
	}: ToggleGroupPrimitive.RootProps & ToggleVariants & { spacing?: number } = $props();

	// Capture initial values to avoid state_referenced_locally warnings
	// Context is set once at initialization and doesn't need to be reactive
	// svelte-ignore state_referenced_locally
	const _variant = variant;
	// svelte-ignore state_referenced_locally
	const _size = size;
	// svelte-ignore state_referenced_locally
	const _spacing = spacing;

	setToggleGroupCtx({
		variant: _variant,
		size: _size,
		spacing: _spacing,
	});
</script>

<!--
Discriminated Unions + Destructing (required for bindable) do not
get along, so we shut typescript up by casting `value` to `never`.
-->
<ToggleGroupPrimitive.Root
	bind:value={value as never}
	bind:ref
	data-slot="toggle-group"
	data-variant={variant}
	data-size={size}
	data-spacing={spacing}
	style={`--gap: ${spacing}`}
	class={cn(
		"group/toggle-group flex w-fit items-center gap-[--spacing(var(--gap))] rounded-md data-[spacing=default]:data-[variant=outline]:shadow-xs",
		className
	)}
	{...restProps}
/>
