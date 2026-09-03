<script lang="ts">
  import { MinusSignIcon, Tick02Icon } from "@hugeicons/core-free-icons";
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import { Menubar as MenubarPrimitive } from "bits-ui";
  import type { Snippet } from "svelte";
  import { cn, type WithoutChildrenOrChild } from "$lib/utils.js";

  let {
    ref = $bindable(null),
    class: className,
    checked = $bindable(false),
    indeterminate = $bindable(false),
    inset,
    children: childrenProp,
    ...restProps
  }: WithoutChildrenOrChild<MenubarPrimitive.CheckboxItemProps> & {
    inset?: boolean;
    children?: Snippet;
  } = $props();
</script>

<MenubarPrimitive.CheckboxItem
  class={cn(
		"relative flex cursor-default select-none items-center gap-2.5 rounded-[var(--radius-card)] py-2 pr-3 pl-9.5 text-sm outline-hidden focus:bg-accent focus:text-accent-foreground focus:**:text-accent-foreground data-disabled:pointer-events-none data-inset:pl-9.5 data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
		className
	)}
  data-inset={inset}
  data-slot="menubar-checkbox-item"
  bind:checked
  bind:indeterminate
  bind:ref
  {...restProps}
>
  {#snippet children({ checked, indeterminate })}
    <span
      class="left-3 size-4 [&_svg:not([class*='size-'])]:size-4 pointer-events-none absolute flex items-center justify-center"
    >
      {#if indeterminate}
        <HugeiconsIcon icon={MinusSignIcon} strokeWidth={2} />
      {:else if checked}
        <HugeiconsIcon icon={Tick02Icon} strokeWidth={2} />
      {/if}
    </span>
    {@render childrenProp?.()}
  {/snippet}
</MenubarPrimitive.CheckboxItem>
