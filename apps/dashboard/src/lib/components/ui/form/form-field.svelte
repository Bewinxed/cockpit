<script
  generics="T extends Record<string, unknown>, U extends FormPath<T>"
  lang="ts"
>
  import { Field, type FieldProps } from "formsnap";
  import type { HTMLAttributes } from "svelte/elements";
  import type { FormPath } from "sveltekit-superforms";
  import { cn, type WithElementRef, type WithoutChildren } from "$lib/utils.js";

  let {
    ref = $bindable(null),
    class: className,
    form,
    name,
    children: childrenProp,
    ...restProps
  }: FieldProps<T, U> &
    WithoutChildren<WithElementRef<HTMLAttributes<HTMLDivElement>>> = $props();
</script>

<Field {form} {name}>
  {#snippet children({ constraints, errors, tainted, value })}
    <div
      class={cn("space-y-2", className)}
      data-slot="form-item"
      bind:this={ref}
      {...restProps}
    >
      {@render childrenProp?.({ constraints, errors, tainted, value: value as T[U] })}
    </div>
  {/snippet}
</Field>
