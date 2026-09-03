<script lang="ts">
  import { NavigationMenu as NavigationMenuPrimitive } from "bits-ui";
  import { cn } from "$lib/utils.js";

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: NavigationMenuPrimitive.ViewportProps = $props();
</script>

<div class={cn("absolute start-0 top-full isolate z-50 flex justify-center")}>
  <NavigationMenuPrimitive.Viewport
    class={cn(
			"data-open:zoom-in-90 data-closed:zoom-out-90 relative mt-1.5 h-[calc(var(--bits-navigation-menu-viewport-height)+1rem)] w-full origin-top-center overflow-hidden rounded-[var(--radius-panel)] bg-popover text-popover-foreground shadow-2xl ring-1 ring-foreground/5 duration-100 data-closed:animate-out data-open:animate-in md:w-[calc(var(--bits-navigation-menu-viewport-width)+1rem)]",
			className
		)}
    data-slot="navigation-menu-viewport"
    bind:ref
    {...restProps}
  />
</div>
