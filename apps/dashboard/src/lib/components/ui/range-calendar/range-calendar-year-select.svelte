<script lang="ts">
  import { ArrowDownIcon } from "@hugeicons/core-free-icons";
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import { RangeCalendar as RangeCalendarPrimitive } from "bits-ui";
  import { cn, type WithoutChildrenOrChild } from "$lib/utils.js";

  let {
    ref = $bindable(null),
    class: className,
    value,
    ...restProps
  }: WithoutChildrenOrChild<RangeCalendarPrimitive.YearSelectProps> = $props();
</script>

<span
  class={cn(
		"relative flex rounded-[var(--radius-control)] border border-input shadow-xs has-focus:border-ring has-focus:ring-[3px] has-focus:ring-ring/50",
		className
	)}
>
  <RangeCalendarPrimitive.YearSelect
    class="absolute inset-0 opacity-0"
    bind:ref
    {...restProps}
  >
    {#snippet child({ props, yearItems, selectedYearItem })}
      <select {...props} {value}>
        {#each yearItems as yearItem (yearItem.value)}
          <option
            selected={value === undefined
							? yearItem.value === selectedYearItem.value
							: yearItem.value === value}
            value={yearItem.value}
          >
            {yearItem.label}
          </option>
        {/each}
      </select>
      <span
        aria-hidden="true"
        class="flex h-(--cell-size) items-center gap-1 rounded-[var(--radius-control)] ps-2 pe-1 text-sm font-medium select-none [&>svg]:size-3.5 [&>svg]:text-muted-foreground"
      >
        {yearItems.find((item) => item.value === value)?.label || selectedYearItem.label}
        <HugeiconsIcon
          class={cn("size-4", className)}
          icon={ArrowDownIcon}
          strokeWidth={2}
        />
      </span>
    {/snippet}
  </RangeCalendarPrimitive.YearSelect>
</span>
