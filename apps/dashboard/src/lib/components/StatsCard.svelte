<script lang="ts">
  import type { Component } from 'svelte';

  interface Props {
    icon: Component<{ class?: string }>;
    count: number | string;
    label: string;
    trend?: string;
    color?: 'primary' | 'success' | 'warning' | 'error' | 'info' | 'secondary';
  }

  let { icon: Icon, count, label, trend, color = 'primary' }: Props = $props();

  const colorClasses = {
    primary: {
      bg: 'bg-primary-light',
      icon: 'text-primary',
    },
    success: {
      bg: 'bg-success-light',
      icon: 'text-success',
    },
    warning: {
      bg: 'bg-warning-light',
      icon: 'text-warning',
    },
    error: {
      bg: 'bg-error-light',
      icon: 'text-error',
    },
    info: {
      bg: 'bg-info-light',
      icon: 'text-info',
    },
    secondary: {
      bg: 'bg-secondary-light',
      icon: 'text-secondary',
    },
  };

  const colors = $derived(colorClasses[color]);
</script>

<div class="bg-paper rounded-lg p-5 group" style="border: 1px dotted var(--color-border-dotted);">
  <div class="flex items-start justify-between mb-4">
    <div class="flex items-center justify-center w-11 h-11 rounded-xl {colors.bg}">
      <Icon class="w-5 h-5 {colors.icon}" />
    </div>
    {#if trend}
      <span class="text-xs text-text-muted">{trend}</span>
    {/if}
  </div>
  <div class="text-2xl font-bold text-text mb-1 tabular-nums">{count}</div>
  <div class="text-sm text-text-secondary">{label}</div>
</div>
