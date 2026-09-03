<script lang="ts">
  import { Calendar as CalendarPrimitive } from "bits-ui";
  import { cn } from "$lib/utils.js";

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: CalendarPrimitive.HeadingProps = $props();
</script>

<CalendarPrimitive.Heading
  class={cn("px-(--cell-size) font-medium text-sm", className)}
  bind:ref
  {...restProps}
/>
