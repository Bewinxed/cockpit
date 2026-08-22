<script lang="ts">
  /**
   * The floating composer — a lifted shell holding the text input, a context-%
   * readout, and any inline permission / question prompts stacked above it. Home,
   * this input, and Stop are the surface's fixed anchors; the button is a single
   * box that sends when idle and interrupts while a turn is in flight. Ported
   * from the mock's `.composer` / `.cin`.
   */
  import type { Snippet } from 'svelte';
  import { IconSend, IconStop, IconPlus, IconClose } from '$lib/icons';
  import type { SendExtras } from '../client.svelte';

  let {
    value = $bindable(''),
    busy = false,
    onsubmit,
    onstop,
    prompts,
  }: {
    value?: string;
    busy?: boolean;
    onsubmit: (text: string, extras: SendExtras) => void;
    onstop: () => void;
    prompts?: Snippet;
  } = $props();

  type PendingImage = { mediaType: string; data: string; name: string };
  type PendingText = { kind: 'text'; name: string; content: string };

  let images = $state<PendingImage[]>([]);
  let texts = $state<PendingText[]>([]);
  let fileInput = $state<HTMLInputElement>();

  /** A paste longer than this rides as a named attachment, not inline text. */
  const LARGE_PASTE = 1200;

  const hasContent = $derived(
    value.trim().length > 0 || images.length > 0 || texts.length > 0
  );

  function submit(): void {
    if (!hasContent) return;
    const extras: SendExtras = {};
    if (texts.length) extras.attachments = texts.map((t) => ({ ...t }));
    if (images.length) extras.images = images.map((i) => ({ mediaType: i.mediaType, data: i.data }));
    const text = value.trim();
    value = '';
    images = [];
    texts = [];
    onsubmit(text, extras);
  }

  function onkeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  function onaction(): void {
    if (busy) onstop();
    else submit();
  }

  /** base64 without the `data:` prefix — the wire shape images travel in. */
  function readImage(file: File): Promise<PendingImage> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result);
        resolve({ mediaType: file.type, data: result.slice(result.indexOf(',') + 1), name: file.name });
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  async function addFiles(files: Iterable<File>): Promise<void> {
    for (const file of files) {
      if (file.type.startsWith('image/')) {
        images = [...images, await readImage(file)];
      } else {
        texts = [...texts, { kind: 'text', name: file.name, content: await file.text() }];
      }
    }
  }

  function onpick(event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    if (input.files?.length) void addFiles(input.files);
    input.value = '';
  }

  function onpaste(event: ClipboardEvent): void {
    const data = event.clipboardData;
    if (!data) return;
    const files = [...data.items]
      .filter((item) => item.kind === 'file')
      .map((item) => item.getAsFile())
      .filter((file): file is File => !!file);
    if (files.length) {
      event.preventDefault();
      void addFiles(files);
      return;
    }
    const text = data.getData('text/plain');
    if (text.length > LARGE_PASTE) {
      event.preventDefault();
      texts = [...texts, { kind: 'text', name: `Pasted text · ${text.length.toLocaleString()} chars`, content: text }];
    }
  }

  const removeImage = (i: number) => (images = images.filter((_, n) => n !== i));
  const removeText = (i: number) => (texts = texts.filter((_, n) => n !== i));
</script>

