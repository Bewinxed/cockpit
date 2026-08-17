<script lang="ts">
	import * as Sheet from "$lib/components/ui/sheet/index.js";
	import { cn, type WithElementRef } from "$lib/utils.js";
	import { SIDEBAR_WIDTH_MOBILE } from "./constants.js";
	import { useSidebar } from "./context.svelte.js";
	import type { HTMLAttributes } from "svelte/elements";

	let {
		ref = $bindable(null),
		side = "left",
		variant = "sidebar",
		collapsible = "offcanvas",
		class: className,
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> & {
		side?: "left" | "right";
		variant?: "sidebar" | "floating" | "inset";
		collapsible?: "offcanvas" | "icon" | "none";
	} = $props();

	const sidebar = useSidebar();

	/** The sidebar's target inline-size: full width when expanded, zero
	 *  (offcanvas) or icon-width (icon) when collapsed. Drives the
	 *  single CSS transition — no gap div, no absolute positioning. */
	const inlineSize = $derived(
		sidebar.state === "expanded"
			? "var(--sidebar-width)"
			: collapsible === "icon"
				? variant === "floating" || variant === "inset"
					? "calc(var(--sidebar-width-icon) + var(--spacing) * 4 + 2px)"
					: "var(--sidebar-width-icon)"
				: "0px"
	);
</script>

{#if collapsible === "none"}
	<div
		class={cn(
			"flex h-full w-(--sidebar-width) flex-col bg-sidebar text-sidebar-foreground",
			className
		)}
		bind:this={ref}
		{...restProps}
	>
		{@render children?.()}
	</div>
{:else if sidebar.isMobile}
	<Sheet.Root bind:open={() => sidebar.openMobile, (v) => sidebar.setOpenMobile(v)} {...restProps}>
		<Sheet.Content
			bind:ref
			data-sidebar="sidebar"
			data-slot="sidebar"
			data-mobile="true"
			class={cn(
				"w-(--sidebar-width) bg-sidebar p-0 text-sidebar-foreground [&>button]:hidden",
				className
			)}
			style="--sidebar-width: {SIDEBAR_WIDTH_MOBILE};"
			{side}
		>
			<Sheet.Header class="sr-only">
				<Sheet.Title>Sidebar</Sheet.Title>
				<Sheet.Description>Displays the mobile sidebar.</Sheet.Description>
			</Sheet.Header>
			<div class="flex h-full w-full flex-col">
				{@render children?.()}
			</div>
		</Sheet.Content>
	</Sheet.Root>
{:else}
	<!-- Desktop: a single flow element that transitions its own inline-size.
	     No gap spacer, no absolute/fixed positioning — the sidebar participates
	     in the parent flex layout directly. Collapsed content is clipped by
	     overflow-hidden; the inner div keeps full sidebar width so the content
	     is always laid out and never remeasured on open. -->
	<div
		bind:this={ref}
		class={cn(
			"group peer hidden overflow-hidden text-sidebar-foreground",
			"md:flex md:flex-col",
			"transition-[inline-size] duration-200 ease-linear motion-reduce:transition-none",
			side === "left" && "-order-1",
		)}
		style:inline-size={inlineSize}
		data-state={sidebar.state}
		data-collapsible={sidebar.state === "collapsed" ? collapsible : ""}
		data-variant={variant}
		data-side={side}
		data-slot="sidebar"
	>
		<div
			data-sidebar="sidebar"
			data-slot="sidebar-inner"
			class={cn(
				"flex h-full min-h-0 flex-col bg-sidebar",
				"min-w-(--sidebar-width)",
				variant === "floating" || variant === "inset"
					? "m-2 rounded-lg shadow-sm ring-1 ring-sidebar-border"
					: side === "left" ? "border-e" : "border-s",
				className,
			)}
			{...restProps}
		>
			{@render children?.()}
		</div>
	</div>
{/if}
