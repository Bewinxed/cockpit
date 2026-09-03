<script lang="ts">
  import { SearchIcon } from "@hugeicons/core-free-icons";
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import { Command as CommandPrimitive } from "bits-ui";
  // biome-ignore lint/performance/noNamespaceImport: shadcn-svelte convention for importing a component group
  import * as InputGroup from "$lib/components/ui/input-group/index.js";
  import { cn } from "$lib/utils.js";

  let {
    ref = $bindable(null),
    class: className,
    value = $bindable(""),
    ...restProps
  }: CommandPrimitive.InputProps = $props();
</script>

<div class="p-1 pb-0" data-slot="command-input-wrapper">
  <InputGroup.Root class="h-[var(--c-nav-h)] bg-input/30">
    <CommandPrimitive.Input
      class={cn(
				"w-full text-sm outline-hidden disabled:cursor-not-allowed disabled:opacity-50",
				className
			)}
      data-slot="command-input"
      {value}
      {...restProps}
    >
      {#snippet child({ props })}
        <InputGroup.Input {...props} bind:ref bind:value />
      {/snippet}
    </CommandPrimitive.Input>
    <InputGroup.Addon>
      <HugeiconsIcon
        class="size-4 shrink-0 opacity-50"
        icon={SearchIcon}
        strokeWidth={2}
      />
    </InputGroup.Addon>
  </InputGroup.Root>
</div>
