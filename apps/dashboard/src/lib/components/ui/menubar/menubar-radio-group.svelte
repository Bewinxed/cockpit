<script lang="ts">
  import { Menubar as MenubarPrimitive } from "bits-ui";

  let {
    ref = $bindable(null),
    value = $bindable(""),
    ...restProps
  }: MenubarPrimitive.RadioGroupProps = $props();
</script>

<MenubarPrimitive.RadioGroup
  data-slot="menubar-radio-group"
  bind:ref
  bind:value
  {...restProps}
/>
