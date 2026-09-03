<script lang="ts">
  import { MoreHorizontalCircle01Icon } from "@hugeicons/core-free-icons";
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import type { HTMLAttributes } from "svelte/elements";
  import { cn, type WithElementRef, type WithoutChildren } from "$lib/utils.js";

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: WithoutChildren<
    WithElementRef<HTMLAttributes<HTMLSpanElement>>
  > = $props();
</script>

<span
  aria-hidden="true"
  class={cn("size-5 [&>svg]:size-4 flex items-center justify-center", className)}
  data-slot="breadcrumb-ellipsis"
  role="presentation"
  bind:this={ref}
  {...restProps}
>
  <HugeiconsIcon icon={MoreHorizontalCircle01Icon} strokeWidth={2} />
  <span class="sr-only">More</span>
</span>
