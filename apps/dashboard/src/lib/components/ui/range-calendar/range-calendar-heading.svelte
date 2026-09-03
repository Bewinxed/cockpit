<script lang="ts">
  import { RangeCalendar as RangeCalendarPrimitive } from "bits-ui";
  import { cn } from "$lib/utils.js";

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: RangeCalendarPrimitive.HeadingProps = $props();
</script>

<RangeCalendarPrimitive.Heading
  class={cn("px-(--cell-size) font-medium text-sm", className)}
  bind:ref
  {...restProps}
/>
