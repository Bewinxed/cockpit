<script lang="ts">
  /**
   * One markdown file, as this app has always shown a doc: a card with the
   * file's name on it, the rendered markdown under it, and an editor in the
   * same place when you click. The fleet's memory, a project's CLAUDE.md and
   * the three files a session reads are all this — so they are all one thing to
   * learn rather than three surfaces to work out.
   *
   * Read-only is the absence of `save`: a card nobody can write is a card with
   * nothing to click.
   */
  import type { Snippet } from 'svelte';
  import { toast } from 'svelte-sonner';
  import { Button } from '$lib/components/ui/button';
  import { Markdown } from '$lib/components/ui/markdown';
  import { Textarea } from '$lib/components/ui/textarea';

  interface Props {
    /** What the header calls the file, shown verbatim. */
    path: string;
    /** Null is a file that is not there — the card offers to write one. */
    content: string | null;
    /**
     * Writes the text and answers whether it landed. `false` keeps the editor
     * open, for a caller with something to say about why in `footer`.
     */
    save?: (text: string) => Promise<boolean>;
    /** Bindable: a parent that replaced the content closes the editor with it. */
    editing?: boolean;
    emptyText?: string;
    /**
     * One line about the file, shown in place of the rendered markdown. For a
     * rail that lists the file where something else is already reading it —
     * Edit still opens the same editor here.
     */
    summary?: string;
    /** Inline facts after the filename — a hash, a size, a time. */
    meta?: Snippet;
    /** Extra header buttons. View mode only: editing has its own two. */
    actions?: Snippet;
    /** Inside the card, under the body: what a refused save has to show. */
    footer?: Snippet;
  }

  let {
    path,
    content,
    save,
    editing = $bindable(false),
    emptyText = 'Nothing here yet.',
    summary,
    meta,
    actions,
    footer,
  }: Props = $props();

  /** The editor's text: seeded when editing starts, never from a prop after. */
  let draft = $state('');
  let saving = $state(false);
  let seeded = $state(false);

  const dirty = $derived(draft !== (content ?? ''));

  // A parent may open the editor itself; it gets the same seeded draft a click
  // would have given it, and a content prop that moves under an open editor
  // never takes the text being written with it.
  $effect(() => {
    if (editing && !seeded) {
      draft = content ?? '';
      seeded = true;
    } else if (!editing && seeded) {
      seeded = false;
    }
  });

  function edit() {
    if (!save) return;
    draft = content ?? '';
    editing = true;
  }

  function cancel() {
    editing = false;
  }

  /**
   * The body is a shortcut into the editor, not a trap: a link in the markdown
   * is still a link, and text somebody is selecting to copy is not an edit.
   * The header's Edit button is the affordance, and the keyboard's way in.
   */
  function bodyClick(event: MouseEvent) {
    if (!save) return;
    if ((event.target as HTMLElement).closest('a')) return;
    if (window.getSelection()?.isCollapsed === false) return;
    edit();
  }

  async function commit() {
    if (!save) return;
    saving = true;
    try {
      if (await save(draft)) editing = false;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      saving = false;
    }
  }
</script>

<section class="w-full min-w-0 overflow-hidden rounded-xl border border-border bg-card">
  <header class="flex items-center gap-3 border-b border-border px-4 py-2">
    <span class="min-w-0 truncate font-mono text-xs text-muted-foreground" title={path}>{path}</span>
    {#if meta}
      {@render meta()}
    {/if}
    {#if editing}
      <Button variant="ghost" size="xs" class="ml-auto shrink-0" disabled={saving} onclick={cancel}>
        Cancel
      </Button>
      <Button variant="outline" size="xs" class="shrink-0" disabled={saving || !dirty} onclick={commit}>
        {saving ? 'Saving…' : 'Save'}
      </Button>
    {:else}
      <span class="ml-auto flex shrink-0 items-center gap-2">
        {#if actions}
          {@render actions()}
        {/if}
        {#if save && content !== null}
          <Button variant="outline" size="xs" onclick={edit}>Edit</Button>
        {/if}
      </span>
    {/if}
  </header>

  {#if editing}
    <Textarea
      bind:value={draft}
      spellcheck="false"
      aria-label={path}
      class="min-h-72 rounded-none border-0 font-mono text-sm focus-visible:ring-inset"
    />
  {:else if content !== null && summary}
    <p class="px-4 py-2.5 text-caption">{summary}</p>
  {:else if content !== null}
    <!-- The click is the convenience; the Edit button above is the affordance,
         which is why this needs no key handler of its own. -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="max-h-[60vh] min-h-40 overflow-y-auto px-4 py-3 {save ? 'cursor-text' : ''}"
      title={save ? 'Click to edit' : undefined}
      onclick={bodyClick}
    >
      <Markdown source={content} />
    </div>
  {:else if save}
    <!-- The kit's button is `whitespace-nowrap`; a sentence long enough to need
         two lines would push the card past its column instead of wrapping. -->
    <Button
      variant="ghost"
      class="h-auto w-full justify-start rounded-none px-4 py-6 text-left text-[13px] font-normal whitespace-normal text-muted-foreground"
      onclick={edit}
    >
      {emptyText}
    </Button>
  {:else}
    <p class="px-4 py-6 text-[13px] text-muted-foreground">{emptyText}</p>
  {/if}

  {#if footer}
    {@render footer()}
  {/if}
</section>
