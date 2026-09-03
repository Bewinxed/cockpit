<script lang="ts">
  import { AspectRatio as AspectRatioPrimitive } from "bits-ui";

  let { ref = $bindable(null), ...restProps }: AspectRatioPrimitive.RootProps =
    $props();
</script>

<AspectRatioPrimitive.Root data-slot="aspect-ratio" bind:ref {...restProps} />
