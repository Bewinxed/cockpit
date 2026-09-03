<script lang="ts">
  import { Tick02Icon } from "@hugeicons/core-free-icons";
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import { Command as CommandPrimitive } from "bits-ui";
  import { cn } from "$lib/utils.js";

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: CommandPrimitive.ItemProps = $props();
</script>

<CommandPrimitive.Item
  class={cn(
		"group/command-item relative flex cursor-default items-center gap-2 rounded-[var(--radius-control)] px-2 py-1.5 text-sm outline-hidden select-none in-data-[slot=dialog-content]:rounded-[var(--radius-card)]! data-selected:bg-muted data-selected:text-foreground data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 data-selected:*:[svg]:text-foreground",
		className
	)}
  data-slot="command-item"
  bind:ref
  {...restProps}
>
  {@render children?.()}
  <HugeiconsIcon
    class="cn-command-item-indicator ml-auto opacity-0 group-has-[[data-slot=command-shortcut]]/command-item:hidden group-data-[checked=true]/command-item:opacity-100"
    icon={Tick02Icon}
    strokeWidth={2}
  />
</CommandPrimitive.Item>
