<script lang="ts">
  import { ContextMenu as ContextMenuPrimitive } from "bits-ui";

  let {
    ref = $bindable(null),
    value = $bindable(""),
    ...restProps
  }: ContextMenuPrimitive.RadioGroupProps = $props();
</script>

<ContextMenuPrimitive.RadioGroup
  data-slot="context-menu-radio-group"
  bind:ref
  bind:value
  {...restProps}
/>
