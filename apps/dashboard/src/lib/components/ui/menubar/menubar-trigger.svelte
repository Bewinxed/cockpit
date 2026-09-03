<script lang="ts">
  import { Menubar as MenubarPrimitive } from "bits-ui";
  import { cn } from "$lib/utils.js";

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: MenubarPrimitive.TriggerProps = $props();
</script>

<MenubarPrimitive.Trigger
  class={cn("rounded-[var(--radius-control)] px-2 py-0.75 text-sm font-medium hover:bg-muted aria-expanded:bg-muted flex items-center outline-hidden select-none", className)}
  data-slot="menubar-trigger"
  bind:ref
  {...restProps}
/>
