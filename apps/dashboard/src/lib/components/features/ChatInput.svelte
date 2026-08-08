<script lang="ts">
  import { IconAttach, IconClose, IconDocument, IconSpinner, IconSend, IconStop } from '$lib/icons';
  import type { SendExtras } from '$lib/cockpit/client.svelte';
  import { tick, type Snippet } from 'svelte';
  import { slide } from 'svelte/transition';
  import { quintOut } from 'svelte/easing';
  import CommandPalette from './CommandPalette.svelte';
  import { commandAt, filterCommands, insertCommand } from './command-groups';
  import { matchPeers, mentionAt, type PeerTarget } from '$lib/cockpit/peer';
  import { newId } from '$lib/cockpit/id';
  import type { AvailableCommand } from '@cockpit/core';

  interface Props {
    disabled?: boolean;
    loading?: boolean;
    streaming?: boolean;
    placeholder?: string;
    commands?: AvailableCommand[];
    onSend: (message: string, extras: SendExtras) => void | Promise<void>;
    onInterrupt?: () => void | Promise<void>;
    /** Content the input card grows to accommodate (permission prompts, pickers) */
    attachment?: Snippet;
    attachmentOpen?: boolean;
    /** A always-visible status the dock carries, left of the controls. */
    meter?: Snippet;
    /** The reader has reached for the `/` menu — see `loadCommands`. */
    onCommandsNeeded?: () => void;
    /** Sessions this one can hand work to, offered behind `@`. */
    peers?: PeerTarget[];
    /** Called instead of `onSend` while a hand-off target is chosen. */
    onHandoff?: (peer: PeerTarget, message: string) => void | Promise<void>;
  }

  let {
    disabled = false,
    loading = false,
    streaming = false,
    placeholder = 'Type a message...',
    commands = [],
    onCommandsNeeded,
    onSend,
    onInterrupt,
    attachment,
    attachmentOpen = false,
    meter,
    peers = [],
    onHandoff,
  }: Props = $props();

  const uid = $props.id();

  /** A paste this size was never typed, so it becomes a chip instead of filling the box. */
  const PASTE_CHARS = 1000;
  const PASTE_LINES = 10;

  const MAX_IMAGES = 5;
  const MAX_IMAGE_MB = 5;

  /** What the SDK's image blocks accept — a drop or a paste can offer anything. */
  const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

  interface TextChip {
    id: string;
    name: string;
    content: string;
  }

  interface ImageChip {
    id: string;
    name: string;
    mediaType: string;
    data: string;
  }

  let message = $state('');
  let attachments = $state<TextChip[]>([]);
  let images = $state<ImageChip[]>([]);
  let error = $state('');
  let dragging = $state(false);
  let textareaRef = $state<HTMLTextAreaElement | null>(null);
  let fileInput = $state<HTMLInputElement | null>(null);
  let showPalette = $state(false);
  let selectedIndex = $state(0);

  /** Where the caret is, so a menu is only live while its token is being typed. */
  let caret = $state(0);
  /** The session this message goes to instead of the current one, once chosen. */
  let handoff = $state<PeerTarget | null>(null);
  let mentionIndex = $state(0);

  const mentionToken = $derived(handoff ? null : mentionAt(message, caret));
  const slashToken = $derived(commandAt(message, caret));

  // One menu at a time. `@` and `/` both open on a word boundary, so the caret
  // is inside at most one of the two tokens: where both read as live, the one
  // that starts later is the one being typed, and the other menu stays shut.
  const mention = $derived(
    mentionToken && (!slashToken || mentionToken.start > slashToken.start) ? mentionToken : null
  );
  const slash = $derived(
    slashToken && (!mentionToken || slashToken.start > mentionToken.start) ? slashToken : null
  );

  const mentionMatches = $derived(mention ? matchPeers(peers, mention.term) : []);
  const mentionOpen = $derived(Boolean(mention) && mentionMatches.length > 0 && !loading);

  // Check if we should show command palette
  $effect(() => {
    // Show palette while a `/` token is being typed, wherever it sits in the line
    const shouldShow = Boolean(slash) && commands.length > 0 && !loading;
    showPalette = shouldShow;

    // Reset selection when filter changes
    if (shouldShow) {
      selectedIndex = 0;
    }
  });

  /** Whether the run of `/` being typed has already asked what the menu holds. */
  let askedForCommands = false;

  // What each command does is worth one call per session, and only for a session
  // somebody types "/" into — so it is asked for here, where reaching for the
  // menu is what the reader has just done, rather than on every session opened.
  $effect(() => {
    const reaching = Boolean(slash) && !loading;
    if (reaching && !askedForCommands) onCommandsNeeded?.();
    askedForCommands = reaching;
  });

  // The list the arrow keys walk, in the order the palette draws it — the
  // headings it puts between namespaces are not rows, so this stays flat.
  let filteredCommands = $derived(slash ? filterCommands(commands, slash.term) : []);

  const paletteOpen = $derived(showPalette && filteredCommands.length > 0);

  /** Replaces the half-typed `@name` with the choice, and routes the message. */
  function chooseMention(peer: PeerTarget) {
    const token = mention;
    handoff = peer;
    if (token) {
      message = (message.slice(0, token.start) + message.slice(caret)).trimStart();
    }
    mentionIndex = 0;
    textareaRef?.focus();
  }

  function clearHandoff() {
    handoff = null;
    textareaRef?.focus();
  }
  const chipsOpen = $derived(attachments.length > 0 || images.length > 0);

  /** The send button becomes the stop control mid-turn, so it stays one slot. */
  const stopping = $derived(streaming && !!onInterrupt);

  /** An image on its own is a message; the box being empty is not the test. */
  const canSend = $derived(Boolean(message.trim()) || chipsOpen);

  // Auto-resize textarea
  function handleInput(e: Event) {
    error = '';
    const target = e.target as HTMLTextAreaElement;
    caret = target.selectionStart ?? target.value.length;
    target.style.height = 'auto';
    target.style.height = Math.min(target.scrollHeight, 200) + 'px';
  }

  /** `readAsDataURL` is the browser's own base64; the SDK wants it without the prefix. */
  function toBase64(file: File): Promise<string> {
    const reader = new FileReader();
    const read = new Promise<string>((resolve, reject) => {
      reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
      reader.onerror = () => reject(reader.error);
    });
    reader.readAsDataURL(file);
    return read;
  }

  async function addImages(files: File[]) {
    error = '';
    for (const file of files) {
      const name = file.name || 'pasted image';
      if (images.length >= MAX_IMAGES) {
        error = `Up to ${MAX_IMAGES} images per message.`;
        break;
      }
      if (!IMAGE_TYPES.has(file.type)) {
        error = `${name} is not a PNG, JPEG, GIF or WebP.`;
        continue;
      }
      if (file.size > MAX_IMAGE_MB * 1024 * 1024) {
        error = `${name} is over ${MAX_IMAGE_MB} MB.`;
        continue;
      }
      images.push({ id: newId(), name, mediaType: file.type, data: await toBase64(file) });
    }
  }

  async function handlePaste(e: ClipboardEvent) {
    // Read the clipboard before awaiting anything: its items do not outlive the event.
    const pasted = [...(e.clipboardData?.items ?? [])]
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);
    if (pasted.length > 0) {
      e.preventDefault();
      await addImages(pasted);
      return;
    }

    const text = e.clipboardData?.getData('text/plain') ?? '';
    if (text.length <= PASTE_CHARS && text.split('\n').length <= PASTE_LINES) return;
    e.preventDefault();
    error = '';
    attachments.push({ id: newId(), name: 'Pasted text', content: text });
  }

  function handleDragOver(e: DragEvent) {
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    dragging = true;
  }

  function handleDragLeave(e: DragEvent) {
    // Crossing between the card's own children fires leave too; only exits count.
    const { currentTarget, relatedTarget } = e;
    if (currentTarget instanceof Node && relatedTarget instanceof Node) {
      if (currentTarget.contains(relatedTarget)) return;
    }
    dragging = false;
  }

  async function handleDrop(e: DragEvent) {
    e.preventDefault();
    dragging = false;
    await addImages([...(e.dataTransfer?.files ?? [])]);
  }

  async function handleFiles(e: Event) {
    const input = e.target as HTMLInputElement;
    await addImages([...(input.files ?? [])]);
    // Cleared so picking the same file again still counts as a change.
    input.value = '';
  }

  function removeAttachment(id: string) {
    error = '';
    attachments = attachments.filter((chip) => chip.id !== id);
  }

  function removeImage(id: string) {
    error = '';
    images = images.filter((chip) => chip.id !== id);
  }

  async function handleSubmit(e?: Event) {
    e?.preventDefault();

    if (!canSend || disabled || loading) return;

    // Capture and clear immediately for fluidity
    const msgToSend = message.trim();
    const extras: SendExtras = {
      attachments: attachments.length
        ? attachments.map(({ name, content }) => ({ kind: 'text' as const, name, content }))
        : undefined,
      images: images.length ? images.map(({ mediaType, data }) => ({ mediaType, data })) : undefined,
    };
    const target = handoff;
    message = '';
    attachments = [];
    images = [];
    error = '';
    showPalette = false;
    handoff = null;

    // A hand-off is addressed elsewhere, so it does not become a turn here.
    if (target && onHandoff) {
      await onHandoff(target, msgToSend);
      if (textareaRef) textareaRef.style.height = 'auto';
      return;
    }

    // Reset textarea height
    if (textareaRef) {
      textareaRef.style.height = 'auto';
    }

    await onSend(msgToSend, extras);
  }

  async function handleCommandSelect(command: AvailableCommand) {
    const token = slash;
    if (!token) return;
    // Replace the token being typed, and only it. The slash is put back on: the
    // SDK lists these without it, and it is what makes the sent line a command.
    const spliced = insertCommand(message, token, caret, command.name);
    message = spliced.text;
    // The trailing space the insert carries ends the token, which is what shuts
    // the palette — so the caret has to move with the text, not stay behind it.
    caret = spliced.caret;
    showPalette = false;

    // Focus back on textarea
    textareaRef?.focus();
    await tick();
    if (textareaRef) {
      textareaRef.selectionStart = spliced.caret;
      textareaRef.selectionEnd = spliced.caret;
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    // Mid-composition, Enter is the composer accepting a candidate, not the
    // reader sending. Every IME uses it that way, and so do the suggestion
    // strips on Android and iOS keyboards — without this, accepting a word
    // sends the message. Browsers report the key as 229 for the same reason.
    if (e.isComposing || e.keyCode === 229) return;

    // Handle palette navigation
    // The mention menu owns the keys while it is open, the same way the command
    // palette does — and before it, since it is the nearer of the two.
    if (mentionOpen) {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        mentionIndex = mentionIndex > 0 ? mentionIndex - 1 : mentionMatches.length - 1;
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        mentionIndex = mentionIndex < mentionMatches.length - 1 ? mentionIndex + 1 : 0;
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        chooseMention(mentionMatches[mentionIndex]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        caret = 0;
        return;
      }
    }
    // Backspace on an empty box takes the target off rather than doing nothing.
    if (e.key === 'Backspace' && handoff && message.length === 0) {
      e.preventDefault();
      clearHandoff();
      return;
    }

    if (showPalette && filteredCommands.length > 0) {
      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault();
          selectedIndex = selectedIndex > 0 ? selectedIndex - 1 : filteredCommands.length - 1;
          return;
        case 'ArrowDown':
          e.preventDefault();
          selectedIndex = selectedIndex < filteredCommands.length - 1 ? selectedIndex + 1 : 0;
          return;
        case 'Enter':
          if (!e.shiftKey && !e.metaKey && !e.ctrlKey) {
            e.preventDefault();
            const selected = filteredCommands[selectedIndex];
            if (selected) {
              handleCommandSelect(selected);
            }
            return;
          }
          break;
        case 'Escape':
          e.preventDefault();
          showPalette = false;
          return;
        case 'Tab': {
          e.preventDefault();
          const selected = filteredCommands[selectedIndex];
          if (selected) {
            handleCommandSelect(selected);
          }
          return;
        }
      }
    }

    // Enter without modifiers: submit when nothing is showing that owns it.
    //
    // Gated on `paletteOpen`, not `showPalette`. `showPalette` is true for any
    // live `/` token, including one matching no command at all — a path like
    // `/home/...` while it is being typed. The palette's own handler above
    // returns early in that case (no matches to choose), so a `!showPalette`
    // gate here left Enter handled by nobody and the textarea inserted a
    // newline instead of sending. That is the whole "sometimes it sends,
    // sometimes it doesn't".
    if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !paletteOpen) {
      e.preventDefault();
      handleSubmit();
      return;
    }

    // Ctrl/Cmd + Enter: Interrupt if streaming, otherwise submit
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      if (streaming && onInterrupt) {
        onInterrupt();
      } else {
        // If palette is open, select the highlighted command first before submitting
        if (paletteOpen && slash) {
          const selected = filteredCommands[selectedIndex];
          if (selected) {
            message = insertCommand(message, slash, caret, selected.name).text;
          }
        }
        handleSubmit();
      }
    }
  }

  /** What is typed and not sent — kept per session by the page that owns it. */
  export function draft(): string {
    return message;
  }

  /** Restores text the user typed after a failed send, or on the way back to
   *  the session they typed it in. Measured after the text is in the box —
   *  `scrollHeight` before that reports the height of what it is replacing. */
  export async function setDraft(text: string) {
    message = text;
    await tick();
    if (!textareaRef) return;
    textareaRef.style.height = 'auto';
    textareaRef.style.height = Math.min(textareaRef.scrollHeight, 200) + 'px';
  }
