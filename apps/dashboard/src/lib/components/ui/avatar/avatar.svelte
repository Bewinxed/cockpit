<script lang="ts">
  import { Avatar as AvatarPrimitive } from "bits-ui";
  import { cn } from "$lib/utils.js";

  let {
    ref = $bindable(null),
    loadingStatus = $bindable("loading"),
    size = "default",
    class: className,
    ...restProps
  }: AvatarPrimitive.RootProps & {
    size?: "default" | "sm" | "lg";
  } = $props();
</script>

<AvatarPrimitive.Root
  class={cn(
		"size-8 rounded-full after:rounded-full data-[size=lg]:size-10 data-[size=sm]:size-6 group/avatar relative flex shrink-0 select-none after:absolute after:inset-0 after:border after:border-border after:mix-blend-darken dark:after:mix-blend-lighten",
		className
	)}
  data-size={size}
  data-slot="avatar"
  bind:loadingStatus
  bind:ref
  {...restProps}
/>
