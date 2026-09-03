<script lang="ts">
  import { quintOut } from "svelte/easing";
  import { prefersReducedMotion } from "svelte/motion";
  /**
   * Where an answer's facts came from. Closed it is one line — three favicons
   * and a count — because a turn that read the web says so quietly; opened it
   * is one row per page, each a link out to the thing itself.
   *
   * Only pages this turn's own calls named reach here (see `sources.ts`), so
   * there is no empty state: an answer with nothing to cite renders nothing.
   */
  import { fly } from "svelte/transition";
  import * as Collapsible from "$lib/components/ui/collapsible";
  import { IconChevronRight } from "$lib/icons";
  import { faviconFor, type SourceRef } from "$lib/whiffle/sources";

  interface Props {
    sources: SourceRef[];
  }

  let { sources }: Props = $props();

  /** Faces on the closed strip. Past this the count is what says how many. */
  const STACKED = 3;
  /** Rows enter one after another; the last must not arrive after the reading eye. */
  const STAGGER = 30;

  let open = $state(false);
  /** Hosts whose icon never arrived — they wear their initial instead. */
  let failed = $state<Record<string, boolean>>({});
</script>

{#snippet favicon(source: SourceRef)}
  <!-- Ringed so the overlap reads on any colour the icons happen to be. -->
  <span
    class="size-4 shrink-0 overflow-hidden rounded-full bg-muted ring-2 ring-background"
  >
    {#if failed[source.host]}
      <span
        aria-hidden="true"
        class="flex size-full items-center justify-center text-micro leading-none font-medium
               text-muted-foreground uppercase"
      >
        {source.host.charAt(0)}
      </span>
    {:else}
      <img
        alt=""
        class="size-full object-cover"
        loading="lazy"
        onerror={() => (failed[source.host] = true)}
        src={faviconFor(source.host)}
      >
    {/if}
  </span>
{/snippet}

<Collapsible.Root class="mt-2" bind:open>
  <Collapsible.Trigger
    class="group -ml-1 flex min-h-9 items-center gap-2 rounded-[var(--radius-control)] px-1 transition-colors hover:bg-accent/40"
  >
    <span aria-hidden="true" class="flex -space-x-1.5">
      {#each sources.slice(0, STACKED) as source (source.url)}
        {@render favicon(source)}
      {/each}
    </span>
    <span class="text-micro text-muted-foreground" data-tabular>
      {sources.length}
      {sources.length === 1 ? 'source' : 'sources'}
    </span>
    <IconChevronRight
      class="size-3.5 text-muted-foreground transition-transform duration-200 ease-out {open
        ? 'rotate-90'
        : ''}"
    />
  </Collapsible.Trigger>

  <Collapsible.Content>
    <div class="flex flex-col pt-0.5">
      {#each sources as source, index (source.url)}
        <a
          class="flex min-h-9 items-center gap-2.5 rounded-[var(--radius-control)] px-1 transition-colors hover:bg-accent/40"
          href={source.url}
          rel="noopener noreferrer"
          target="_blank"
          in:fly={{
            y: prefersReducedMotion.current ? 0 : 4,
            duration: prefersReducedMotion.current ? 120 : 180,
            delay: prefersReducedMotion.current ? 0 : index * STAGGER,
            easing: quintOut,
          }}
        >
          {@render favicon(source)}
          <span class="min-w-0 flex-1 truncate text-[13px] text-foreground">
            {source.title ?? source.url}
          </span>
          <span class="shrink-0 font-mono text-micro text-muted-foreground"
            >{source.host}</span
          >
        </a>
      {/each}
    </div>
  </Collapsible.Content>
</Collapsible.Root>