</script>

<div>
  <!-- Dropped images land anywhere on the card, so the form that wraps it is the target -->
  <form
    class="relative"
    onsubmit={handleSubmit}
    ondragover={handleDragOver}
    ondragleave={handleDragLeave}
    ondrop={handleDrop}
  >
    <!-- One card: grows to accommodate prompts and the command palette, input row at the bottom -->
    <div class="bg-card border border-border rounded-xl shadow-lg overflow-hidden
                focus-within:ring-2 focus-within:ring-ring/20 focus-within:border-ring
                transition-colors {dragging ? 'ring-2 ring-ring/40' : ''}"
    >
      {#if attachmentOpen && attachment}
        <div in:slide={{ duration: 300, easing: quintOut }} out:slide={{ duration: 200, easing: quintOut }}>
          {@render attachment()}
        </div>
      {/if}

      {#if mentionOpen}
        <!-- Addressing another session, offered the moment `@` opens a word.
             Grouped nowhere and sorted not at all: the fleet is small, and the
             list the reader sees is the list the rail already showed them. -->
        <div
          class="max-h-56 overflow-y-auto border-b border-border p-1"
          in:slide={{ duration: 200, easing: quintOut }}
          out:slide={{ duration: 150, easing: quintOut }}
          role="listbox"
          aria-label="Hand this to another session"
        >
          {#each mentionMatches as peer, index (peer.id)}
            <button
              type="button"
              role="option"
              aria-selected={index === mentionIndex}
              class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm
                     transition-colors duration-150 ease-out
                     {index === mentionIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-muted'}"
              onclick={() => chooseMention(peer)}
            >
              <span
                class="size-1.5 shrink-0 rounded-full {peer.busy
                  ? 'bg-success animate-pulse'
                  : 'bg-muted-foreground/40'}"
              ></span>
              <span class="truncate font-mono">{peer.label}</span>
              <span class="ml-auto shrink-0 text-xs text-muted-foreground">{peer.hostname}</span>
            </button>
          {/each}
        </div>
      {/if}

      {#if handoff}
        <!-- The composer is addressed elsewhere, and says so where the reader is
             looking before they press Enter — not after it has gone. -->
        <div class="flex items-center gap-2 border-b border-border px-3 py-2 text-sm">
          <span class="text-muted-foreground">Hand to</span>
          <span class="flex items-center gap-1.5 rounded-md bg-primary/10 px-2 py-0.5 text-primary">
            <span class="font-mono">{handoff.label}</span>
            <span class="text-xs opacity-70">{handoff.hostname}</span>
          </span>
          <button
            type="button"
            class="ml-auto rounded-md px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            onclick={clearHandoff}
          >
            Cancel
          </button>
        </div>
      {/if}

      {#if paletteOpen}
        <div in:slide={{ duration: 250, easing: quintOut }} out:slide={{ duration: 180, easing: quintOut }}>
          <CommandPalette
            {commands}
            filter={slash?.term ?? ''}
            {selectedIndex}
            onSelect={handleCommandSelect}
            listboxId="cmd-list-{uid}"
            optionIdPrefix="cmd-opt-{uid}"
          />
        </div>
      {/if}

      {#if chipsOpen}
        <div class="flex flex-wrap items-center gap-2 px-3 py-2"
          in:slide={{ duration: 250, easing: quintOut }}
          out:slide={{ duration: 180, easing: quintOut }}
        >
          {#each attachments as chip (chip.id)}
            <span class="flex items-center gap-1.5 rounded-md border border-border bg-muted/50 py-1 pl-2 pr-1 text-xs">
              <IconDocument class="size-3.5 shrink-0 text-muted-foreground" />
              <span class="max-w-40 truncate">{chip.name}</span>
              <span class="tabular-nums text-muted-foreground">
                {chip.content.length.toLocaleString()} chars
              </span>
              <button
                type="button"
                class="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                onclick={() => removeAttachment(chip.id)}
                aria-label="Remove {chip.name}"
              >
                <IconClose class="size-3.5" />
              </button>
            </span>
          {/each}

          {#each images as chip (chip.id)}
            <span class="group/thumb relative">
              <img
                src="data:{chip.mediaType};base64,{chip.data}"
                alt={chip.name}
                class="size-12 rounded-md object-cover"
              />
              <button
                type="button"
                class="absolute -right-1.5 -top-1.5 rounded-full border border-border bg-card p-0.5
                       text-muted-foreground opacity-0 transition-opacity
                       group-hover/thumb:opacity-100 focus-visible:opacity-100"
                onclick={() => removeImage(chip.id)}
                aria-label="Remove {chip.name}"
              >
                <IconClose class="size-3.5" />
              </button>
            </span>
          {/each}
        </div>
      {/if}

      {#if error}
        <p class="px-3 pt-2 text-xs text-destructive" role="alert">{error}</p>
      {/if}

      <div class="flex items-end gap-2 {attachmentOpen || paletteOpen || chipsOpen ? 'border-t border-border' : ''}">
      <textarea
        bind:this={textareaRef}
        bind:value={message}
        {placeholder}
        disabled={disabled || loading}
        rows={1}
        class="flex-1 resize-none min-h-10 max-h-[200px] py-2.5 pl-3
               bg-transparent border-none
               text-base sm:text-sm leading-5 overflow-y-hidden
               placeholder:text-muted-foreground
               focus:outline-none
               disabled:opacity-50 disabled:cursor-not-allowed"
        role="combobox"
        aria-label="Message"
        aria-autocomplete="list"
        aria-controls="cmd-list-{uid}"
        aria-expanded={showPalette}
        aria-activedescendant={showPalette && filteredCommands.length > 0
          ? `cmd-opt-${uid}-${selectedIndex}`
          : undefined}
        oninput={handleInput}
        onkeydown={handleKeydown}
        onkeyup={(event) => (caret = event.currentTarget.selectionStart ?? caret)}
        onclick={(event) => (caret = event.currentTarget.selectionStart ?? caret)}
        onpaste={handlePaste}
      ></textarea>

      <div class="flex shrink-0 items-center gap-1 m-1.5">
        {@render meter?.()}
        <input
          bind:this={fileInput}
          type="file"
          accept="image/*"
          multiple
          class="hidden"
          onchange={handleFiles}
        />

        <button
          type="button"
          disabled={disabled || loading}
          class="size-7 rounded-md
                 flex items-center justify-center
                 text-muted-foreground hover:bg-muted hover:text-foreground
                 active:scale-[0.96]
                 disabled:opacity-30 disabled:cursor-not-allowed
                 transition-[color,background-color,opacity,scale] duration-150 ease-out"
          title="Attach images"
          aria-label="Attach images"
          onclick={() => fileInput?.click()}
        >
          <IconAttach class="size-3.5" />
        </button>

        <button
          type={stopping ? 'button' : 'submit'}
          disabled={!stopping && (disabled || loading || !canSend)}
          class="size-7 rounded-md
                 flex items-center justify-center
                 active:scale-[0.96]
                 disabled:opacity-30 disabled:cursor-not-allowed
                 transition-[color,background-color,opacity,scale] duration-150 ease-out
                 {stopping
            ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
            : 'bg-primary text-primary-foreground hover:bg-primary/90'}"
          title={stopping ? 'Stop (Ctrl+Enter)' : 'Send message'}
          aria-label={stopping ? 'Stop response' : loading ? 'Sending message' : 'Send message'}
          onclick={stopping ? () => onInterrupt?.() : undefined}
        >
          <span class="icon-swap">
            <span data-active={stopping}><IconStop class="size-3.5" /></span>
            <span data-active={!stopping && loading}><IconSpinner class="size-3.5 animate-spin" /></span>
            <span data-active={!stopping && !loading}><IconSend class="size-3.5" /></span>
          </span>
        </button>
      </div>
      </div>
    </div>
  </form>
</div>
