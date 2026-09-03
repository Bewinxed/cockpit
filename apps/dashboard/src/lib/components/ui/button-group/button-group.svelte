<script lang="ts" module>
  import { tv, type VariantProps } from "tailwind-variants";

  export const buttonGroupVariants = tv({
    base: "flex w-fit items-stretch has-[>[data-slot=button-group]]:gap-2 [&>*]:focus-visible:relative [&>*]:focus-visible:z-10 has-[select[aria-hidden=true]:last-child]:[&>[data-slot=select-trigger]:last-of-type]:rounded-r-[var(--radius-control)] [&>[data-slot=select-trigger]:not([class*='w-'])]:w-fit [&>input]:flex-1",
    variants: {
      orientation: {
        horizontal:
          "[&>[data-slot]:not(:has(~[data-slot]))]:rounded-r-[var(--radius-control)]! [&>[data-slot]]:rounded-r-none [&>[data-slot]~[data-slot]]:rounded-l-none [&>[data-slot]~[data-slot]]:border-l-0",
        vertical:
          "flex-col [&>[data-slot]:not(:has(~[data-slot]))]:rounded-b-[var(--radius-control)]! [&>[data-slot]]:rounded-b-none [&>[data-slot]~[data-slot]]:rounded-t-none [&>[data-slot]~[data-slot]]:border-t-0",
      },
    },
    defaultVariants: {
      orientation: "horizontal",
    },
  });

  export type ButtonGroupOrientation = VariantProps<
    typeof buttonGroupVariants
  >["orientation"];
</script>

<script lang="ts">
  import type { HTMLAttributes } from "svelte/elements";
  import { cn, type WithElementRef } from "$lib/utils.js";

  let {
    ref = $bindable(null),
    class: className,
    children,
    orientation = "horizontal",
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLDivElement>> & {
    orientation?: ButtonGroupOrientation;
  } = $props();
</script>

<!-- biome-ignore lint/a11y/useSemanticElements: fieldset would add a default border and legend semantics that don't apply to a toolbar-style button grouping -->
<div
  class={cn(buttonGroupVariants({ orientation }), className)}
  data-orientation={orientation}
  data-slot="button-group"
  role="group"
  bind:this={ref}
  {...restProps}
>
  {@render children?.()}
</div>
