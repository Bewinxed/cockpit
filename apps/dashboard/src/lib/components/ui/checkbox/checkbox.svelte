<script lang="ts">
  import { MinusSignIcon, Tick02Icon } from "@hugeicons/core-free-icons";
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import { Checkbox as CheckboxPrimitive } from "bits-ui";
  import { cn, type WithoutChildrenOrChild } from "$lib/utils.js";

  let {
    ref = $bindable(null),
    checked = $bindable(false),
    indeterminate = $bindable(false),
    class: className,
    ...restProps
  }: WithoutChildrenOrChild<CheckboxPrimitive.RootProps> = $props();
</script>

<CheckboxPrimitive.Root
  class={cn(
		"peer relative flex size-4 shrink-0 items-center justify-center rounded-[var(--radius-tile)] border border-input outline-none transition-shadow after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 group-has-disabled/field:opacity-50 aria-invalid:border-destructive aria-invalid:ring-[3px] aria-invalid:ring-destructive/20 aria-invalid:aria-checked:border-primary data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground dark:bg-input/30 dark:data-checked:bg-primary dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
		className
	)}
  data-slot="checkbox"
  bind:checked
  bind:indeterminate
  bind:ref
  {...restProps}
>
  {#snippet children({ checked, indeterminate })}
    <div
      class="[&>svg]:size-3.5 grid place-content-center text-current transition-none"
      data-slot="checkbox-indicator"
    >
      {#if checked}
        <HugeiconsIcon icon={Tick02Icon} strokeWidth={2} />
      {:else if indeterminate}
        <HugeiconsIcon icon={MinusSignIcon} strokeWidth={2} />
      {/if}
    </div>
  {/snippet}
</CheckboxPrimitive.Root>
