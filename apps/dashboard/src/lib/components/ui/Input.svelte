<script lang="ts">
  import type { Snippet, Component } from 'svelte';
  import type { HTMLInputAttributes } from 'svelte/elements';

  interface Props extends HTMLInputAttributes {
    icon?: Component<{ class?: string }>;
    iconRight?: Component<{ class?: string }>;
    error?: string;
    label?: string;
    hint?: string;
  }

  let {
    icon: Icon,
    iconRight: IconRight,
    error,
    label,
    hint,
    id,
    class: className = '',
    ...rest
  }: Props = $props();

  // Generate stable ID once and use derived to track prop changes
  const fallbackId = `input-${Math.random().toString(36).slice(2, 9)}`;
  const inputId = $derived(id || fallbackId);
</script>

<div class="flex flex-col gap-1.5">
  {#if label}
    <label for={inputId} class="text-sm font-medium text-text">
      {label}
    </label>
  {/if}

  <div class="relative">
    {#if Icon}
      <div class="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
        <Icon class="w-4 h-4 text-text-muted" />
      </div>
    {/if}

    <input
      id={inputId}
      class="input {Icon ? 'pl-9' : ''} {IconRight ? 'pr-9' : ''} {error ? 'input-error' : ''} {className}"
      {...rest}
    />

    {#if IconRight}
      <div class="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
        <IconRight class="w-4 h-4 text-text-muted" />
      </div>
    {/if}
  </div>

  {#if error}
    <p class="text-xs text-error">{error}</p>
  {:else if hint}
    <p class="text-xs text-text-muted">{hint}</p>
  {/if}
</div>
