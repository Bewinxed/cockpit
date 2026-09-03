<script lang="ts">
  import { FieldErrors, type FieldErrorsProps } from "formsnap";
  import { cn, type WithoutChild } from "$lib/utils.js";

  let {
    ref = $bindable(null),
    class: className,
    errorClasses,
    children: childrenProp,
    ...restProps
  }: WithoutChild<FieldErrorsProps> & {
    errorClasses?: string | undefined | null;
  } = $props();
</script>

<FieldErrors
  class={cn("font-medium text-destructive text-sm", className)}
  bind:ref
  {...restProps}
>
  {#snippet children({ errors, errorProps })}
    {#if childrenProp}
      {@render childrenProp({ errors, errorProps })}
    {:else}
      {#each errors as err (err)}
        <div {...errorProps} class={cn(errorClasses)}>{err}</div>
      {/each}
    {/if}
  {/snippet}
</FieldErrors>
