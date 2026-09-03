<script lang="ts">
  import { PinInput as InputOTPPrimitive } from "bits-ui";
  import { cn } from "$lib/utils.js";

  let {
    ref = $bindable(null),
    class: className,
    value = $bindable(""),
    ...restProps
  }: InputOTPPrimitive.RootProps = $props();
</script>

<InputOTPPrimitive.Root
  class={cn(
		"cn-input-otp-input gap-2 flex items-center disabled:cursor-not-allowed has-disabled:opacity-50",
		className
	)}
  data-slot="input-otp"
  spellcheck={false}
  bind:ref
  bind:value
  {...restProps}
/>
