<script lang="ts">
	import { Collapsible as CollapsiblePrimitive } from "bits-ui";
	import type { Snippet } from "svelte";
	import { cn, type WithoutChild } from "$lib/utils.js";
	import CollapsibleLazy from "./collapsible-lazy.svelte";

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithoutChild<CollapsiblePrimitive.ContentProps> & { children?: Snippet } = $props();
</script>

<CollapsiblePrimitive.Content
	bind:ref
	data-slot="collapsible-content"
	forceMount={true}
	{...restProps}
>
	{#snippet child({ props, open })}
		<!-- Kept mounted so the close animation can run, so closed content must be
		     inert: otherwise its buttons linger invisibly in the tab order. -->
		<div
			{...props}
			class={cn(
				"overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=closed]:fill-mode-forwards data-[state=open]:animate-collapsible-down",
				className
			)}
			data-state={open ? "open" : "closed"}
			inert={!open}
		>
			<CollapsibleLazy {open} {children} />
		</div>
	{/snippet}
</CollapsiblePrimitive.Content>
