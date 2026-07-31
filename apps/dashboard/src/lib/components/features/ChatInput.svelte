<script lang="ts">
  import { IconAttach, IconClose, IconDocument, IconSpinner, IconSend, IconStop } from '$lib/icons';
  import type { SendExtras } from '$lib/cockpit/client.svelte';
  import type { Snippet } from 'svelte';
  import { slide } from 'svelte/transition';
  import { quintOut } from 'svelte/easing';
  import CommandPalette from './CommandPalette.svelte';

  interface AvailableCommand {
    name: string;
    type: 'builtin' | 'custom' | 'skill' | 'mcp';
    description?: string;
    source?: string;
  }

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
  }

  let {
    disabled = false,
    loading = false,
    streaming = false,
    placeholder = 'Type a message...',
    commands = [],
    onSend,
    onInterrupt,
    attachment,
    attachmentOpen = false,
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
  let commandSelected = $state(false); // Track if a command was just selected

  // Check if we should show command palette
  $effect(() => {
    // Don't reopen palette immediately after selecting a command
    if (commandSelected) return;

    // Show palette when message starts with / and has commands
    const shouldShow = message.startsWith('/') && commands.length > 0 && !loading;
    showPalette = shouldShow;

    // Reset selection when filter changes
    if (shouldShow) {
      selectedIndex = 0;
    }
  });

  // Get filtered commands count for navigation bounds
  let filteredCommands = $derived(
    commands.filter((cmd) => {
      const searchTerm = message.toLowerCase().replace(/^\//, '');
      return cmd.name.toLowerCase().includes(searchTerm) ||
        (cmd.description?.toLowerCase().includes(searchTerm) ?? false);
    })
  );

  const paletteOpen = $derived(showPalette && filteredCommands.length > 0);
  const chipsOpen = $derived(attachments.length > 0 || images.length > 0);

  /** The send button becomes the stop control mid-turn, so it stays one slot. */
  const stopping = $derived(streaming && !!onInterrupt);

  /** An image on its own is a message; the box being empty is not the test. */
  const canSend = $derived(Boolean(message.trim()) || chipsOpen);

  // Auto-resize textarea
  function handleInput(e: Event) {
    error = '';
    const target = e.target as HTMLTextAreaElement;
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
      images.push({ id: crypto.randomUUID(), name, mediaType: file.type, data: await toBase64(file) });
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
    attachments.push({ id: crypto.randomUUID(), name: 'Pasted text', content: text });
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
    message = '';
    attachments = [];
    images = [];
    error = '';
    showPalette = false;

    // Reset textarea height
    if (textareaRef) {
      textareaRef.style.height = 'auto';
    }

    await onSend(msgToSend, extras);
  }

  function handleCommandSelect(command: AvailableCommand) {
    // Replace the current input with the command
    message = command.name + ' ';
    showPalette = false;
    commandSelected = true; // Prevent palette from reopening

    // Focus back on textarea
    textareaRef?.focus();
  }

  function handleKeydown(e: KeyboardEvent) {
    // Handle palette navigation
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

    // Enter without modifiers: submit when palette is closed
    if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !showPalette) {
      e.preventDefault();
      commandSelected = false; // Reset for next time
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
        if (showPalette && filteredCommands.length > 0) {
          const selected = filteredCommands[selectedIndex];
          if (selected) {
            message = selected.name;
          }
        }
        commandSelected = false;
        handleSubmit();
      }
    }
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

      {#if paletteOpen}
        <div in:slide={{ duration: 250, easing: quintOut }} out:slide={{ duration: 180, easing: quintOut }}>
          <CommandPalette
            {commands}
            filter={message}
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
        onpaste={handlePaste}
      ></textarea>

      <div class="flex shrink-0 items-center gap-1 m-1.5">
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
            ? 'bg-destructive text-destructive-foreground/10 text-destructive hover:bg-destructive hover:text-destructive-foreground/20'
            : 'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground/90'}"
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
