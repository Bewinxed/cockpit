<script lang="ts">
  /** One stored session from `listSessions`, linking to its read-only transcript. */
  import type { SDKSessionInfo } from '@cockpit/core';
  import { formatDistanceToNow } from '$lib/utils/time';
  import { sessionTitle, transcriptHref } from './links';
  import StoredSessionMenu from './StoredSessionMenu.svelte';

  let { machineId, info }: { machineId: string; info: SDKSessionInfo } = $props();
</script>

<StoredSessionMenu {machineId} {info}>
  <a
    href={transcriptHref(machineId, info)}
    class="flex min-h-9 items-center gap-2.5 rounded-lg px-3 py-1.5
      transition-colors duration-150 ease-out hover:bg-accent hover:text-accent-foreground"
  >
    <!-- Where a live row carries its state dot, so the two lists a machine card
         stacks share one title column. -->
    <span class="size-2 shrink-0" aria-hidden="true"></span>
    <span class="min-w-0 flex-[3_1_0] truncate text-[13px]">{sessionTitle(info)}</span>
    <!-- Second to the title for room, and what it keeps it gives up from the
         left — the leaf is what tells two checkouts apart. -->
    <span
      class="hidden min-w-0 flex-[2_1_0] truncate font-mono text-micro text-muted-foreground [direction:rtl] sm:block"
      title={info.cwd ?? ''}
    ><bdi>{info.cwd ?? ''}</bdi></span>
    <span class="shrink-0 text-micro text-muted-foreground tabular-nums" data-tabular>
      {formatDistanceToNow(new Date(info.lastModified))}
    </span>
  </a>
</StoredSessionMenu>
