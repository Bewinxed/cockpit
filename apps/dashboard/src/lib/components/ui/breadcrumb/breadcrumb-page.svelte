<script lang="ts">
  import type { HTMLAttributes } from "svelte/elements";
  import { cn, type WithElementRef } from "$lib/utils.js";

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLSpanElement>> = $props();
</script>

<!-- biome-ignore lint/a11y/useFocusableInteractive: this is the current page, deliberately non-interactive and unfocusable despite the link-like role -->
<!-- biome-ignore lint/a11y/useSemanticElements: not a real link — it has no href and must not be navigable, since it represents the current page -->
<span
  aria-current="page"
  aria-disabled="true"
  class={cn("font-normal text-foreground", className)}
  data-slot="breadcrumb-page"
  role="link"
  bind:this={ref}
  {...restProps}
>
  {@render children?.()}
</span>
