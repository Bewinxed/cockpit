<script lang="ts">
  import { Description, type DescriptionProps } from "formsnap";
  import { cn, type WithoutChild } from "$lib/utils.js";

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: WithoutChild<DescriptionProps> = $props();
</script>

<Description
  class={cn("text-muted-foreground text-sm", className)}
  data-slot="form-description"
  bind:ref
  {...restProps}
/>
