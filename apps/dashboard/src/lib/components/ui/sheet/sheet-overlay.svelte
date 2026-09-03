<script lang="ts">
  import { Dialog as SheetPrimitive } from "bits-ui";
  import { cn } from "$lib/utils.js";

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: SheetPrimitive.OverlayProps = $props();
</script>

<SheetPrimitive.Overlay
  class={cn("bg-[var(--scrim)] supports-backdrop-filter:backdrop-blur-xs fixed inset-0 z-50", className)}
  data-slot="sheet-overlay"
  bind:ref
  {...restProps}
/>
