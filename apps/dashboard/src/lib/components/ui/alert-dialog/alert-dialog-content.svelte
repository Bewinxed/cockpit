<script lang="ts">
  import { AlertDialog as AlertDialogPrimitive } from "bits-ui";
  import type { ComponentProps } from "svelte";
  import {
    cn,
    type WithoutChild,
    type WithoutChildrenOrChild,
  } from "$lib/utils.js";
  import AlertDialogOverlay from "./alert-dialog-overlay.svelte";
  import AlertDialogPortal from "./alert-dialog-portal.svelte";

  let {
    ref = $bindable(null),
    class: className,
    size = "default",
    portalProps,
    ...restProps
  }: WithoutChild<AlertDialogPrimitive.ContentProps> & {
    size?: "default" | "sm";
    portalProps?: WithoutChildrenOrChild<
      ComponentProps<typeof AlertDialogPortal>
    >;
  } = $props();
</script>

<AlertDialogPortal {...portalProps}>
  <AlertDialogOverlay />
  <AlertDialogPrimitive.Content
    class={cn(
			"data-open:fade-in-0 data-open:zoom-in-95 data-closed:fade-out-0 data-closed:zoom-out-95 group/alert-dialog-content fixed top-1/2 left-1/2 z-50 grid w-full -translate-x-1/2 -translate-y-1/2 gap-6 rounded-[var(--radius-shell)] bg-popover p-6 text-popover-foreground outline-none ring-1 ring-foreground/5 duration-100 data-[size=default]:max-w-xs data-[size=sm]:max-w-xs data-closed:animate-out data-open:animate-in data-[size=default]:sm:max-w-md",
			className
		)}
    data-size={size}
    data-slot="alert-dialog-content"
    bind:ref
    {...restProps}
  />
</AlertDialogPortal>
