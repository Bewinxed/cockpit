<script lang="ts">
  import { type DateValue, isEqualMonth } from "@internationalized/date";
  import { RangeCalendar as RangeCalendarPrimitive } from "bits-ui";
  import type { Snippet } from "svelte";
  import type { ButtonVariant } from "$lib/components/ui/button/index.js";
  import { cn, type WithoutChildrenOrChild } from "$lib/utils.js";
  // biome-ignore lint/performance/noNamespaceImport: shadcn-svelte convention for component groups — the sub-components below are addressed via RangeCalendar.X
  import * as RangeCalendar from "./index.js";

  let {
    ref = $bindable(null),
    value = $bindable(),
    placeholder = $bindable(),
    weekdayFormat = "short",
    class: className,
    buttonVariant = "ghost",
    captionLayout = "label",
    locale = "en-US",
    months: monthsProp,
    years,
    monthFormat: monthFormatProp,
    yearFormat = "numeric",
    day,
    disableDaysOutsideMonth = false,
    ...restProps
  }: WithoutChildrenOrChild<RangeCalendarPrimitive.RootProps> & {
    buttonVariant?: ButtonVariant;
    captionLayout?: "dropdown" | "dropdown-months" | "dropdown-years" | "label";
    months?: RangeCalendarPrimitive.MonthSelectProps["months"];
    years?: RangeCalendarPrimitive.YearSelectProps["years"];
    monthFormat?: RangeCalendarPrimitive.MonthSelectProps["monthFormat"];
    yearFormat?: RangeCalendarPrimitive.YearSelectProps["yearFormat"];
    day?: Snippet<[{ day: DateValue; outsideMonth: boolean }]>;
  } = $props();

  const monthFormat = $derived.by(() => {
    if (monthFormatProp) {
      return monthFormatProp;
    }
    if (captionLayout.startsWith("dropdown")) {
      return "short";
    }
    return "long";
  });
</script>

<RangeCalendarPrimitive.Root
  class={cn(
		"group/calendar bg-background p-3 p-3 [--cell-radius:var(--radius-pill)] [--cell-size:--spacing(8)] [[data-slot=card-content]_&]:bg-transparent [[data-slot=popover-content]_&]:bg-transparent",
		className
	)}
  {disableDaysOutsideMonth}
  {locale}
  {monthFormat}
  {weekdayFormat}
  {yearFormat}
  bind:placeholder
  bind:ref
  bind:value
  {...restProps}
>
  {#snippet children({ months, weekdays })}
    <RangeCalendar.Months>
      <RangeCalendar.Nav>
        <RangeCalendar.PrevButton variant={buttonVariant} />
        <RangeCalendar.NextButton variant={buttonVariant} />
      </RangeCalendar.Nav>
      {#each months as month, monthIndex (month)}
        <RangeCalendar.Month>
          <RangeCalendar.Header>
            <RangeCalendar.Caption
              {captionLayout}
              {locale}
              month={month.value}
              {monthFormat}
              {monthIndex}
              months={monthsProp}
              {yearFormat}
              {years}
              bind:placeholder
            />
          </RangeCalendar.Header>

          <RangeCalendar.Grid>
            <RangeCalendar.GridHead>
              <RangeCalendar.GridRow class="select-none">
                {#each weekdays as weekday, i (i)}
                  <RangeCalendar.HeadCell>
                    {weekday.slice(0, 2)}
                  </RangeCalendar.HeadCell>
                {/each}
              </RangeCalendar.GridRow>
            </RangeCalendar.GridHead>
            <RangeCalendar.GridBody>
              {#each month.weeks as weekDates (weekDates)}
                <RangeCalendar.GridRow class="mt-2 w-full">
                  {#each weekDates as date (date)}
                    <RangeCalendar.Cell {date} month={month.value}>
                      {#if day}
                        {@render day({
													day: date,
													outsideMonth: !isEqualMonth(date, month.value),
												})}
                      {:else}
                        <RangeCalendar.Day />
                      {/if}
                    </RangeCalendar.Cell>
                  {/each}
                </RangeCalendar.GridRow>
              {/each}
            </RangeCalendar.GridBody>
          </RangeCalendar.Grid>
        </RangeCalendar.Month>
      {/each}
    </RangeCalendar.Months>
  {/snippet}
</RangeCalendarPrimitive.Root>
