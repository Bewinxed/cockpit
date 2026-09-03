<script lang="ts">
  import { Accordion as AccordionPrimitive } from "bits-ui";
  import { cn } from "$lib/utils.js";

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: AccordionPrimitive.ItemProps = $props();
</script>

<AccordionPrimitive.Item
  class={cn("not-last:border-b data-open:bg-muted/50", className)}
  data-slot="accordion-item"
  bind:ref
  {...restProps}
/>
