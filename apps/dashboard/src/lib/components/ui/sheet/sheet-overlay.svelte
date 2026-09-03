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
  class={cn("fixed inset-0 z-50 bg-[var(--scrim)] supports-backdrop-filter:backdrop-blur-xs", className)}
  data-slot="sheet-overlay"
  bind:ref
  {...restProps}
/>
