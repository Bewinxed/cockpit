<script lang="ts">
  import type { ComponentType, SvelteComponent } from 'svelte';

  interface Props {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    icon: ComponentType<SvelteComponent<any>>;
    count: number | string;
    label: string;
    trend?: string;
    color?: 'primary' | 'success' | 'warning' | 'error' | 'info' | 'secondary';
  }

  let { icon: Icon, count, label, trend, color = 'primary' }: Props = $props();

  const colorClasses = {
    primary: {
      accent: 'bg-primary',
      icon: 'text-text',
    },
    success: {
      accent: 'bg-success',
      icon: 'text-text',
    },
    warning: {
      accent: 'bg-warning',
      icon: 'text-text',
    },
    error: {
      accent: 'bg-error',
      icon: 'text-text',
    },
    info: {
      accent: 'bg-accent-blue',
      icon: 'text-text',
    },
    secondary: {
      accent: 'bg-secondary',
      icon: 'text-text',
    },
  };

  const colors = $derived(colorClasses[color]);
</script>

<div class="bg-surface border border-border group transition-all duration-200 hover:border-primary/50 relative overflow-hidden">
  <!-- Accent stripe -->
  <div class="absolute top-0 left-0 w-1 h-full {colors.accent}"></div>

  <div class="p-5 pl-6">
    <!-- Header with icon and trend -->
    <div class="flex items-start justify-between mb-4">
      <div class="w-10 h-10 bg-bg-subtle flex items-center justify-center">
        <Icon class="w-5 h-5 {colors.icon}" />
      </div>
      {#if trend}
        <span class="text-[10px] font-mono text-text-muted uppercase tracking-widest">{trend}</span>
      {/if}
    </div>

    <!-- Count - large Swiss typography -->
    <div class="text-4xl font-serif font-bold text-text mb-1 tracking-tight">{count}</div>

    <!-- Label - uppercase mono -->
    <div class="text-[11px] font-mono text-text-secondary uppercase tracking-[0.15em]">{label}</div>
  </div>
</div>
