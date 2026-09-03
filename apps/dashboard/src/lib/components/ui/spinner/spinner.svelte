<script lang="ts">
  import { Loading03Icon } from "@hugeicons/core-free-icons";
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import type { SVGAttributes } from "svelte/elements";
  import { cn } from "$lib/utils.js";

  let {
    class: className,
    role = "status",
    // we add name, color, and stroke for compatibility with different icon libraries props
    name,
    color,
    stroke,
    "aria-label": ariaLabel = "Loading",
    ...restProps
  }: SVGAttributes<SVGSVGElement> = $props();
</script>

<HugeiconsIcon
  aria-label={ariaLabel}
  class={cn("size-4 animate-spin", className)}
  color={color === null ? undefined : color}
  icon={Loading03Icon}
  name={name === null ? undefined : name}
  {role}
  stroke={stroke === null ? undefined : stroke}
  strokeWidth={2}
  {...(restProps as Record<string, unknown>)}
/>
