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

<div
  class={cn("[&_svg:not([class*='size-'])]:size-4 flex items-center", className)}
  data-slot="input-otp-separator"
  role="separator"
  bind:this={ref}
  {...restProps}
>
  {#if children}
    {@render children?.()}
  {:else}
    <HugeiconsIcon icon={MinusSignIcon} strokeWidth={2} />
  {/if}
</div>
