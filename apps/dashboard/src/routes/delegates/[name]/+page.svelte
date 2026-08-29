<script lang="ts">
  import { untrack } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { toast } from 'svelte-sonner';
  import type { DelegateType } from '$lib/cockpit/delegate-types';
  import {
    blankDelegateType,
    DELEGATE_EFFORTS,
    DELEGATE_HARNESSES,
    delegateTypeProblem,
    message,
    removeDelegateType,
    saveDelegateType,
  } from '$lib/cockpit/delegate-types';
  import { IconArrowRight, IconTrash } from '$lib/icons';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { NativeSelect } from '$lib/components/ui/native-select';
  import { Textarea } from '$lib/components/ui/textarea';
  import * as Alert from '$lib/components/ui/alert';
  import { confirm } from '$lib/cockpit/confirm.svelte';
  import type { PageData } from './$types';

  /**
   * The delegate-type editor.
   *
   * The description is the whole of how a calling agent routes here — there
   * is no separate "when to use this" field, because that field would just be
   * a second, competing description — so it gets the largest field on the
   * form, above harness/model/effort rather than beside them.
   *
   * Its own page rather than a dialog, the same reasoning as `rules/[id]`:
   * there is a name, a big description, a harness/model/effort group, two
   * list fields and a delete — a modal that scrolls should have been a page.
   */
  let { data }: { data: PageData } = $props();

  const blank = blankDelegateType();
  let draft = $state<DelegateType>(untrack(() => (data.type ? { ...data.type } : blank)));
  let skillsText = $state(untrack(() => (data.type?.skills ?? []).join(', ')));
  let denyToolsText = $state(untrack(() => (data.type?.denyTools ?? []).join(', ')));
  let busy = $state(false);
  let deleting = $state(false);
  let failed = $state<string | undefined>(undefined);
  let touched = $state<Record<string, boolean>>({});
  let attempted = $state(false);

  const name = $derived(data.composing ? null : page.params.name);

  const parsedList = (text: string): string[] | undefined => {
    const items = text
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    return items.length ? items : undefined;
  };

  const submission = $derived<DelegateType>({
    ...draft,
    name: draft.name.trim(),
    description: draft.description.trim(),
    model: draft.model.trim(),
    skills: parsedList(skillsText),
    denyTools: parsedList(denyToolsText),
  });

  const problem = $derived(delegateTypeProblem(submission));
  const shown = (field: string): boolean => attempted || touched[field] === true;

  const duplicate = $derived(
    submission.name !== '' && data.taken.includes(submission.name)
      ? 'Another delegate type already has that name. Two types called the same thing are two a calling agent cannot tell apart.'
      : undefined
  );

  const ready = $derived(problem === undefined && duplicate === undefined);

  async function save(event: SubmitEvent) {
    event.preventDefault();
    attempted = true;
    if (!ready || busy) return;
    busy = true;
    failed = undefined;
    try {
      await saveDelegateType(submission);
      toast.success(`${submission.name} is available to new sessions.`);
      await goto('/delegates', { invalidateAll: true });
    } catch (error) {
      failed = message(error);
    } finally {
      busy = false;
    }
  }

  async function askRemove() {
    if (!name) return;
    const ok = await confirm({
      title: `Delete ${draft.name || 'this delegate type'}?`,
      body:
        'A session already running keeps the type list it started with — the prompt cache is frozen for its lifetime. This only stops the name from being offered to new sessions.',
      confirmLabel: 'Delete delegate type',
      destructive: true,
    });
    if (ok) await remove();
  }

  async function remove() {
    if (!name) return;
    deleting = true;
    try {
      await removeDelegateType(name);
      await goto('/delegates', { invalidateAll: true });
    } catch (error) {
      failed = message(error);
      deleting = false;
    }
  }
</script>

<svelte:head>
  <title>{data.composing ? 'New delegate type' : draft.name || 'Delegate type'} &middot; Outpost</title>
</svelte:head>

