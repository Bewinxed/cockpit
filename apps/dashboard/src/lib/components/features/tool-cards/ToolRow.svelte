<script lang="ts">
  /**
   * One tool call, read as a sentence: what it did, to what, and what came
   * back. The same row serves a group of calls and a call standing on its own,
   * so a transcript only ever teaches the reader one tool grammar.
   *
   * Success is silent. A finished step earns no colour — only a step that is
   * still running, or one that failed, says anything in a hue.
   */
  import { untrack } from 'svelte';
  import { fade, fly } from 'svelte/transition';
  import { quintOut } from 'svelte/easing';
  import { IconCheck, IconChevronRight, IconError, IconSpinner } from '$lib/icons';
  import * as Collapsible from '$lib/components/ui/collapsible';
  import { Button } from '$lib/components/ui/button';
  import DiffView from '../DiffView.svelte';
  import OutputBlock from './OutputBlock.svelte';
  import ParamsTable from './ParamsTable.svelte';
  import {
    codeOf,
    describeTool,
    errorLine,
    getDiffInfo,
    isErrorLine,
    type ToolStatus,
  } from './descriptors';

  interface Props {
    toolName?: string;
    input?: Record<string, unknown>;
    result?: string;
    status: ToolStatus;
    open: boolean;
    onToggle: () => void;
    /**
     * Hands a diff to a modal the caller owns. Without it the diff view's own
     * maximise affordance stands in, so a solo card needs no plumbing.
     */
    onOpenDiff?: (filePath: string, oldContent: string, newContent: string) => void;
  }

  let { toolName, input, result, status, open, onToggle, onOpenDiff }: Props = $props();

  const descriptor = $derived(describeTool(toolName, input, result, status));
  const diff = $derived(descriptor.expanded === 'diff' ? getDiffInfo(input, toolName) : null);
  const command = $derived(typeof input?.command === 'string' ? input.command : '');
  const code = $derived(codeOf(input));
  const url = $derived(typeof input?.url === 'string' ? input.url : undefined);

  /** What went wrong, which replaces the tail on a failed row. */
  const failure = $derived(status === 'error' ? errorLine(result) : undefined);
  /** The tail stands in for the body, so it steps aside once the body is open. */
  const tail = $derived(failure ?? (open ? undefined : descriptor.secondLine));

  /** A favicon that never arrived leaves the family glyph in place. */
  let faviconFailed = $state(false);

  /**
   * A call that finishes while you are watching gets one beat of green and
   * then goes quiet; a stored transcript never passes through `pending`, so it
   * never lights up at all. Deliberately not `$state`: the effect writes it,
   * and a reactive latch would re-run the effect and clear its own timeout.
   */
  let sawPending = untrack(() => status === 'pending');
  let justFinished = $state(false);

  $effect(() => {
    const now = status;
    if (now === 'pending') {
      sawPending = true;
      return;
    }
    if (!sawPending) return;
    sawPending = false;
    if (now !== 'success') return;
    justFinished = true;
    const timer = setTimeout(() => (justFinished = false), 900);
    return () => clearTimeout(timer);
  });

  /** Rows read back from storage arrive already finished; they mount static. */
  const entering = untrack(() => status === 'pending');
</script>

