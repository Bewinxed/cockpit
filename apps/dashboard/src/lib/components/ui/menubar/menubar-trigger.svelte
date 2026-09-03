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
  class={cn("flex select-none items-center rounded-[var(--radius-control)] px-2 py-0.75 font-medium text-sm outline-hidden hover:bg-muted aria-expanded:bg-muted", className)}
  data-slot="menubar-trigger"
  bind:ref
  {...restProps}
/>