<div class="flex-1 overflow-y-auto p-6">
  <form class="mx-auto flex max-w-2xl flex-col gap-6" onsubmit={save}>
    <a
      href="/delegates"
      class="flex w-fit items-center gap-1 text-micro text-muted-foreground hover:text-foreground"
    >
      <IconArrowRight class="size-3 shrink-0 rotate-180" />
      Delegates
    </a>

    {#if data.error}
      <div class="rounded-[var(--radius-card)] bg-card p-4 shadow-md" role="alert">
        <p class="text-caption text-warning">{data.error}</p>
      </div>
    {/if}

    <header class="flex flex-col gap-3">
      <label class="flex flex-col gap-1.5">
        <span class="text-micro text-muted-foreground">Name</span>
        <Input
          bind:value={draft.name}
          onblur={() => (touched.name = true)}
          placeholder="explore"
          autocomplete="off"
          spellcheck="false"
          disabled={!data.composing}
          aria-invalid={(shown('name') && problem) || duplicate ? 'true' : undefined}
          class="font-mono"
        />
        <span class="text-micro text-muted-foreground">
          {data.composing
            ? 'Lowercase letters, digits and hyphens — the exact string a delegate call\'s type param names.'
            : 'The name is the key a running call already asks for by; renaming means creating a new type.'}
        </span>
      </label>
      {#if shown('name') && problem && problem.includes('name')}
        <p class="text-micro text-destructive">{problem}</p>
      {:else if duplicate}
        <p class="text-micro text-destructive">{duplicate}</p>
      {/if}
    </header>

    <!-- The description is the product: the calling agent's only signal for
         whether this is the right type, so it is the largest field on the form. -->
    <section class="flex flex-col gap-2 rounded-[var(--radius-panel)] bg-card p-5 shadow-md">
      <div class="flex flex-col gap-1">
        <h2 class="text-body font-medium">Description</h2>
        <p class="max-w-prose text-micro text-muted-foreground">
          What the calling model reads to decide whether this is the type to route to — not a note
          for you, a routing signal for it.
        </p>
      </div>
      <Textarea
        bind:value={draft.description}
        onblur={() => (touched.description = true)}
        rows={4}
        aria-invalid={shown('description') && problem?.includes('description') ? 'true' : undefined}
        placeholder="Read-only codebase exploration and fan-out search; returns conclusions, not file dumps."
        class="resize-y text-sm md:text-sm"
      />
      {#if shown('description') && problem?.includes('description')}
        <span class="text-micro text-destructive">{problem}</span>
      {/if}
    </section>

    <section class="flex flex-col gap-4 rounded-[var(--radius-panel)] bg-card p-5 shadow-md">
      <div class="flex flex-col gap-1">
        <h2 class="text-body font-medium">What it runs on</h2>
        <p class="max-w-prose text-micro text-muted-foreground">
          The harness and model the delegate spawns on, and how hard it should think.
        </p>
      </div>

      <div class="grid gap-4 sm:grid-cols-3">
        <label class="flex flex-col gap-1.5 text-caption">
          Harness
          <NativeSelect class="w-full" bind:value={draft.harness}>
            {#each DELEGATE_HARNESSES as harness (harness)}
              <option value={harness}>{harness}</option>
            {/each}
          </NativeSelect>
        </label>

        <label class="flex flex-col gap-1.5 text-caption">
          Model
          <Input
            bind:value={draft.model}
            onblur={() => (touched.model = true)}
            autocomplete="off"
            spellcheck="false"
            placeholder="sonnet"
            aria-invalid={shown('model') && problem?.includes('model') ? 'true' : undefined}
            class="font-mono text-sm md:text-sm"
          />
        </label>

        <label class="flex flex-col gap-1.5 text-caption">
          Effort
          <NativeSelect
            class="w-full"
            value={draft.effort ?? ''}
            onchange={(event) => {
              const next = event.currentTarget.value;
              if (next === '') delete draft.effort;
              else draft.effort = next as DelegateType['effort'];
            }}
          >
            <option value="">Unset</option>
            {#each DELEGATE_EFFORTS as effort (effort)}
              <option value={effort}>{effort}</option>
            {/each}
          </NativeSelect>
        </label>
      </div>
      {#if shown('model') && problem?.includes('model')}
        <span class="text-micro text-destructive">{problem}</span>
      {/if}
    </section>

    <section class="flex flex-col gap-4 rounded-[var(--radius-panel)] bg-card p-5 shadow-md">
      <div class="flex flex-col gap-1">
        <h2 class="text-body font-medium">What it can reach</h2>
        <p class="max-w-prose text-micro text-muted-foreground">
          Comma-separated. Both are optional narrowings, not requirements — empty means the
          delegate has the harness's ordinary defaults.
        </p>
      </div>

      <label class="flex flex-col gap-1.5 text-caption">
        Skills
        <Input
          bind:value={skillsText}
          autocomplete="off"
          spellcheck="false"
          placeholder="svelte-foundations:coding, ui-observer"
          class="font-mono text-sm md:text-sm"
        />
      </label>

      <label class="flex flex-col gap-1.5 text-caption">
        Tools denied
        <Input
          bind:value={denyToolsText}
          autocomplete="off"
          spellcheck="false"
          placeholder="Write, Edit, NotebookEdit"
          class="font-mono text-sm md:text-sm"
        />
      </label>
    </section>

    <Alert.Root
      class="rounded-[var(--radius-control)] border-[var(--border-control)] bg-[var(--surface-field)]"
    >
      <Alert.Description class="text-[length:var(--text-sm)] leading-[var(--leading-body)] text-[color:var(--ink-muted)]">
        Changes apply to new sessions only — running sessions keep the type list they started with.
      </Alert.Description>
    </Alert.Root>

    {#if failed}
      <p class="text-caption text-destructive" role="alert">{failed}</p>
    {/if}

    <div
      class="sticky bottom-0 z-10 -mx-[var(--space-3)] flex flex-wrap items-center justify-between gap-3 border-t border-border/60 bg-[var(--surface-content)] px-[var(--space-3)] py-[var(--space-4)] [padding-bottom:calc(var(--space-4)+env(safe-area-inset-bottom))]"
    >
      {#if name}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          class="text-muted-foreground hover:text-destructive"
          disabled={deleting || busy}
          onclick={askRemove}
        >
          <IconTrash class="shrink-0" />
          {deleting ? 'Deleting…' : 'Delete delegate type'}
        </Button>
      {:else}
        <span></span>
      {/if}
      <div class="flex items-center gap-2">
        <Button type="button" variant="outline" disabled={busy} onclick={() => goto('/delegates')}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy || deleting}>
          {busy ? 'Saving…' : data.composing ? 'Create delegate type' : 'Save changes'}
        </Button>
      </div>
    </div>
  </form>
</div>
