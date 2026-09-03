<script lang="ts">
  import { NavigationMenu as NavigationMenuPrimitive } from "bits-ui";
  import { cn } from "$lib/utils.js";

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: NavigationMenuPrimitive.LinkProps = $props();
</script>

<NavigationMenuPrimitive.Link
  class={cn("flex items-center gap-1.5 in-data-[slot=navigation-menu-content]:rounded-[var(--radius-mark)] rounded-[var(--radius-control)] p-3 text-sm outline-none transition-all hover:bg-muted focus:bg-muted focus-visible:outline-1 focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[active=true]:bg-muted/50 data-[active=true]:focus:bg-muted data-[active=true]:hover:bg-muted [&_svg:not([class*='size-'])]:size-4", className)}
  data-slot="navigation-menu-link"
  bind:ref
  {...restProps}
/>
