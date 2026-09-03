<script lang="ts">
  import { NavigationMenu as NavigationMenuPrimitive } from "bits-ui";
  import { cn } from "$lib/utils.js";

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: NavigationMenuPrimitive.ListProps = $props();
</script>

<NavigationMenuPrimitive.List
  class={cn(
		"gap-0 group flex flex-1 list-none items-center justify-center",
		className
	)}
  data-slot="navigation-menu-list"
  bind:ref
  {...restProps}
/>
