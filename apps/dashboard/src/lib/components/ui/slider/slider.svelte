<script lang="ts">
  import { Slider as SliderPrimitive } from "bits-ui";
  import { cn, type WithoutChildrenOrChild } from "$lib/utils.js";

  let {
    ref = $bindable(null),
    value = $bindable(),
    orientation = "horizontal",
    class: className,
    ...restProps
  }: WithoutChildrenOrChild<SliderPrimitive.RootProps> = $props();
</script>

<!--
Discriminated Unions + Destructing (required for bindable) do not
get along, so we shut typescript up by casting `value` to `never`.
-->
<SliderPrimitive.Root
  class={cn(
		"data-vertical:min-h-40 relative flex w-full touch-none items-center select-none data-disabled:opacity-50 data-vertical:h-full data-vertical:w-auto data-vertical:flex-col",
		className
	)}
  data-slot="slider"
  {orientation}
  bind:ref
  bind:value={value as never}
  {...restProps}
>
  {#snippet children({ thumbItems })}
    <span
      class={cn(
				"rounded-[var(--radius-pill)] bg-muted data-horizontal:h-3 data-horizontal:w-full data-vertical:h-full data-vertical:w-3 relative grow overflow-hidden bg-muted data-horizontal:w-full data-vertical:h-full"
			)}
      data-orientation={orientation}
      data-slot="slider-track"
    >
      <SliderPrimitive.Range
        class={cn(
					"bg-primary absolute select-none data-horizontal:h-full data-vertical:w-full"
				)}
        data-slot="slider-range"
      />
    </span>
    {#each thumbItems as thumb (thumb.index)}
      <SliderPrimitive.Thumb
        class="size-4 rounded-[var(--radius-pill)] border border-primary bg-white shadow-sm ring-ring/50 transition-colors hover:ring-4 focus-visible:ring-4 focus-visible:outline-hidden block shrink-0 select-none disabled:pointer-events-none disabled:opacity-50"
        data-slot="slider-thumb"
        index={thumb.index}
      />
    {/each}
  {/snippet}
</SliderPrimitive.Root>