<div class="fade"></div>
<div class="composer">
  {#if prompts}
    <div class="prompts">{@render prompts()}</div>
  {/if}
  {#if images.length || texts.length}
    <div class="atts">
      {#each images as img, i (img.name + i)}
        <span class="att">
          <img src="data:{img.mediaType};base64,{img.data}" alt="" />
          {img.name}
          <button type="button" aria-label="Remove" onclick={() => removeImage(i)}><IconClose /></button>
        </span>
      {/each}
      {#each texts as t, i (t.name + i)}
        <span class="att">
          {t.name}
          <button type="button" aria-label="Remove" onclick={() => removeText(i)}><IconClose /></button>
        </span>
      {/each}
    </div>
  {/if}
  <form class="cin" onsubmit={(e) => e.preventDefault()} aria-label="Message the agent">
    <input
      type="file"
      class="hidden-file"
      accept="image/*,text/*,.md,.json,.csv,.log"
      multiple
      bind:this={fileInput}
      onchange={onpick}
    />
    <textarea
      bind:value
      {onkeydown}
      onpaste={onpaste}
      placeholder="Message the agent…"
      aria-label="Message the agent"
    ></textarea>
    <div class="aff-row">
      <div class="inner">
        <span>/ commands</span><span>@ mention</span>
        <span class="hint">Enter sends · Shift+Enter for a new line</span>
      </div>
    </div>
    <div class="ctrls">
      <button
        class="att-btn"
        type="button"
        onclick={() => fileInput?.click()}
        aria-label="Attach a file or image"
      >
        <IconPlus />
      </button>
      <button
        class="stop"
        type="button"
        onclick={onaction}
        disabled={!busy && !hasContent}
        aria-label={busy ? 'Stop the agent' : 'Send message'}
      >
        {#if busy}<IconStop />{:else}<IconSend />{/if}
      </button>
    </div>
  </form>
</div>

<style>
  .fade {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 96px;
    pointer-events: none;
    z-index: 19;
    background: linear-gradient(
      to top,
      var(--surface-field) 22%,
      oklch(from var(--surface-field) l c h / 0)
    );
  }
  .composer {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    z-index: 20;
    bottom: calc(var(--space-4) + env(safe-area-inset-bottom));
    width: min(720px, calc(100% - 50px));
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    pointer-events: none;
  }
  .composer > :global(*) {
    pointer-events: auto;
  }
  .prompts {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .cin {
    position: relative;
    border: 1px solid var(--border-control);
    background: oklch(from var(--surface-raised) l c h / 0.82);
    -webkit-backdrop-filter: blur(16px) saturate(1.6);
    backdrop-filter: blur(16px) saturate(1.6);
    border-radius: var(--radius-shell);
    /* A tight, even inset around a control cluster whose own height (44px)
       sets the row: the send/attach buttons and the textarea share one
       baseline instead of the textarea riding high in a taller box. */
    padding: var(--space-1) var(--space-1) var(--space-1) var(--space-3);
    display: flex;
    align-items: center;
    gap: var(--space-2);
    box-shadow: var(--shadow-lifted);
  }
  /* Focused: the pill grows taller and squares its radius a touch, but stays a
     single row — the textarea grows on the left while attach + send stay pinned
     inline at the bottom-right, never dropping to a wasted row of their own. */
  .composer:focus-within .cin {
    border-radius: var(--radius-panel);
    align-items: flex-end;
    padding: var(--space-2) var(--space-1) var(--space-2) var(--space-3);
  }
  textarea {
    flex: 1 1 auto;
    border: 0;
    outline: 0;
    background: transparent;
    resize: none;
    font-family: var(--font-body);
    font-size: var(--a-input-fs, 16px);
    line-height: var(--leading-ui);
    color: var(--ink-strong);
    /* Collapsed: match the 44px control height and centre the single line
       with symmetric padding, so the text sits on the buttons' midline
       rather than kissing their tops. */
    min-height: 44px;
    height: auto;
    padding: var(--space-3) 0;
    min-width: 0;
  }
  .composer:focus-within textarea {
    height: auto;
    min-height: 66px;
    max-height: 200px;
    padding: 0;
    field-sizing: content;
  }
  textarea::placeholder {
    color: var(--ink-muted);
  }
  /* Collapsed, the affordance row is taken OUT OF FLOW (absolute) so it claims
     zero width — otherwise it squeezes the resting textarea to a sliver at
     mobile widths. On focus it returns to flow and unfolds below the input. */
  .aff-row {
    position: absolute;
    display: grid;
    grid-template-rows: 0fr;
    opacity: 0;
    transform: translateY(-4px);
    pointer-events: none;
    transition:
      opacity var(--c-300) var(--e-in),
      transform var(--c-300) var(--e-in);
  }
  /* The affordance hints stay out of flow even on focus: unfolding them turned
     the pill into a column and pushed attach + send onto a wasted row of their
     own. `/` and `@` still work by typing; the placeholder carries the intent. */
  .aff-row > .inner {
    overflow: hidden;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    font-size: var(--text-sm);
    color: var(--ink-muted);
    padding-top: var(--space-2);
    flex-wrap: wrap;
    row-gap: var(--space-2);
  }
  .aff-row .hint {
    margin-left: auto;
  }
  .hidden-file {
    display: none;
  }
  /* Attach + send, together, so the fold moves them as one cluster. */
  .ctrls {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex: 0 0 auto;
  }
  .composer:focus-within .ctrls {
    align-self: flex-end;
  }
  .att-btn {
    width: 44px;
    height: 44px;
    border: 1px solid var(--border-control);
    border-radius: var(--radius-pill);
    background: var(--surface-raised);
    color: var(--ink-muted);
    display: grid;
    place-items: center;
    cursor: pointer;
    flex: 0 0 auto;
  }
  .att-btn :global(svg) {
    width: 18px;
    height: 18px;
  }
  @media (hover: hover) and (pointer: fine) {
    .att-btn:hover {
      background: var(--surface-hover);
      color: var(--ink-body);
    }
  }
  .stop {
    width: 44px;
    height: 44px;
    min-width: 44px;
    min-height: 44px;
    border: 0;
    border-radius: var(--radius-pill);
    flex: 0 0 auto;
    background: var(--brand-solid);
    background-image: var(--gradient-action);
    box-shadow: var(--shadow-action);
    color: var(--on-brand);
    display: grid;
    place-items: center;
    cursor: pointer;
  }
  .stop :global(svg) {
    width: 16px;
    height: 16px;
  }
  .stop:disabled {
    opacity: 0.45;
    cursor: default;
    box-shadow: none;
    background-image: none;
  }
  /* Pending attachment chips, above the input pill. */
  .atts {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .att {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    max-width: 100%;
    padding: var(--space-1) var(--space-1) var(--space-1) var(--space-2);
    border: 1px solid var(--border-hairline);
    border-radius: var(--radius-control);
    background: var(--surface-raised);
    box-shadow: var(--shadow-tile);
    font-size: var(--text-sm);
    color: var(--ink-body);
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .att img {
    width: 20px;
    height: 20px;
    border-radius: var(--radius-mark);
    object-fit: cover;
    flex: 0 0 auto;
  }
  .att button {
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    border: 0;
    border-radius: var(--radius-mark);
    background: none;
    color: var(--ink-muted);
    cursor: pointer;
    flex: 0 0 auto;
  }
  .att button :global(svg) {
    width: 13px;
    height: 13px;
  }
  .att button:hover {
    background: var(--surface-sunken);
    color: var(--ink-body);
  }
  /* Mobile: the composer goes full-width, edge to edge. It stays absolute
     (docked at the bottom of the transcript pane) rather than viewport-fixed,
     so it sits ABOVE the thumb bar instead of overlapping it — the thumb bar
     owns the safe-area inset. */
  @media (max-width: 900px) {
    .composer {
      left: var(--space-3);
      right: var(--space-3);
      width: auto;
      transform: none;
      /* Clear the home indicator / gesture bar — the resting gap plus the safe
         area inset, so the composer never sits under the rounded-screen chrome. */
      bottom: calc(var(--space-2) + env(safe-area-inset-bottom));
    }
    /* The Enter/Shift+Enter hint is desktop-only guidance; on a phone it just
       wraps the affordance row to a second line. */
    .aff-row .hint {
      display: none;
    }
  }
</style>
