<script lang="ts" module>
  import type {
    HTMLAnchorAttributes,
    HTMLButtonAttributes,
  } from "svelte/elements";
  import { tv, type VariantProps } from "tailwind-variants";
  import { cn, type WithElementRef } from "$lib/utils.js";

  export const buttonVariants = tv({
    base: "group/button inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-[var(--radius-control)] border border-transparent bg-clip-padding font-medium text-sm outline-none transition-all focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
    variants: {
      variant: {
        default:
          "border-transparent bg-[var(--brand-solid)] text-[var(--on-brand)] [background-image:var(--gradient-action)] [box-shadow:var(--shadow-action)] hover:brightness-[1.08]",
        outline:
          "border-[var(--border-control)] bg-[var(--surface-raised)] text-[var(--ink-strong)] hover:bg-[var(--surface-hover)] aria-expanded:bg-[var(--surface-hover)]",
        secondary:
          "border-[var(--border-hairline)] bg-[var(--surface-sunken)] text-[var(--ink-body)] hover:bg-[var(--surface-hover)]",
        ghost:
          "hover:bg-[var(--surface-hover)] hover:text-[var(--ink-strong)] aria-expanded:bg-[var(--surface-hover)]",
        destructive:
          "border-[var(--error-9)] bg-transparent text-[var(--error-11)] hover:bg-[var(--error-3)] focus-visible:border-destructive/40 focus-visible:ring-destructive/20",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-[var(--c-nav-h)] gap-1.5 px-3 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5",
        xs: "h-[var(--c-pill-h)] gap-1 px-2.5 text-xs has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1 px-3 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        lg: "h-[var(--c-btn-h)] gap-1.5 px-4 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        icon: "size-[var(--c-nav-h)]",
        "icon-xs":
          "size-[var(--c-pill-h)] [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-[var(--c-btn-h)]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  });

  export type ButtonVariant = VariantProps<typeof buttonVariants>["variant"];
  export type ButtonSize = VariantProps<typeof buttonVariants>["size"];

  export type ButtonProps = WithElementRef<HTMLButtonAttributes> &
    WithElementRef<HTMLAnchorAttributes> & {
      variant?: ButtonVariant;
      size?: ButtonSize;
    };
</script>

<script lang="ts">
  let {
    class: className,
    variant = "default",
    size = "default",
    ref = $bindable(null),
    href,
    type = "button",
    disabled,
    children,
    ...restProps
  }: ButtonProps = $props();
</script>

{#if href}
  <a
    aria-disabled={disabled}
    class={cn(buttonVariants({ variant, size }), className)}
    data-slot="button"
    href={disabled ? undefined : href}
    role={disabled ? "link" : undefined}
    tabindex={disabled ? -1 : undefined}
    bind:this={ref}
    {...restProps}
  >
    {@render children?.()}
  </a>
{:else}
  <button
    class={cn(buttonVariants({ variant, size }), className)}
    data-slot="button"
    {disabled}
    {type}
    bind:this={ref}
    {...restProps}
  >
    {@render children?.()}
  </button>
{/if}
