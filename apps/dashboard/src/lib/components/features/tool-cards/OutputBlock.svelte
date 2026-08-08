<script lang="ts">
  /**
   * What a call printed, in the one well every expanded row uses: untinted, so
   * a failed call's output stays as readable as a successful one's.
   */
  interface Props {
    text: string;
    /** What the block is, when the row's sentence has not already said it. */
    caption?: string;
    /** Rendered mono, for a url or a path standing over its own output. */
    captionIsMono?: boolean;
  }

  let { text, caption, captionIsMono = false }: Props = $props();
</script>

<div class="max-h-[320px] overflow-auto rounded-lg bg-muted/50 p-3">
  {#if caption}
    <div
      class="mb-1.5 truncate {captionIsMono
        ? 'font-mono text-micro text-muted-foreground'
        : 'text-caption'}"
      title={caption}
    >
      {caption}
    </div>
  {/if}
  <pre class="font-mono text-micro whitespace-pre-wrap break-all text-foreground">{text}</pre>
</div>
