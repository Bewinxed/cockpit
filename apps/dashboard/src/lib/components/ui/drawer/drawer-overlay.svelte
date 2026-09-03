<script lang="ts">
  import { Drawer as DrawerPrimitive } from "vaul-svelte";
  import { cn } from "$lib/utils.js";

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: DrawerPrimitive.OverlayProps = $props();
</script>

<DrawerPrimitive.Overlay
  class={cn("data-open:fade-in-0 data-closed:fade-out-0 fixed inset-0 z-50 bg-[var(--scrim)] data-closed:animate-out data-open:animate-in supports-backdrop-filter:backdrop-blur-xs", className)}
  data-slot="drawer-overlay"
  bind:ref
  {...restProps}
/>
