<script lang="ts">
  /** One stored session from `listSessions`, linking to its read-only transcript. */
  import type { SDKSessionInfo } from '@cockpit/core';
  import { formatDistanceToNow } from '$lib/utils/time';
  import { sessionTitle, transcriptHref } from './links';

  let { machineId, info }: { machineId: string; info: SDKSessionInfo } = $props();
</script>

<a
  href={transcriptHref(machineId, info)}
  class="flex flex-col rounded-lg border border-border px-3 py-2 transition-colors hover:bg-accent"
>
  <span class="flex items-baseline gap-3">
    <span class="truncate text-sm">{sessionTitle(info)}</span>
    <span class="ml-auto shrink-0 text-xs text-muted-foreground">
      {formatDistanceToNow(new Date(info.lastModified))}
    </span>
  </span>
  <span class="truncate font-mono text-xs text-muted-foreground">{info.cwd ?? ''}</span>
</a>
