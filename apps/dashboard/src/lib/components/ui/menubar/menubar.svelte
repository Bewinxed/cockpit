<script lang="ts">
  import { Menubar as MenubarPrimitive } from "bits-ui";
  import { cn } from "$lib/utils.js";

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: MenubarPrimitive.RootProps = $props();
</script>

<MenubarPrimitive.Root
  class={cn("flex h-9 items-center rounded-[var(--radius-control)] border p-1", className)}
  data-slot="menubar"
  bind:ref
  {...restProps}
/>
