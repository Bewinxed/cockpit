<script lang="ts">
  import { SidebarLeftIcon } from "@hugeicons/core-free-icons";
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import type { ComponentProps } from "svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import { cn } from "$lib/utils.js";
  import { useSidebar } from "./context.svelte.js";

  let {
    ref = $bindable(null),
    class: className,
    onclick,
    ...restProps
  }: ComponentProps<typeof Button> & {
    onclick?: (e: MouseEvent) => void;
  } = $props();

  const sidebar = useSidebar();
</script>

<Button
  class={cn("cn-sidebar-trigger", className)}
  data-sidebar="trigger"
  data-slot="sidebar-trigger"
  onclick={(e) => {
		onclick?.(e);
		sidebar.toggle();
	}}
  size="icon-sm"
  type="button"
  variant="ghost"
  bind:ref
  {...restProps}
>
  <HugeiconsIcon icon={SidebarLeftIcon} strokeWidth={2} />
  <span class="sr-only">Toggle Sidebar</span>
</Button>
