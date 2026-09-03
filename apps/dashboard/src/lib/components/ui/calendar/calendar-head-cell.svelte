<script lang="ts">
  import { Calendar as CalendarPrimitive } from "bits-ui";
  import { cn } from "$lib/utils.js";

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: CalendarPrimitive.HeadCellProps = $props();
</script>

<CalendarPrimitive.HeadCell
  class={cn(
		"w-(--cell-size) rounded-[var(--radius-tile)] text-[0.8rem] font-normal text-muted-foreground",
		className
	)}
  bind:ref
  {...restProps}
/>
