<script lang="ts">
  import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import type { HTMLLiAttributes } from "svelte/elements";
  import { cn, type WithElementRef } from "$lib/utils.js";

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLLiAttributes> = $props();
</script>

<li
  aria-hidden="true"
  class={cn("[&>svg]:size-3.5", className)}
  data-slot="breadcrumb-separator"
  role="presentation"
  bind:this={ref}
  {...restProps}
>
  {#if children}
    {@render children?.()}
  {:else}
    <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} />
  {/if}
</li>
