<script lang="ts">
  /**
   * One tool call, read as a sentence: what it did, to what, and what came
   * back. The same row serves a group of calls and a call standing on its own,
   * so a transcript only ever teaches the reader one tool grammar.
   *
   * The glyph's hue is the tool's family, not its outcome. Success stays
   * silent: a finished step earns no colour of its own — only a step that is
   * still running, or one that failed, says anything about how it went.
   */
  import { untrack } from 'svelte';
  import { fade, fly } from 'svelte/transition';
  import { quintOut } from 'svelte/easing';
  import { IconCheck, IconChevronRight, IconError, IconSpinner } from '$lib/icons';
  import * as Collapsible from '$lib/components/ui/collapsible';
  import { Button } from '$lib/components/ui/button';
  import DiffView from '../DiffView.svelte';
  import AgentCode from './AgentCode.svelte';
  import OutputBlock from './OutputBlock.svelte';
  import ParamsTable from './ParamsTable.svelte';
  import {
    codeOf,
    describeTool,
    errorLine,
    familyId,
    getDiffInfo,
    isErrorLine,
    pathLeaf,
    type ToolStatus,
  } from './descriptors';
  import { languageForPath } from './agent-code';

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

  /**
   * The file a Read answered with, which is the only body in the `read` shape
   * that is a file at all — grep and glob answer with matches and names, and
   * painting those in some file's grammar would be a guess.
   */
  const readPath = $derived.by(() => {
    if (familyId(toolName) !== 'read') return undefined;
    const path = input?.file_path ?? input?.path;
    return typeof path === 'string' && path.length > 0 ? path : undefined;
  });

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
  <Collapsible.Trigger class="group/toolcard w-full text-left">
    <div
      class="trow {status === 'error' ? 'bad' : ''}"
      in:fly={{ y: 4, duration: entering ? 160 : 0, easing: quintOut }}
    >
      <!-- The family glyph steps aside for the disclosure chevron on hover. -->
      <span class="ic">
        {#if descriptor.favicon && !faviconFailed}
          <img
            src={descriptor.favicon}
            alt=""
            class="fav"
            loading="lazy"
            onerror={() => (faviconFailed = true)}
          />
        {:else}
          {@const Glyph = descriptor.icon}
          <Glyph class="glyph {descriptor.color}" />
        {/if}
        <IconChevronRight class="chev {open ? 'open' : ''}" />
      </span>

      {#if descriptor.label}
        <span class="tk">{descriptor.label}</span>
      {/if}

      <!-- The object leads the mono target; its dir, chip and first output line
           trail off as dimmer continuations and truncate together. -->
      <span class="arg" title={descriptor.object}>
        {#if descriptor.object}<span class={descriptor.objectIsMono ? 'mono' : ''}
            >{descriptor.object}</span
          >{/if}{#if descriptor.detail}<span class="dim"> · {descriptor.detail}</span>{/if}{#if descriptor.chip}<span
            class="dim"
          >
            · {descriptor.chip}</span
          >{/if}{#if tail}<span class="dim {failure ? 'err' : ''}"> — {tail}</span>{/if}
      </span>

      {#if descriptor.fact}
        {@const parts = descriptor.fact.split(' ')}
        {#if descriptor.factTone === 'diff'}
          <!-- Diff green and red are the diff's own reading, not a status. -->
          <span class="d">
            <span class="add">{parts[0]}</span>{#if parts[1]}<span class="del"> {parts[1]}</span
              >{/if}
          </span>
        {:else}
          <span class="fact">{descriptor.fact}</span>
        {/if}
      {/if}

      {#if status === 'pending' || justFinished}
        <span class="stat" out:fade={{ duration: 240 }}>
          {#if status === 'pending'}
            <IconSpinner class="size-4 animate-spin text-warning motion-reduce:animate-none" />
          {:else}
            <IconCheck class="size-4 text-success" />
          {/if}
        </span>
      {:else if status === 'error'}
        <IconError class="stat text-error" />
      {/if}
    </div>
  </Collapsible.Trigger>

  <Collapsible.Content>
    <div class="ml-[22px] space-y-2 border-l border-border/50 py-2 pr-3 pl-4">
      {#if descriptor.expanded === 'bash'}
        <div class="max-h-[320px] overflow-auto rounded-lg bg-muted/50 p-3 font-mono text-micro">
          <!-- Every line of `command` is command, continuations and heredoc
               body included, so the whole of it is painted. The sigil is the
               well's own punctuation, not part of what was run. -->
          <div class="whitespace-pre-wrap break-all text-muted-foreground">
            <span class="select-none">$&nbsp;</span><AgentCode
              code={command}
              language="bash"
              inline
            />
          </div>
          <!-- What came back is data, not code: run through the same grammar,
               a log's prose would light up wherever it happened to say `do` or
               `in`, and a path would read as an operator. Output stays plain
               mono, tinted only where the line itself reports a failure. -->
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
        {#if code}<OutputBlock text={code} caption="Code" language="javascript" />{/if}
        {#if result}<OutputBlock text={result} caption="Output" />{/if}
      {:else if descriptor.expanded === 'web' && result}
        <OutputBlock text={result} caption={url} captionIsMono />
      {:else if descriptor.expanded === 'read' && result}
        <OutputBlock
          text={result}
          language={readPath ? (languageForPath(readPath) ?? undefined) : undefined}
          filename={readPath ? pathLeaf(readPath) : undefined}
        />
      {:else}
        <ParamsTable {input} {result} />
      {/if}
    </div>
  </Collapsible.Content>
</Collapsible.Root>

<style>
  /* One tool call, read as a compact row on the turn's rail: a family glyph, a
     verb, a mono target, and what came back — never a card. */
  .trow {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 26px;
    padding: 2px 6px 2px 0;
    font-size: var(--text-sm);
    color: var(--ink-body);
    cursor: pointer;
    border-radius: var(--radius-mark);
    transition: background-color 0.12s ease;
  }
  @media (hover: hover) and (pointer: fine) {
    .trow:hover {
      background: var(--surface-hover);
    }
  }
  .trow.bad {
    color: var(--data-bad);
  }

  /* The glyph and the disclosure chevron share one 15px cell; the chevron fades
     in over the glyph on hover. */
  .ic {
    position: relative;
    width: 15px;
    height: 15px;
    flex: 0 0 auto;
    display: grid;
    place-items: center;
    color: var(--ink-muted);
  }
  .ic :global(svg) {
    width: 15px;
    height: 15px;
    display: block;
  }
  .ic .fav {
    width: 15px;
    height: 15px;
    border-radius: 999px;
    object-fit: cover;
    box-shadow: 0 0 0 1px var(--border-hairline);
  }
  .ic .fav,
  .ic :global(svg:not(.chev)) {
    transition: opacity 0.15s ease;
  }
  .ic :global(svg.chev) {
    position: absolute;
    inset: 0;
    margin: auto;
    color: var(--ink-muted);
    opacity: 0;
    transition:
      opacity 0.15s ease,
      transform 0.2s ease;
  }
  .ic :global(svg.chev.open) {
    transform: rotate(90deg);
  }
  @media (hover: hover) and (pointer: fine) {
    .trow:hover .ic .fav,
    .trow:hover .ic :global(svg:not(.chev)) {
      opacity: 0;
    }
    .trow:hover .ic :global(svg.chev) {
      opacity: 1;
    }
  }

  .tk {
    flex: 0 0 auto;
    font-weight: var(--weight-strong);
    color: var(--ink-strong);
    white-space: nowrap;
  }
  .trow.bad .tk {
    color: var(--data-bad);
  }

  .arg {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono);
    color: var(--ink-muted);
  }
  .arg .dim {
    color: var(--ink-muted);
    opacity: 0.72;
  }
  .arg .dim.err {
    color: var(--data-bad);
    opacity: 1;
    font-family: var(--font-body);
  }

  .d,
  .fact {
    flex: 0 0 auto;
    font-variant-numeric: tabular-nums;
    font-size: var(--text-sm);
  }
  .fact {
    color: var(--ink-muted);
  }
  .d .add {
    color: var(--data-ok);
  }
  .d .del {
    color: var(--data-bad);
  }

  .stat {
    flex: 0 0 auto;
    width: 16px;
    height: 16px;
    display: grid;
    place-items: center;
  }
</style>
