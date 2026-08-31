<script lang="ts">
  /** One stored session from `listSessions`, linking to its read-only transcript. */
  import type { SDKSessionInfo } from '@cockpit/core';
  import { dragSession } from './workspace/dnd.svelte';
  import { formatDistanceToNow } from '$lib/utils/time';
  import { sessionTitle, transcriptHref } from './links';
  import StoredSessionMenu from './StoredSessionMenu.svelte';
  import { markHue, sessionSprite } from './mark';

  interface Props {
    machineId: string;
    info: SDKSessionInfo;
    /** The card's own path: a row repeating it adds nothing, so it stays off. */
    groupCwd?: string;
  }

  let { machineId, info, groupCwd }: Props = $props();

  const showCwd = $derived(Boolean(info.cwd) && info.cwd !== groupCwd);

  // Distinct per stored session (seeded by its SDK session id). These rows all
  // drew the same cube before; the sprite gives each transcript its own face.
  const Sprite = $derived(sessionSprite(info.sessionId));
</script>

<StoredSessionMenu {machineId} {info}>
  <a
    use:dragSession={{
      sessionId: info.sessionId,
      from: null,
      ctx: () => ({ machine: machineId, cwd: info.cwd ?? '', harness: info.harness ?? 'claude' }),
    }}
    href={transcriptHref(machineId, info)}
    class="flex min-h-9 items-center rounded-[var(--radius-control)] px-4 py-1.5
      transition-colors duration-150 ease-out hover:bg-accent hover:text-accent-foreground"
  >
    <!-- Full-width band, measured content: the same bargain the live rows make. -->
    <span class="flex w-full max-w-3xl items-center gap-3">
      <!-- Where a live row carries its state dot and the card's header carries
           its mark, so a card has one title column top to bottom. -->
      <span
        class="flex shrink-0 items-center justify-center opacity-60"
        style="--c-mark:20px;--c-mark-glyph:11px"
        aria-hidden="true"
      >
        <span class="mark m{markHue(info.cwd || machineId)}">
          <Sprite aria-hidden="true" />
        </span>
      </span>
      <!-- Stops at a readable measure, as the live rows do, so a runaway title
           does not crush the path beside it. -->
      <span class="min-w-0 max-w-lg truncate text-[13px]">{sessionTitle(info)}</span>
      <!-- Beside the title, as the live rows carry it: it yields three times as
           readily, and what it keeps it gives up from the left — the leaf is
           what tells two checkouts apart. -->
      {#if showCwd}
        <span
          class="hidden min-w-24 shrink-[3] truncate font-mono text-micro text-muted-foreground [direction:rtl] sm:block"
          title={info.cwd}
        ><bdi>{info.cwd}</bdi></span>
      {/if}
      <span class="ml-auto shrink-0 text-micro text-muted-foreground tabular-nums" data-tabular>
        {formatDistanceToNow(new Date(info.lastModified))}
      </span>
    </span>
  </a>
</StoredSessionMenu>

<style>
  /* Item mark — inlined token primitive (identity hue + harness glyph, top-light
     overlay). No clean shadcn equivalent; kept identical in recipe across the
     four sidebar-cluster files. Size comes from --c-mark / --c-mark-glyph set on
     the wrapper. */
  .mark {
    width: var(--c-mark);
    height: var(--c-mark);
    border-radius: var(--radius-mark);
    flex: 0 0 auto;
    display: grid;
    place-items: center;
    background-image: var(--mark-overlay);
    background-color: var(--mark-1);
  }
  .mark :global(svg) {
    width: var(--c-mark-glyph);
    height: var(--c-mark-glyph);
    display: block;
    color: var(--mark-glyph);
  }
  .mark.m2 { background-color: var(--mark-2); }
  .mark.m3 { background-color: var(--mark-3); }
  .mark.m4 { background-color: var(--mark-4); }
  .mark.m5 { background-color: var(--mark-5); }
  .mark.m6 { background-color: var(--mark-6); }
  .mark.m7 { background-color: var(--mark-7); }
  .mark.m8 { background-color: var(--mark-8); }
</style>
