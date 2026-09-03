<script lang="ts">
  import { ArrowUp01Icon } from "@hugeicons/core-free-icons";
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import { Select as SelectPrimitive } from "bits-ui";
  import { cn, type WithoutChildrenOrChild } from "$lib/utils.js";

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: WithoutChildrenOrChild<SelectPrimitive.ScrollUpButtonProps> = $props();
</script>

<SelectPrimitive.ScrollUpButton
  class={cn("z-10 flex cursor-default items-center justify-center bg-popover py-1 [&_svg:not([class*='size-'])]:size-4 top-0 w-full", className)}
  data-slot="select-scroll-up-button"
  bind:ref
  {...restProps}
>
  <HugeiconsIcon icon={ArrowUp01Icon} strokeWidth={2} />
</SelectPrimitive.ScrollUpButton>
