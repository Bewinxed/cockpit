<script lang="ts">
  import type { ComponentType, SvelteComponent } from 'svelte';
  import { Button } from './index';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type IconComponent = ComponentType<SvelteComponent<any>>;

  interface Props {
    icon: IconComponent;
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
      title: 'text-sm font-semibold',
      description: 'text-xs',
    },
    md: {
      container: 'py-10',
      icon: 'w-10 h-10',
      iconBg: 'w-16 h-16',
      title: 'text-base font-semibold',
      description: 'text-sm',
    },
    lg: {
      container: 'py-16',
      icon: 'w-12 h-12',
      iconBg: 'w-20 h-20',
      title: 'text-lg font-bold',
      description: 'text-base',
    },
  };

  const styles = $derived(sizeClasses[size]);
</script>

<div class="flex flex-col items-center justify-center text-center {styles.container} {className}">
  <div class="flex items-center justify-center {styles.iconBg} rounded-2xl bg-muted border border-border mb-4">
    <Icon class="{styles.icon} text-muted-foreground" />
  </div>

  <h3 class="text-foreground {styles.title} mb-1 font-sans tracking-tight">
    {title}
  </h3>

  <p class="text-muted-foreground {styles.description} max-w-sm">
    {description}
  </p>

  {#if action}
    <div class="mt-6">
      <Button variant="default" size="sm" onclick={action.onClick}>
        {action.label}
      </Button>
    </div>
  {/if}
</div>
