<script lang="ts">
  import type { Separator as SeparatorPrimitive } from "bits-ui";
  import { Separator } from "$lib/components/ui/separator/index.js";
  import { cn } from "$lib/utils.js";

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: SeparatorPrimitive.RootProps = $props();
</script>

<Separator
  class={cn("-mx-1 my-1 h-px bg-border/50 pointer-events-none", className)}
  data-slot="select-separator"
  bind:ref
  {...restProps}
/>
