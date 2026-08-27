<script module lang="ts">
  /** Something `@` can name: another session, or a machine. */
  export interface Mention {
    /** What gets inserted, without the `@`. */
    handle: string;
    label: string;
    detail?: string;
  }
</script>

<script lang="ts">
  /**
   * The floating composer — a lifted shell holding the text input, the attach
   * and send controls, and any inline permission / question prompts stacked
   * above it. Home, this input and Stop are the surface's fixed anchors; the
   * action button is a single box that sends when idle and interrupts while a
   * turn is in flight. Ported from the mock's `.composer` / `.cin`.
   *
   * The shell does not change shape when it is focused. It used to grow and
   * re-round on click, which moved one of the three fixed anchors every time
   * the reader touched it; now there is one radius and one padding, and the
   * only thing that grows is the textarea itself, under `field-sizing:content`.
   * Attach and send stay bottom-aligned, so they hold their position as the
   * text runs to a second and a third line.
   *
   * `/` and `@` are real: typing either opens a filtered menu above the input,
   * driven from the textarea's own keyboard so focus never leaves the message
   * being written.
   */
  import type { Snippet } from 'svelte';
  import type { AvailableCommand } from '@cockpit/core';
  import { IconSend, IconStop, IconPlus, IconClose } from '$lib/icons';
  import * as Command from '$lib/components/ui/command';
  import type { SendExtras } from '../client.svelte';

  let {
    value = $bindable(''),
    height = $bindable(0),
    busy = false,
    commands = [],
    mentions = [],
    onsubmit,
    onstop,
    prompts,
  }: {
    value?: string;
    /**
     * The floating column's measured height, published upward. The transcript
     * behind it reserves exactly this much foot-room, so a permission card
     * stacked above the input never covers the message that raised it.
     */
    height?: number;
    busy?: boolean;
    /** What this session offers behind `/`. */
    commands?: AvailableCommand[];
    /** What `@` can name — the sessions and machines in reach. */
    mentions?: Mention[];
    onsubmit: (text: string, extras: SendExtras) => void;
    onstop: () => void;
    prompts?: Snippet;
  } = $props();

  type PendingImage = { mediaType: string; data: string; name: string };
  type PendingText = { kind: 'text'; name: string; content: string };

  let images = $state<PendingImage[]>([]);
  let texts = $state<PendingText[]>([]);
  let fileInput = $state<HTMLInputElement>();
  let field = $state<HTMLTextAreaElement>();

  /** A paste longer than this rides as a named attachment, not inline text. */
  const LARGE_PASTE = 1200;

  const hasContent = $derived(
    value.trim().length > 0 || images.length > 0 || texts.length > 0
  );

  /* ---- the `/` and `@` menu ------------------------------------------- */

  /** One row of the menu, whichever sigil opened it. */
  interface Entry {
    /** Command.Item's value, and what the highlight is tracked by. */
    id: string;
    /** What replaces the typed token, sigil included. */
    insert: string;
    label: string;
    detail?: string;
    /** Which `/` family it belongs to — the menu is sectioned by this. */
    kind?: AvailableCommand['type'];
    /** The plugin or MCP server it came from, shown as a quiet origin tag. */
    source?: string;
  }

  /** One titled section of the menu. */
  interface Section {
    key: string;
    heading: string;
    entries: Entry[];
  }

  /**
   * Which section a command belongs to. A plugin-heavy session's `/` list is
   * almost entirely namespaced (`interfaces:better-ui`, `code-foundations:build`)
   * — grouping by the four coarse families would file them all under one
   * "Commands" heading, which is the mess. So the section is the command's
   * SOURCE when it has one: its plugin, or the MCP server that lent it. Skills
   * and bare built-ins, which carry no namespace, keep their family name.
   *
   * `rank` orders the sections: skills first, then plugins (by name), then the
   * built-ins, then MCP servers (by name).
   */
  function sectionMeta(entry: Entry): { key: string; heading: string; rank: number; sub: string } {
    if (entry.kind === 'skill') return { key: 'skills', heading: 'Skills', rank: 0, sub: '' };
    if (entry.kind === 'mcp') {
      const server = entry.source ?? '';
      return { key: `mcp:${server}`, heading: server || 'MCP', rank: 3, sub: server };
    }
    if (entry.source) return { key: `src:${entry.source}`, heading: entry.source, rank: 1, sub: entry.source };
    if (entry.kind === 'builtin') return { key: 'builtin', heading: 'Built-in', rank: 2, sub: '' };
    return { key: 'commands', heading: 'Commands', rank: 1, sub: '' };
  }

  /**
   * The name a row shows. Under a source heading the namespace is redundant, so
   * `interfaces:better-ui` reads as `/better-ui` beneath "interfaces", and an
   * MCP prompt drops its `mcp__server__` prefix. The value inserted keeps the
   * full name — only the label is shortened.
   */
  function displayLabel(name: string, source?: string): string {
    if (name.startsWith('mcp__')) {
      const rest = name.split('__').slice(2).join('__');
      return `/${rest || name}`;
    }
    if (source && name.startsWith(`${source}:`)) return `/${name.slice(source.length + 1)}`;
    return `/${name}`;
  }

  /**
   * The prose a row shows. Plugin descriptions often lead with their own name in
   * parens — `(code-foundations) Execute…` — which is exactly the section heading
   * above the row, so it is stripped here rather than printed twice.
   */
  function cleanDetail(description?: string, argumentHint?: string, source?: string): string | undefined {
    const prose = description?.trim();
    if (prose) {
      if (source && prose.startsWith(`(${source})`)) return prose.slice(source.length + 2).trim();
      return prose;
    }
    return argumentHint || undefined;
  }

  /** Where the caret is, so the token under it can be found on every keystroke. */
  let caret = $state(0);
  /** Dismissed with Escape: the token is still there, the menu is not. */
  let dismissed = $state(false);
  let highlight = $state('');

  /**
   * The `/…` or `@…` the caret sits in the middle of, or null.
   *
   * A sigil only opens a menu at the start of a word — mid-token it is a path
   * separator or an email, both of which the reader is entitled to type without
   * a menu landing on top of them.
   */
  const token = $derived.by((): { sigil: '/' | '@'; query: string; from: number } | null => {
    const at = Math.min(caret, value.length);
    const before = value.slice(0, at);
    const start = Math.max(before.lastIndexOf(' '), before.lastIndexOf('\n')) + 1;
    const word = before.slice(start);
    if (word.length === 0) return null;
    const sigil = word[0];
    if (sigil !== '/' && sigil !== '@') return null;
    const query = word.slice(1);
    // A token with whitespace in it is no longer being typed as one.
    if (/\s/.test(query)) return null;
    return { sigil, query, from: start };
  });

  const entries = $derived.by((): Entry[] => {
    const active = token;
    if (!active) return [];
    const needle = active.query.toLowerCase();
    const rows: Entry[] =
      active.sigil === '/'
        ? commands.map((command) => ({
            id: `/${command.name}`,
            insert: `/${command.name}`,
            // The source is the section heading now, so the row shows the short
            // name, then its prose or argument shape — never the word "builtin"
            // as a stand-in description.
            label: displayLabel(command.name, command.source),
            detail: cleanDetail(command.description, command.argumentHint, command.source),
            kind: command.type,
            source: command.source,
          }))
        : mentions.map((mention) => ({
            id: `@${mention.handle}`,
            insert: `@${mention.handle}`,
            label: mention.label,
            detail: mention.detail,
          }));
    return rows
      .filter((row) => !needle || row.id.toLowerCase().includes(needle))
      // Grouped and scrollable, so the cap only guards a pathological list; a
      // real session's commands all fit inside it and read under their source.
      .slice(0, 100);
  });

  /**
   * The entries cut into titled sections. `/` groups by source — one heading per
   * plugin and per MCP server, with skills and built-ins under their family name
   * — ordered skills, plugins (by name), built-ins, MCP servers. `@` is one
   * "Mentions" section. A section with no rows is never emitted.
   */
  const sections = $derived.by((): Section[] => {
    if (entries.length === 0) return [];
    if (token?.sigil !== '/') return [{ key: 'mentions', heading: 'Mentions', entries }];
    const groups = new Map<string, { heading: string; rank: number; sub: string; entries: Entry[] }>();
    for (const entry of entries) {
      const meta = sectionMeta(entry);
      const bucket = groups.get(meta.key);
      if (bucket) bucket.entries.push(entry);
      else groups.set(meta.key, { heading: meta.heading, rank: meta.rank, sub: meta.sub, entries: [entry] });
    }
    return [...groups.values()]
      .sort((a, b) => a.rank - b.rank || a.sub.localeCompare(b.sub) || a.heading.localeCompare(b.heading))
      .map((group) => ({ key: `${group.rank}:${group.heading}`, heading: group.heading, entries: group.entries }));
  });

  const menuOpen = $derived(!dismissed && entries.length > 0);

  /**
   * A DOM id per visible row, so the textarea can point `aria-activedescendant`
   * at the highlighted one. A screen reader on a combobox reads the active
   * descendant, not the input's value — without this the menu is invisible to
   * it, however well the arrow keys work. Keyed by position in the filtered
   * list, which is unique where the entry's own id (`/foo`, `@bar`) is not a
   * safe id token.
   */
  const domIds = $derived(
    new Map(entries.map((entry, index) => [entry.id, `composer-entry-${index}`]))
  );
  const activeDescendant = $derived(menuOpen ? domIds.get(highlight) : undefined);

  // The highlight follows the list: a query that filters the selected row away
  // must not leave Enter pointing at something that is no longer on screen.
  $effect(() => {
    if (!menuOpen) return;
    if (!entries.some((entry) => entry.id === highlight)) highlight = entries[0].id;
  });

  function noteCaret(event: Event): void {
    caret = (event.currentTarget as HTMLTextAreaElement).selectionStart ?? 0;
    dismissed = false;
  }

  /** Puts the chosen row where the token was, with a space after it. */
  function choose(entry: Entry): void {
    const active = token;
    if (!active) return;
    const end = Math.min(caret, value.length);
    value = `${value.slice(0, active.from)}${entry.insert} ${value.slice(end)}`;
    const next = active.from + entry.insert.length + 1;
    dismissed = true;
    // After the value lands, so the caret is set on the text that is there now.
    queueMicrotask(() => {
      field?.focus();
      field?.setSelectionRange(next, next);
      caret = next;
    });
  }

  function step(by: number): void {
    if (entries.length === 0) return;
    const at = entries.findIndex((entry) => entry.id === highlight);
    const next = (at + by + entries.length) % entries.length;
    highlight = entries[next].id;
  }

  function submit(): void {
    if (!hasContent) return;
    const extras: SendExtras = {};
    if (texts.length) extras.attachments = texts.map((t) => ({ ...t }));
    if (images.length) extras.images = images.map((i) => ({ mediaType: i.mediaType, data: i.data }));
    const text = value.trim();
    value = '';
    images = [];
    texts = [];
    dismissed = true;
    onsubmit(text, extras);
  }

  function onkeydown(event: KeyboardEvent): void {
    if (menuOpen) {
      // The menu owns these keys while it is up — Enter picks a command rather
      // than sending the half-typed name of one.
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        step(1);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        step(-1);
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        const picked = entries.find((entry) => entry.id === highlight);
        if (picked) {
          event.preventDefault();
          choose(picked);
          return;
        }
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        dismissed = true;
        return;
      }
    }
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
<div class="composer" bind:clientHeight={height}>
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

    {#if menuOpen}
      <!-- Above the input, not over it: the sentence being written stays legible
           while its next word is being chosen. -->
      <!-- Focus never leaves the textarea: the menu swallows the mousedown that
           would blur it, so a clicked row lands on the message being written. -->
      <div
        class="menu"
        id="composer-menu"
        onmousedown={(event) => event.preventDefault()}
        role="presentation"
      >
        <Command.Root shouldFilter={false} bind:value={highlight} loop>
          <Command.List>
            {#each sections as section (section.key)}
              <Command.Group heading={section.heading}>
                {#each section.entries as entry (entry.id)}
                  <Command.Item
                    id={domIds.get(entry.id)}
                    value={entry.id}
                    onSelect={() => choose(entry)}
                  >
                    <span class="e-label">{entry.label}</span>
                    {#if entry.detail}<span class="e-detail">{entry.detail}</span>{/if}
                  </Command.Item>
                {/each}
              </Command.Group>
            {/each}
          </Command.List>
        </Command.Root>
      </div>
    {/if}

    <textarea
      bind:this={field}
      bind:value
      {onkeydown}
      onpaste={onpaste}
      onselect={noteCaret}
      oninput={noteCaret}
      onclick={noteCaret}
      onkeyup={noteCaret}
      onblur={() => (dismissed = true)}
      placeholder="Message the agent…  /  for commands, @ to mention"
      aria-label="Message the agent"
      aria-expanded={menuOpen}
      aria-autocomplete="list"
      role="combobox"
      aria-controls="composer-menu"
      aria-activedescendant={activeDescendant}
    ></textarea>

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
        <!-- The one control that changes meaning mid-turn. `{#key}` re-creates
             the glyph on every flip, so BOTH directions of the swap animate in;
             the box it sits in is untouched, so send↔stop never moves or
             resizes under a thumb already travelling toward it. -->
        {#key busy}
          <span class="swap">
            {#if busy}<IconStop />{:else}<IconSend />{/if}
          </span>
        {/key}
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

  /* One shape, always. --radius-panel outside, --space-2 of inset, and the
     controls inside carry (panel − inset) so the curves are concentric rather
     than two unrelated roundings stacked. Nothing here changes on focus. */
  .cin {
    --cin-pad: var(--space-2);
    --cin-ctl: 34px;
    position: relative;
    border: 1px solid var(--border-control);
    background: oklch(from var(--surface-raised) l c h / 0.82);
    -webkit-backdrop-filter: blur(16px) saturate(1.6);
    backdrop-filter: blur(16px) saturate(1.6);
    border-radius: var(--radius-panel);
    padding: var(--cin-pad) var(--cin-pad) var(--cin-pad) var(--space-3);
    display: flex;
    align-items: flex-end;
    gap: var(--space-2);
    box-shadow: var(--shadow-lifted);
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
    /* Grows with what is in it, from one line's worth of the control height to
       a ceiling, and scrolls past that. The control row sets the resting height
       so a single line sits on the buttons' midline. */
    field-sizing: content;
    min-height: var(--cin-ctl);
    max-height: 200px;
    padding: calc((var(--cin-ctl) - 1lh) / 2) 0;
    min-width: 0;
  }
  textarea::placeholder {
    color: var(--ink-muted);
  }
  .hidden-file {
    display: none;
  }

  /* The `/` and `@` menu, above the pill and matched to its width. */
  .menu {
    position: absolute;
    left: 0;
    right: 0;
    bottom: calc(100% + var(--space-2));
    max-height: 320px;
    overflow: hidden;
    border: 1px solid var(--border-hairline);
    border-radius: var(--radius-panel);
    background: var(--surface-raised);
    box-shadow: var(--shadow-lifted);
    /* It floats above the input, so it settles UPWARD into place — 4px of
       travel, one --c-100, and then it is still. Dismissal is instant: a menu
       that lingers on the way out sits over the sentence being written. */
    animation: menu-open var(--c-100) var(--e-in) both;
  }
  @keyframes menu-open {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .menu {
      animation: none;
    }
  }

  /* The Command primitive is shadcn's; its parts are addressed by slot so the
     menu wears Quiet Ledger tokens rather than the stock ladder. The list is the
     one thing that scrolls; the shell stays put. */
  :global(.menu [data-slot='command']) {
    background: transparent;
  }
  :global(.menu [data-slot='command-list']) {
    max-height: 320px;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: var(--space-1);
  }

  /* Each family is a titled section, ruled off from the one above so "Skills"
     and "Commands" read as two kinds of thing rather than one long list. */
  :global(.menu [data-slot='command-group']) {
    padding: var(--space-1) 0;
  }
  :global(.menu [data-slot='command-group'] + [data-slot='command-group']) {
    border-top: 1px solid var(--border-hairline);
  }
  :global(.menu [data-slot='command-group'] [data-command-group-heading]) {
    padding: var(--space-1) var(--space-2) var(--space-2);
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--ink-muted);
  }

  /* One row: the name, its prose, and where it came from — on a single line,
     the selected one carrying fill and stronger ink so the highlight survives
     greyscale (it is never colour alone). */
  :global(.menu [data-slot='command-item']) {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    min-height: 30px;
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-control);
    cursor: pointer;
    color: var(--ink-body);
    transition:
      background-color var(--c-100) var(--e-in),
      color var(--c-100) var(--e-in);
  }
  :global(.menu [data-slot='command-item'][data-selected='true']) {
    background: var(--surface-hover);
    color: var(--ink-strong);
  }
  @media (pointer: coarse) {
    :global(.menu [data-slot='command-item']) {
      min-height: 44px;
    }
  }

  .e-label {
    font-family: var(--font-mono);
    font-weight: var(--weight-medium);
    color: var(--ink-strong);
    white-space: nowrap;
    flex: 0 0 auto;
  }
  .e-detail {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-sm);
    color: var(--ink-muted);
    flex: 1 1 auto;
  }

  /* Attach + send, together and bottom-aligned, so they hold their box as the
     text above them runs on. */
  .ctrls {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex: 0 0 auto;
  }
  .att-btn,
  .stop {
    width: var(--cin-ctl);
    height: var(--cin-ctl);
    flex: 0 0 auto;
    display: grid;
    place-items: center;
    cursor: pointer;
    /* Concentric with the shell: outer radius less the inset that seats it. */
    border-radius: calc(var(--radius-panel) - var(--cin-pad));
    transition:
      background-color var(--c-100) var(--e-in),
      color var(--c-100) var(--e-in),
      transform var(--c-100) var(--e-in);
  }
  .att-btn {
    border: 1px solid var(--border-control);
    background: var(--surface-raised);
    color: var(--ink-muted);
  }
  .att-btn :global(svg) {
    width: 17px;
    height: 17px;
  }
  @media (hover: hover) and (pointer: fine) {
    .att-btn:hover {
      background: var(--surface-hover);
      color: var(--ink-body);
    }
  }
  .stop {
    border: 0;
    background: var(--brand-solid);
    background-image: var(--gradient-action);
    box-shadow: var(--shadow-action);
    color: var(--on-brand);
  }
  .stop :global(svg) {
    width: 16px;
    height: 16px;
  }
  /* The glyph carrier, not the button: it is content-sized and centred, so
     scaling it in cannot change the control's box. */
  .stop .swap {
    display: grid;
    place-items: center;
    animation: icon-swap var(--c-100) var(--e-in) both;
  }
  @keyframes icon-swap {
    from {
      opacity: 0;
      transform: scale(0.6);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }
  /* Optical centring: the send plane's mass sits low-left of its box, so the
     glyph is nudged up and right to look centred rather than measure centred.
     The stop square is symmetric and needs none of it. */
  .stop:not(:disabled) :global(svg) {
    transform: translate(0.5px, -0.5px);
  }
  .att-btn:active,
  .stop:active:not(:disabled) {
    transform: scale(0.96);
  }
  .stop:disabled {
    opacity: 0.45;
    cursor: default;
    box-shadow: none;
    background-image: none;
  }
  .att-btn:focus-visible,
  .stop:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
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
    /* A chip appearing under the input is a small confirmation, so it gets a
       small one: 2px of travel and one --c-100. Removal stays instant — the
       reader who clicked × has already decided. */
    animation: att-in var(--c-100) var(--e-in) both;
  }
  @keyframes att-in {
    from {
      opacity: 0;
      transform: translateY(2px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
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

  /* A thumb gets the platform's 44px floor; the shell's inset grows with the
     controls so the curves stay concentric at both sizes. */
  @media (pointer: coarse) {
    .cin {
      --cin-ctl: 44px;
    }
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
  }

  @media (prefers-reduced-motion: reduce) {
    .att-btn,
    .stop {
      transition: none;
    }
    .att-btn:active,
    .stop:active:not(:disabled) {
      transform: none;
    }
    .stop .swap,
    .att {
      animation: none;
    }
  }
</style>
