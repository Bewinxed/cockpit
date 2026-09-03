<script lang="ts" module>
  import { tv } from "tailwind-variants";
  import { cn } from "$lib/utils.js";

  export const navigationMenuTriggerStyle = tv({
    base: "group/navigation-menu-trigger inline-flex h-9 w-max items-center justify-center rounded-[var(--radius-control)] px-4.5 py-2.5 font-medium text-sm outline-none transition-all hover:bg-muted focus:bg-muted focus-visible:outline-1 focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 data-open:bg-muted/50 data-popup-open:bg-muted/50 data-open:focus:bg-muted data-open:hover:bg-muted data-popup-open:hover:bg-muted",
  });
</script>

<script lang="ts">
  import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import { NavigationMenu as NavigationMenuPrimitive } from "bits-ui";

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: NavigationMenuPrimitive.TriggerProps = $props();
</script>

<NavigationMenuPrimitive.Trigger
  class={cn(navigationMenuTriggerStyle(), "group", className)}
  data-slot="navigation-menu-trigger"
  bind:ref
  {...restProps}
>
  {@render children?.()}
  <HugeiconsIcon
    aria-hidden="true"
    class="relative top-px ml-1 size-3 transition duration-300 group-data-popup-open/navigation-menu-trigger:rotate-180 group-data-open/navigation-menu-trigger:rotate-180"
    icon={ArrowDown01Icon}
    strokeWidth={2}
  />
</NavigationMenuPrimitive.Trigger>