<Collapsible.Root {open} onOpenChange={onToggle}>
  <Collapsible.Trigger class="w-full text-left">
    <div
      class="flex min-h-9 w-full cursor-pointer items-start gap-2 px-3 py-2 transition-colors
        {status === 'error' ? 'bg-error/10 hover:bg-error/15' : 'hover:bg-accent/40'}"
      in:fly={{ y: 4, duration: entering ? 160 : 0, easing: quintOut }}
    >
      <IconChevronRight
        class="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform duration-200 {open
          ? 'rotate-90'
          : ''}"
      />

      <span class="mt-0.5 flex size-4 shrink-0 items-center justify-center">
        {#if descriptor.favicon && !faviconFailed}
          <img
            src={descriptor.favicon}
            alt=""
            class="size-4 rounded-full object-cover ring-1 ring-border"
            loading="lazy"
            onerror={() => (faviconFailed = true)}
          />
        {:else}
          {@const Glyph = descriptor.icon}
          <Glyph class="size-4 text-muted-foreground" />
        {/if}
      </span>

      <span class="flex min-w-0 flex-1 flex-col gap-0.5">
        <span class="flex min-w-0 items-baseline gap-1.5">
          {#if descriptor.label}
            <span class="shrink-0 text-[13px] leading-5 text-foreground">{descriptor.label}</span>
          {/if}
          {#if descriptor.object}
            <span
              class="min-w-0 truncate {descriptor.objectIsMono
                ? 'font-mono text-micro'
                : 'text-[13px]'} {descriptor.label ? 'text-muted-foreground' : 'text-foreground'}"
              title={descriptor.object}
            >
              {descriptor.object}
            </span>
          {/if}
          {#if descriptor.detail}
            <!-- The dir yields three times as fast as the leaf and truncates
                 from the left, because the deep end is what tells two
                 checkouts apart. -->
            <span
              class="hidden max-w-[45%] min-w-0 shrink-[9] truncate text-muted-foreground sm:inline
                {descriptor.detailIsMono ? 'font-mono text-micro [direction:rtl]' : 'text-micro'}"
              title={descriptor.detail}
            >
              <bdi>{descriptor.detail}</bdi>
            </span>
          {/if}
          {#if descriptor.chip}
            <span
              class="hidden shrink-0 rounded-md bg-muted px-1.5 py-px text-micro text-muted-foreground sm:inline"
            >
              {descriptor.chip}
            </span>
          {/if}
        </span>

        {#if tail}
          <span
            class="block truncate font-mono text-micro {failure
              ? 'text-error'
              : 'text-muted-foreground'}"
          >
            {tail}
          </span>
        {/if}
      </span>

      {#if descriptor.fact}
        {@const parts = descriptor.fact.split(' ')}
        <span class="mt-0.5 ml-auto shrink-0 text-micro tabular-nums text-muted-foreground">
          {#if descriptor.factTone === 'diff'}
            <!-- Diff green and red are the diff's own reading, not a status. -->
            <span class="text-success">{parts[0]}</span>
            {#if parts[1]}<span class="ml-1 text-error">{parts[1]}</span>{/if}
          {:else}
            {descriptor.fact}
          {/if}
        </span>
      {/if}

      <span class="mt-0.5 flex size-4 shrink-0 items-center justify-center">
        {#if status === 'pending' || justFinished}
          <span class="icon-swap size-4" out:fade={{ duration: 240 }}>
            <IconSpinner
              class="size-4 animate-spin text-warning motion-reduce:animate-none"
              data-active={status === 'pending'}
            />
            <IconCheck class="size-4 text-success" data-active={justFinished} />
          </span>
        {:else if status === 'error'}
          <IconError class="size-4 text-error" />
        {/if}
      </span>
    </div>
  </Collapsible.Trigger>

  <Collapsible.Content>
    <div class="ml-[22px] space-y-2 border-l border-border/50 py-2 pr-3 pl-4">
      {#if descriptor.expanded === 'bash'}
        <div class="max-h-[320px] overflow-auto rounded-lg bg-muted/50 p-3 font-mono text-micro">
          <div class="whitespace-pre-wrap break-all text-muted-foreground">
            <span class="select-none">$&nbsp;</span>{command}
          </div>
          {#if result && status === 'error'}
            <div class="mt-1.5">
              {#each result.split('\n') as line, i (i)}
                <span
                  class="block whitespace-pre-wrap break-all {isErrorLine(line)
                    ? 'text-error'
                    : 'text-foreground'}">{line || ' '}</span
                >
              {/each}
            </div>
          {:else if result}
            <pre class="mt-1.5 whitespace-pre-wrap break-all text-foreground">{result}</pre>
          {/if}
        </div>
      {:else if descriptor.expanded === 'diff' && diff}
        <DiffView
          filePath={diff.filePath}
          oldContent={diff.oldContent}
          newContent={diff.newContent}
        />
        {#if onOpenDiff}
          <div class="flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              onclick={(event: MouseEvent) => {
                event.stopPropagation();
                onOpenDiff(diff.filePath, diff.oldContent, diff.newContent);
              }}
            >
              Open in modal
            </Button>
          </div>
        {/if}
      {:else if descriptor.expanded === 'code'}
        {#if code}<OutputBlock text={code} caption="Code" />{/if}
        {#if result}<OutputBlock text={result} caption="Output" />{/if}
      {:else if descriptor.expanded === 'web' && result}
        <OutputBlock text={result} caption={url} captionIsMono />
      {:else if descriptor.expanded === 'read' && result}
        <OutputBlock text={result} />
      {:else}
        <ParamsTable {input} {result} />
      {/if}
    </div>
  </Collapsible.Content>
</Collapsible.Root>
