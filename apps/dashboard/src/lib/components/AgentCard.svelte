<script lang="ts">
  interface Agent {
    id: string;
    name: string;
    os: 'darwin' | 'linux' | 'windows';
    status: 'online' | 'offline';
    instances: number;
    ip: string;
  }

  interface Props {
    agent: Agent;
  }

  let { agent }: Props = $props();

  const osIcons = {
    darwin: '🍎',
    linux: '🐧',
    windows: '🪟',
  };

  const osLabels = {
    darwin: 'macOS',
    linux: 'Linux',
    windows: 'Windows',
  };
</script>

<a href="/agents/{agent.id}" class="block card card-interactive group">
  <div class="flex items-center gap-3">
    <div class="w-10 h-10 rounded-lg bg-bg-3 flex items-center justify-center text-lg group-hover:scale-110 transition-transform">
      {osIcons[agent.os]}
    </div>
    <div class="flex-1 min-w-0">
      <div class="flex items-center gap-2">
        <h3 class="font-medium text-tx-1 truncate group-hover:text-primary transition-colors">
          {agent.name}
        </h3>
        <span class="status-badge {agent.status === 'online' ? 'status-online' : 'status-offline'}">
          <span class="status-dot" class:status-dot-active={agent.status === 'online'}></span>
          {agent.status}
        </span>
      </div>
      <div class="flex items-center gap-3 mt-1 text-xs text-tx-3">
        <span>{osLabels[agent.os]}</span>
        <span>•</span>
        <span>{agent.ip}</span>
        <span>•</span>
        <span>{agent.instances} {agent.instances === 1 ? 'instance' : 'instances'}</span>
      </div>
    </div>
  </div>
</a>
