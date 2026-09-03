<script lang="ts">
  import { Accordion as AccordionPrimitive } from "bits-ui";
  import { cn } from "$lib/utils.js";

  let {
    ref = $bindable(null),
    value = $bindable(),
    class: className,
    ...restProps
  }: AccordionPrimitive.RootProps = $props();
</script>

<AccordionPrimitive.Root
  class={cn("flex w-full flex-col overflow-hidden rounded-[var(--radius-card)] border", className)}
  data-slot="accordion"
  bind:ref
  bind:value={value as never}
  {...restProps}
/>
