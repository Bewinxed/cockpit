<script lang="ts">
  import type { HookEvent, HookMatcherKind } from '@cockpit/core';
  import { hookEventInfo, hookMatcherKind, hookMatches } from '@cockpit/core';
  import { Badge } from '$lib/components/ui/badge';
  import { Input } from '$lib/components/ui/input';

  /**
   * The part of the editor that tells the truth about a matcher.
   *
   * Claude Code reads a matcher through a three-way branch — empty/`*` matches
   * everything, a plain word or `a|b` list matches exactly, anything else is an
   * unanchored regular expression — and the branch is entirely about which
   * characters appear, never about intent. `Edit.*` really does match
   * `NotebookEdit`, and a reader who typed a dot meaning a literal dot has
   * written a regex without knowing it. This box names which of the three
   * readings the matcher got, then proves it against a sample the reader
   * types, with the same {@link hookMatches} the fleet fires on.
   */
  let {
    event,
    matcher = $bindable(''),
    sample = $bindable(''),
  }: { event: HookEvent; matcher?: string; sample?: string } = $props();

  const info = $derived(hookEventInfo(event));
  const kind = $derived(hookMatcherKind(matcher, event));

  const KIND_LABEL: Record<HookMatcherKind, string> = {
    all: 'Matches everything',
    exact: 'Exact match',
    regex: 'Regular expression',
  };
  const KIND_TONE: Record<HookMatcherKind, string> = {
    all: 'border-border text-muted-foreground',
    exact: 'border-success text-success',
    regex: 'border-warning text-warning',
  };
  const KIND_HOW: Record<HookMatcherKind, string> = {
    all: 'An empty matcher or a bare * runs on every value this event carries.',
    exact: 'Only letters, digits, dashes, underscores and separators appear, so this is read literally — it matches one of the values on either side of a | or ,.',
    regex: 'A character outside the plain set turns the whole matcher into an unanchored regular expression — it can match part of a value, and a dot matches any character, not just a literal dot.',
  };

  const hit = $derived(sample.trim() ? hookMatches(matcher, sample, event) : null);
</script>

<div class="flex flex-col gap-2 rounded-[var(--radius-card)] bg-muted/40 p-4">
  <div class="flex flex-wrap items-center gap-2">
    <Badge variant="outline" class="shrink-0 {KIND_TONE[kind]}">{KIND_LABEL[kind]}</Badge>
    <span class="text-micro text-muted-foreground">{KIND_HOW[kind]}</span>
  </div>

  {#if info?.suggests && info.suggests.length > 0}
    <div class="flex flex-wrap items-center gap-1.5">
      <span class="text-micro text-muted-foreground">Real values:</span>
      {#each info.suggests as suggestion (suggestion)}
        <button
          type="button"
          class="rounded-[var(--radius-pill)] border border-border px-2 py-0.5 font-mono text-micro text-foreground transition-colors hover:bg-accent"
          onclick={() => (matcher = suggestion)}
        >
          {suggestion}
        </button>
      {/each}
    </div>
  {/if}

  <label class="flex flex-col gap-1.5 text-caption">
    Try it — {info?.filters ?? 'the value this event carries'}
    <Input
      bind:value={sample}
      autocomplete="off"
      spellcheck="false"
      placeholder={info?.suggests?.[0] ?? 'a sample value'}
      class="font-mono text-sm md:text-sm"
    />
  </label>

  {#if sample.trim()}
    <p
      class="text-micro transition-colors duration-240 ease-[var(--e-in)] {hit ? 'text-success' : 'text-muted-foreground'}"
      role="status"
      aria-live="polite"
    >
      {hit ? 'Matches — this hook would fire.' : 'No match — this hook would stay quiet for this value.'}
    </p>
  {/if}
</div>
