<script lang="ts">

	import { IconSuccess, IconInfo, IconSpinner, IconError, IconWarningTriangle } from "$lib/icons";
	import { Toaster as Sonner, type ToasterProps as SonnerProps } from "svelte-sonner";
	import { mode } from "mode-watcher";

	let { ...restProps }: SonnerProps = $props();
</script>

<Sonner
	theme={mode.current}
	class="toaster group"
	style="--normal-bg: var(--color-popover); --normal-text: var(--color-popover-foreground); --normal-border: var(--color-border);"
	{...restProps}
	>{#snippet loadingIcon()}
		<IconSpinner class="size-4 animate-spin" />
	{/snippet}
	{#snippet successIcon()}
		<IconSuccess class="size-4" />
	{/snippet}
	{#snippet errorIcon()}
		<IconError class="size-4" />
	{/snippet}
	{#snippet infoIcon()}
		<IconInfo class="size-4" />
	{/snippet}
	{#snippet warningIcon()}
		<IconWarningTriangle class="size-4" />
	{/snippet}
</Sonner>
