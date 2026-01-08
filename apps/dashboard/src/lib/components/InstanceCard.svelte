<script lang="ts">
  import Badge from '$lib/components/ui/Badge.svelte';
  import { Server, Clock, ArrowRight } from 'lucide-svelte';
  import { formatDistanceToNow } from '$lib/utils/time';
  import { agents } from '$lib/stores/realtime.svelte';

  interface Instance {
    id: string;
    name: string;
    status: 'starting' | 'running' | 'stopping' | 'stopped' | 'error' | 'disconnected' | 'sleeping';
    machineId: string;
    project: string | null;
    cwd?: string;
    lastActivity?: string | Date;
    createdAt?: string | Date;
  }

  interface Props {
    instance: Instance;
    compact?: boolean;
  }

  let { instance, compact = false }: Props = $props();

  const agent = $derived($agents.get(instance.machineId));
  const agentName = $derived(agent?.name || 'Unknown Agent');

  const statusConfig = {
    starting: { variant: 'warning' as const, label: 'Starting', pulse: true },
    running: { variant: 'success' as const, label: 'Running', pulse: true },
    stopping: { variant: 'warning' as const, label: 'Stopping', pulse: true },
    stopped: { variant: 'default' as const, label: 'Stopped', pulse: false },
    sleeping: { variant: 'info' as const, label: 'Sleeping', pulse: false },
    disconnected: { variant: 'warning' as const, label: 'Disconnected', pulse: false },
    error: { variant: 'error' as const, label: 'Error', pulse: false },
  };

  const config = $derived(statusConfig[instance.status]);

  // Format the display name from prompt or cwd
  const displayName = $derived(
    instance.name?.slice(0, 40) || instance.cwd?.split('/').pop() || 'Instance'
  );

  // Format the time
  const timeAgo = $derived(
    instance.lastActivity || instance.createdAt
      ? formatDistanceToNow(new Date(instance.lastActivity || instance.createdAt!))
      : null
  );

  const bgClasses = {
    starting: 'bg-warning-light',
    running: 'bg-success-light',
    stopping: 'bg-warning-light',
    stopped: 'bg-surface-hover',
    sleeping: 'bg-info-light',
    disconnected: 'bg-warning-light',
    error: 'bg-error-light',
  };

  const dotClasses = {
    starting: 'bg-warning',
    running: 'bg-success',
    stopping: 'bg-warning',
    stopped: 'bg-text-muted',
    sleeping: 'bg-info',
    disconnected: 'bg-warning',
    error: 'bg-error',
  };
</script>

<a
  href="/instances/{instance.id}"
  class="card card-interactive p-4 group flex items-center gap-4"
>
  <!-- Status indicator -->
  <div class="flex-shrink-0">
    <div class="w-10 h-10 rounded-xl {bgClasses[instance.status]} flex items-center justify-center group-hover:scale-105 transition-transform">
      {#if config.pulse}
        <span class="status-dot status-dot-pulse {dotClasses[instance.status]}"></span>
      {:else}
        <span class="status-dot {dotClasses[instance.status]}"></span>
      {/if}
    </div>
  </div>

  <!-- Content -->
  <div class="flex-1 min-w-0">
    <div class="flex items-center gap-2 mb-1">
      <h3 class="font-semibold text-text truncate group-hover:text-primary transition-colors">
        {displayName}
      </h3>
      <Badge variant={config.variant}>
        {config.label}
      </Badge>
    </div>

    <div class="flex items-center gap-3 text-sm text-text-secondary">
      <div class="flex items-center gap-1.5">
        <Server class="w-3.5 h-3.5 text-text-muted" />
        <span class="truncate">{agentName}</span>
      </div>
      {#if timeAgo}
        <span class="text-text-muted">·</span>
        <div class="flex items-center gap-1.5">
          <Clock class="w-3.5 h-3.5 text-text-muted" />
          <span>{timeAgo}</span>
        </div>
      {/if}
    </div>

    {#if !compact && instance.cwd}
      <div class="mt-1.5 text-xs text-text-muted font-mono truncate">
        {instance.cwd}
      </div>
    {/if}
  </div>

  <!-- Arrow with slide effect -->
  <div class="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
    <ArrowRight class="w-4 h-4 text-text-muted arrow-slide" />
  </div>
</a>
