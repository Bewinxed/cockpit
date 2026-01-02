<script lang="ts">
  import type { Snippet, Component } from 'svelte';
  import Button from './Button.svelte';

  interface Props {
    icon: Component<{ class?: string }>;
    title: string;
    description: string;
    action?: {
      label: string;
      onClick: () => void;
    };
    size?: 'sm' | 'md' | 'lg';
    class?: string;
  }

  let {
    icon: Icon,
    title,
    description,
    action,
    size = 'md',
    class: className = '',
  }: Props = $props();

  const sizeClasses = {
    sm: {
      container: 'py-6',
      icon: 'w-8 h-8',
      iconBg: 'w-12 h-12',
      title: 'text-sm',
      description: 'text-xs',
    },
    md: {
      container: 'py-10',
      icon: 'w-10 h-10',
      iconBg: 'w-16 h-16',
      title: 'text-base',
      description: 'text-sm',
    },
    lg: {
      container: 'py-16',
      icon: 'w-12 h-12',
      iconBg: 'w-20 h-20',
      title: 'text-lg',
      description: 'text-base',
    },
  };

  const styles = $derived(sizeClasses[size]);
</script>

<div class="flex flex-col items-center justify-center text-center {styles.container} {className}">
  <div class="flex items-center justify-center {styles.iconBg} rounded-2xl bg-surface-hover mb-4">
    <Icon class="{styles.icon} text-text-muted" />
  </div>

  <h3 class="font-medium text-text {styles.title} mb-1">
    {title}
  </h3>

  <p class="text-text-secondary {styles.description} max-w-sm">
    {description}
  </p>

  {#if action}
    <div class="mt-4">
      <Button variant="primary" size="sm" onclick={action.onClick}>
        {#snippet children()}
          {action.label}
        {/snippet}
      </Button>
    </div>
  {/if}
</div>
