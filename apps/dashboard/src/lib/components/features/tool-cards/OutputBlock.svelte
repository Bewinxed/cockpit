<script lang="ts">
  /**
   * What a call printed, in the one well every expanded row uses: untinted, so
   * a failed call's output stays as readable as a successful one's.
   *
   * Told what it is looking at, the same well is a code surface — coloured by
   * its grammar, named by the file it came from, and copyable. Told nothing, it
   * is the plain log it has always been: a copy button buys a log nothing, and
   * a header over it would only be one more line to read past.
   */
  import { CopyButton } from '$lib/components/ui/copy-button';
  import AgentCode from './AgentCode.svelte';
  import { agentCodeLanguage } from './agent-code';

  interface Props {
    text: string;
    /** What the block is, when the row's sentence has not already said it. */
    caption?: string;
    /** Rendered mono, for a url or a path standing over its own output. */
    captionIsMono?: boolean;
    /** The grammar to paint `text` with; a word we have no grammar for stays plain. */
    language?: string;
    /** The file the text came from, named over it. */
    filename?: string;
    /** A gutter of line numbers, for a listing whose lines get cited. */
    lineNumbers?: boolean;
    /** On by default once there is code to copy; off for a plain log. */
    copyable?: boolean;
  }

  let {
    text,
    caption,
    captionIsMono = false,
    language,
    filename,
    lineNumbers = false,
    copyable,
  }: Props = $props();

  const grammar = $derived(agentCodeLanguage(language));
  const canCopy = $derived(copyable ?? Boolean(language || filename));
  /** The file wins over the caption: it says the same thing, more precisely. */
  const heading = $derived(filename ?? caption);
  const header = $derived(Boolean(filename || language || canCopy));
</script>

<div class="overflow-hidden rounded-lg bg-muted/50">
  {#if header}
    <div class="flex h-9 items-center gap-2 border-b border-border/50 px-3">
      {#if heading}
        <span
          class="min-w-0 flex-1 truncate {filename || captionIsMono
            ? 'font-mono text-micro text-muted-foreground'
            : 'text-caption'}"
          title={heading}
        >
          {heading}
        </span>
      {/if}
      <div class="ml-auto flex shrink-0 items-center gap-2">
        {#if language}
          <span class="text-micro lowercase text-muted-foreground">{language}</span>
        {/if}
        {#if canCopy}
          <CopyButton {text} size="icon-sm" class="-mr-1.5 text-muted-foreground" />
        {/if}
      </div>
    </div>
  {/if}

  <div class="max-h-[320px] overflow-auto p-3">
    {#if caption && !header}
      <div
        class="mb-1.5 truncate {captionIsMono
          ? 'font-mono text-micro text-muted-foreground'
          : 'text-caption'}"
        title={caption}
      >
        {caption}
      </div>
    {/if}
    {#if grammar}
      <AgentCode code={text} language={grammar} {lineNumbers} />
    {:else}
      <pre class="font-mono text-micro whitespace-pre-wrap break-all text-foreground">{text}</pre>
    {/if}
  </div>
</div>
