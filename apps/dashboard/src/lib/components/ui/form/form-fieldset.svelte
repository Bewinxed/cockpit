<script
  generics="T extends Record<string, unknown>, U extends FormPath<T>"
  lang="ts"
>
  import { Fieldset, type FieldsetProps } from "formsnap";
  import type { FormPath } from "sveltekit-superforms";
  import { cn, type WithoutChild } from "$lib/utils.js";

  let {
    ref = $bindable(null),
    class: className,
    form,
    name,
    ...restProps
  }: WithoutChild<FieldsetProps<T, U>> = $props();
</script>

<Fieldset
  class={cn("space-y-2", className)}
  {form}
  {name}
  bind:ref
  {...restProps}
/>
