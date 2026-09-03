<script lang="ts">
  import {
    Alert02Icon,
    CheckmarkCircle02Icon,
    InformationCircleIcon,
    Loading03Icon,
    MultiplicationSignCircleIcon,
  } from "@hugeicons/core-free-icons";
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import { mode } from "mode-watcher";
  import {
    Toaster as Sonner,
    type ToasterProps as SonnerProps,
  } from "svelte-sonner";

  let { ...restProps }: SonnerProps = $props();
</script>

<Sonner
  class="toaster group"
  style="--normal-bg: var(--color-popover); --normal-text: var(--color-popover-foreground); --normal-border: var(--color-border);"
  theme={mode.current}
  {...restProps}
>
  {#snippet loadingIcon()}
    <HugeiconsIcon
      class="size-4 animate-spin"
      icon={Loading03Icon}
      strokeWidth={2}
    />
  {/snippet}
  {#snippet successIcon()}
    <HugeiconsIcon
      class="size-4"
      icon={CheckmarkCircle02Icon}
      strokeWidth={2}
    />
  {/snippet}
  {#snippet errorIcon()}
    <HugeiconsIcon
      class="size-4"
      icon={MultiplicationSignCircleIcon}
      strokeWidth={2}
    />
  {/snippet}
  {#snippet infoIcon()}
    <HugeiconsIcon
      class="size-4"
      icon={InformationCircleIcon}
      strokeWidth={2}
    />
  {/snippet}
  {#snippet warningIcon()}
    <HugeiconsIcon class="size-4" icon={Alert02Icon} strokeWidth={2} />
  {/snippet}
</Sonner>
