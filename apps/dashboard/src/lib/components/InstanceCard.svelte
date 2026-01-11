<script lang="ts">
  import { Clock, Server, ChevronRight } from 'lucide-svelte';
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
  }

  let { instance }: Props = $props();

  const agent = $derived($agents.get(instance.machineId));
  const agentName = $derived(agent?.name || agent?.hostname || 'Unknown');

  const isActive = $derived(instance.status === 'running' || instance.status === 'starting');

  const displayName = $derived(
    instance.name?.slice(0, 50) || instance.cwd?.split('/').pop() || 'Untitled'
  );

  const timeAgo = $derived(
    instance.lastActivity || instance.createdAt
      ? formatDistanceToNow(new Date(instance.lastActivity || instance.createdAt!))
      : null
  );
</script>

<a
  href="/instances/{instance.id}"
  class="group block rounded-2xl bg-secondary/50 p-4
         hover:bg-secondary transition-colors"
>
  <div class="flex items-center gap-4">
    <!-- Status Indicator -->
    <div class="flex-shrink-0">
      {#if isActive}
        <span class="block size-2.5 rounded-full bg-success animate-pulse"></span>
      {:else if instance.status === 'error'}
        <span class="block size-2.5 rounded-full bg-error"></span>
      {:else}
        <span class="block size-2.5 rounded-full bg-muted-foreground/30"></span>
      {/if}
    </div>

    <!-- Content -->
    <div class="flex-1 min-w-0">
      <div class="flex items-center gap-3">
        <h3 class="font-medium text-foreground truncate group-hover:text-primary transition-colors">
          {displayName}
        </h3>
        <span class="flex-shrink-0 text-xs px-2 py-0.5 rounded-full font-mono
                     {isActive
                       ? 'bg-success/20 text-success'
                       : instance.status === 'error'
                         ? 'bg-error/20 text-error'
                         : 'text-muted-foreground'}">
          {instance.status}
        </span>
      </div>

      <div class="flex items-center gap-4 mt-1.5 text-sm text-muted-foreground">
        <span class="flex items-center gap-1.5 truncate">
          <Server class="size-3.5 flex-shrink-0" />
          {agentName}
        </span>
        {#if timeAgo}
          <span class="flex items-center gap-1.5">
            <Clock class="size-3.5 flex-shrink-0" />
            {timeAgo}
          </span>
        {/if}
      </div>

      {#if instance.cwd}
        <p class="mt-1.5 text-xs text-muted-foreground/60 font-mono truncate">
          {instance.cwd}
        </p>
      {/if}
    </div>

    <!-- Arrow -->
    <ChevronRight class="size-4 text-muted-foreground/40 group-hover:text-primary
                         group-hover:translate-x-0.5 transition-all flex-shrink-0" />
  </div>
</a>
