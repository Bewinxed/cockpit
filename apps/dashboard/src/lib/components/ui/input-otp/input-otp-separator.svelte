<script lang="ts">
  import { MinusSignIcon } from "@hugeicons/core-free-icons";
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import type { HTMLAttributes } from "svelte/elements";
  import type { WithElementRef } from "$lib/utils.js";
  import { cn } from "$lib/utils.js";

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLDivElement>> = $props();
</script>

<!-- biome-ignore-start lint/a11y/useFocusableInteractive: decorative divider between OTP groups, not an interactive splitter -->
<!-- biome-ignore-start lint/a11y/useSemanticElements: same -->
<!-- biome-ignore-start lint/a11y/useAriaPropsForRole: same -->
<div
  class={cn("flex items-center [&_svg:not([class*='size-'])]:size-4", className)}
  data-slot="input-otp-separator"
  role="separator"
  bind:this={ref}
  {...restProps}
>
  <!-- biome-ignore-end lint/a11y/useFocusableInteractive: same -->
  <!-- biome-ignore-end lint/a11y/useSemanticElements: same -->
  <!-- biome-ignore-end lint/a11y/useAriaPropsForRole: same -->
  {#if children}
    {@render children?.()}
  {:else}
    <HugeiconsIcon icon={MinusSignIcon} strokeWidth={2} />
  {/if}
</div>
