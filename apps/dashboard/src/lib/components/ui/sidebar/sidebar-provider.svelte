<script lang="ts">
  import type { HTMLAttributes } from "svelte/elements";
  // biome-ignore lint/performance/noNamespaceImport: shadcn-svelte convention for importing a component group
  import * as Tooltip from "$lib/components/ui/tooltip/index.js";
  import { cn, type WithElementRef } from "$lib/utils.js";
  import {
    SIDEBAR_COOKIE_MAX_AGE,
    SIDEBAR_COOKIE_NAME,
    SIDEBAR_WIDTH,
    SIDEBAR_WIDTH_ICON,
  } from "./constants.js";
  import { setSidebar } from "./context.svelte.js";

  let {
    ref = $bindable(null),
    open = $bindable(true),
    onOpenChange = () => {
      // no-op default: callers that don't need to observe open state omit this
    },
    class: className,
    style,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLDivElement>> & {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
  } = $props();

  const sidebar = setSidebar({
    open: () => open,
    setOpen: (value: boolean) => {
      open = value;
      onOpenChange(value);

      // This sets the cookie to keep the sidebar state.
      // biome-ignore lint/suspicious/noDocumentCookie: Cookie Store API is async and unsupported in Safari; this write must stay synchronous
      document.cookie = `${SIDEBAR_COOKIE_NAME}=${open}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}`;
    },
  });
</script>

<svelte:window onkeydown={sidebar.handleShortcutKeydown} />

<Tooltip.Provider delayDuration={0}>
  <div
    class={cn(
			"group/sidebar-wrapper flex min-h-svh w-full has-data-[variant=inset]:bg-sidebar",
			className
		)}
    data-slot="sidebar-wrapper"
    style="--sidebar-width: {SIDEBAR_WIDTH}; --sidebar-width-icon: {SIDEBAR_WIDTH_ICON}; {style}"
    bind:this={ref}
    {...restProps}
  >
    {@render children?.()}
  </div>
</Tooltip.Provider>
