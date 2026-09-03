<script lang="ts">
  import { ContextMenu as ContextMenuPrimitive } from "bits-ui";

  let { ref = $bindable(null), ...restProps }: ContextMenuPrimitive.GroupProps =
    $props();
</script>

<ContextMenuPrimitive.Group
  data-slot="context-menu-group"
  bind:ref
  {...restProps}
/>
