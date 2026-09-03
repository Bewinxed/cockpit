<script lang="ts">
  import { LinkPreview as HoverCardPrimitive } from "bits-ui";
  import type { ComponentProps } from "svelte";
  import { cn, type WithoutChildrenOrChild } from "$lib/utils.js";
  import HoverCardPortal from "./hover-card-portal.svelte";

  let {
    ref = $bindable(null),
    class: className,
    align = "center",
    sideOffset = 4,
    portalProps,
    ...restProps
  }: HoverCardPrimitive.ContentProps & {
    portalProps?: WithoutChildrenOrChild<
      ComponentProps<typeof HoverCardPortal>
    >;
  } = $props();
</script>

<HoverCardPortal {...portalProps}>
  <HoverCardPrimitive.Content
    {align}
    class={cn("data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:fade-in-0 data-open:zoom-in-95 data-closed:fade-out-0 data-closed:zoom-out-95 z-50 w-72 origin-(--transform-origin) rounded-[var(--radius-panel)] bg-popover p-4 text-popover-foreground text-sm shadow-2xl outline-hidden ring-1 ring-foreground/5 duration-100 data-closed:animate-out data-open:animate-in", className)}
    data-slot="hover-card-content"
    {sideOffset}
    bind:ref
    {...restProps}
  />
</HoverCardPortal>
