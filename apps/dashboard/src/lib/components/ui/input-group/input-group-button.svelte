<script lang="ts" module>
  import { tv, type VariantProps } from "tailwind-variants";

  const inputGroupButtonVariants = tv({
    base: "flex items-center gap-2 rounded-[var(--radius-control)] text-sm shadow-none",
    variants: {
      size: {
        xs: "h-6 gap-1 px-1.5 [&>svg:not([class*='size-'])]:size-3.5",
        sm: "cn-input-group-button-size-sm",
        "icon-xs": "size-6 p-0 has-[>svg]:p-0",
        "icon-sm": "size-8 p-0 has-[>svg]:p-0",
      },
    },
    defaultVariants: {
      size: "xs",
    },
  });

  export type InputGroupButtonSize = VariantProps<
    typeof inputGroupButtonVariants
  >["size"];
</script>

<script lang="ts">
  import type { ComponentProps } from "svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import { cn } from "$lib/utils.js";

  let {
    ref = $bindable(null),
    class: className,
    children,
    type = "button",
    variant = "ghost",
    size = "xs",
    ...restProps
  }: Omit<ComponentProps<typeof Button>, "href" | "size"> & {
    size?: InputGroupButtonSize;
  } = $props();
</script>

<Button
  class={cn(inputGroupButtonVariants({ size }), className)}
  data-size={size}
  {type}
  {variant}
  bind:ref
  {...restProps}
>
  {@render children?.()}
</Button>
