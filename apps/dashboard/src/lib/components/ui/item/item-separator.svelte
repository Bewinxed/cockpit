<script lang="ts">
  import type { ComponentProps } from "svelte";
  import { Separator } from "$lib/components/ui/separator/index.js";
  import { cn } from "$lib/utils.js";

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: ComponentProps<typeof Separator> = $props();
</script>

<Separator
  class={cn("my-2", className)}
  data-slot="item-separator"
  orientation="horizontal"
  bind:ref
  {...restProps}
/>
