<script
  generics="T extends Record<string, unknown>, U extends FormPathLeaves<T>"
  lang="ts"
>
  import * as FormPrimitive from "formsnap";
  import type { HTMLAttributes } from "svelte/elements";
  import type { FormPathLeaves } from "sveltekit-superforms";
  import { cn, type WithElementRef, type WithoutChildren } from "$lib/utils.js";

  let {
    ref = $bindable(null),
    class: className,
    form,
    name,
    children: childrenProp,
    ...restProps
  }: WithoutChildren<WithElementRef<HTMLAttributes<HTMLDivElement>>> &
    FormPrimitive.ElementFieldProps<T, U> = $props();
</script>

<FormPrimitive.ElementField {form} {name}>
  {#snippet children({ constraints, errors, tainted, value })}
    <div class={cn("space-y-2", className)} bind:this={ref} {...restProps}>
      {@render childrenProp?.({ constraints, errors, tainted, value: value as T[U] })}
    </div>
  {/snippet}
</FormPrimitive.ElementField>
