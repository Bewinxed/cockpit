<script lang="ts">
  import { Menubar as MenubarPrimitive } from "bits-ui";

  let {
    ref = $bindable(null),
    ...restProps
  }: MenubarPrimitive.GroupProps & {
    inset?: boolean;
  } = $props();
</script>

<MenubarPrimitive.Group data-slot="menubar-group" bind:ref {...restProps} />
