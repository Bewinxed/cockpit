<script lang="ts">
  interface Instance {
    id: string;
    name: string;
    status: 'starting' | 'running' | 'stopping' | 'stopped' | 'error';
    agent: string;
    project: string | null;
    lastActivity: string;
  }

  interface Props {
    instance: Instance;
  }

  let { instance }: Props = $props();

  const statusConfig = {
    starting: { class: 'status-badge bg-flexoki-yellow/15 text-flexoki-yellow', label: 'Starting', dotActive: true },
    running: { class: 'status-badge status-running', label: 'Running', dotActive: true },
    stopping: { class: 'status-badge bg-flexoki-orange/15 text-flexoki-orange', label: 'Stopping', dotActive: true },
    stopped: { class: 'status-badge status-offline', label: 'Stopped', dotActive: false },
    error: { class: 'status-badge status-error', label: 'Error', dotActive: false },
  };
</script>

<a href="/instances/{instance.id}" class="block card card-interactive group">
  <div class="flex items-start justify-between mb-3">
    <div>
      <h3 class="font-medium text-tx-1 group-hover:text-primary transition-colors">
        {instance.name}
      </h3>
      {#if instance.project}
        <span class="text-xs text-tx-3 mt-1 block">{instance.project}</span>
      {/if}
    </div>
    <div class={statusConfig[instance.status].class}>
      <span class="status-dot" class:status-dot-active={statusConfig[instance.status].dotActive}></span>
      {statusConfig[instance.status].label}
    </div>
  </div>

  <div class="flex items-center justify-between text-sm text-tx-2">
    <div class="flex items-center gap-2">
      <span class="text-tx-3">●</span>
      <span>{instance.agent}</span>
    </div>
    <span class="text-tx-3">{instance.lastActivity}</span>
  </div>
</a>
