<script lang="ts">
  import { AlertDialog as AlertDialogPrimitive } from "bits-ui";
  import { cn } from "$lib/utils.js";

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: AlertDialogPrimitive.OverlayProps = $props();
</script>

<AlertDialogPrimitive.Overlay
  class={cn("data-open:fade-in-0 data-closed:fade-out-0 fixed inset-0 z-50 bg-[var(--scrim)] duration-100 data-closed:animate-out data-open:animate-in supports-backdrop-filter:backdrop-blur-xs", className)}
  data-slot="alert-dialog-overlay"
  bind:ref
  {...restProps}
/>
