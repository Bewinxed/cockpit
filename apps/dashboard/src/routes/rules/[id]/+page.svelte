<script lang="ts">
  import { newId } from '$lib/cockpit/id';
  import { untrack } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { toast } from 'svelte-sonner';
  import type { HarnessKind, RuleDraft, RuleTiming, RuleWatch } from '@cockpit/core';
  import { HARNESSES, ruleProblem, ruleSentence } from '@cockpit/core';
  import { IconArrowRight, IconTrash } from '$lib/icons';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { NativeSelect } from '$lib/components/ui/native-select';
  import { Switch } from '$lib/components/ui/switch';
  import { Textarea } from '$lib/components/ui/textarea';
  import { Toggle } from '$lib/components/ui/toggle';
  import * as ToggleGroup from '$lib/components/ui/toggle-group';
  import { cockpit } from '$lib/cockpit/client.svelte';
  import RuleActivity from '$lib/cockpit/RuleActivity.svelte';
  import RuleTester from '$lib/cockpit/RuleTester.svelte';
  import { blankRule, draftOf, message, removeRule, saveRule } from '$lib/cockpit/rules';
  import { confirm } from '$lib/cockpit/confirm.svelte';
  import type { PageData } from './$types';

  /**
   * The rule editor.
   *
   * A rule is a sentence, and this screen is that sentence twice: once read
   * back in English at the top, live, and once as the fields that compose it.
   * The English is not decoration — it is the only place the interaction
   * between timing, interruption and acknowledgement is legible at a glance,
   * and it is what catches a rule that says something its author did not mean.
   *
   * Its own page rather than a dialog: there are four groups of decisions and a
   * test box here, and a modal that has to scroll is a modal that should have
   * been a page.
   */
  let { data }: { data: PageData } = $props();

  let draft = $state<RuleDraft>(untrack(() => (data.rule ? draftOf(data.rule) : blankRule())));
  let sample = $state('');
  let busy = $state(false);
  let deleting = $state(false);
  let failed = $state<string | undefined>(undefined);
  /** Problems are held back until a field has been left, so typing is not nagged at. */
  let touched = $state<Record<string, boolean>>({});
  let attempted = $state(false);

  const id = $derived(data.composing ? null : page.params.id);
  const wrong = $derived(ruleProblem(draft));
  const shown = (field: string): string | undefined =>
    attempted || touched[field] ? wrong[field] : undefined;

  const duplicate = $derived(
    draft.name.trim() !== '' && data.taken.includes(draft.name.trim())
      ? 'Another rule already has that name. Two rules called the same thing are two rules you cannot tell apart in a transcript.'
      : undefined
  );

  /** Every model the fleet is actually running, so the filter is not free text. */
  const models = $derived([
    ...new Set(
      cockpit.instances
        .map((row) => row.model)
        .filter((model): model is string => typeof model === 'string' && model !== '')
    ),
  ].sort());

  const TIMING: { value: RuleTiming; label: string; how: string }[] = [
    {
      value: 'turn',
      label: 'When the turn ends',
      how: 'The session has stopped and is idle, so your reply wakes it into a new turn. This is the one that makes it keep working.',
    },
    {
      value: 'message',
      label: 'When the message ends',
      how: 'Queued as soon as the message that tripped the rule is complete. The session reads it at the next turn boundary, uninterrupted.',
    },
    {
      value: 'immediate',
      label: 'The moment it appears',
      how: 'Sent mid-message, as soon as the words show up in the stream.',
    },
  ];

  const WATCH: { value: RuleWatch; label: string }[] = [
    { value: 'text', label: 'What it says' },
    { value: 'thinking', label: 'What it thinks' },
    { value: 'both', label: 'Both' },
  ];

  const how = $derived(TIMING.find((option) => option.value === draft.timing)?.how ?? '');

  /** Interruption is only meaningful mid-turn; changing away from it clears the flag. */
  function setTiming(next: RuleTiming) {
    draft.timing = next;
    if (next !== 'immediate') draft.interrupt = false;
  }

  /** A blank select means "everywhere", which is stored as the key being absent. */
  function narrow(key: 'machineId' | 'projectId' | 'harness' | 'model', value: string) {
    if (value === '') delete draft.scope[key];
    else if (key === 'harness') draft.scope.harness = value as HarnessKind;
    else draft.scope[key] = value;
  }

  const ready = $derived(Object.keys(wrong).length === 0 && duplicate === undefined);

  async function save(event: SubmitEvent) {
    event.preventDefault();
    attempted = true;
    if (!ready || busy) return;
    busy = true;
    failed = undefined;
    try {
      await saveRule(id ?? newId(), { ...draft, name: draft.name.trim() });
      toast.success(`${draft.name.trim()} is live on every session it applies to.`);
      await goto('/rules', { invalidateAll: true });
    } catch (error) {
      failed = message(error);
    } finally {
      busy = false;
    }
  }

  async function askRemove() {
    if (!id) return;
    const ok = await confirm({
      title: `Delete ${draft.name || 'this rule'}?`,
      body: "This rule stops applying to every session and is removed for good. You can always write it again, but there's no undo.",
      confirmLabel: 'Delete rule',
      destructive: true,
    });
    if (ok) await remove();
  }

  async function remove() {
    if (!id) return;
    deleting = true;
    try {
      await removeRule(id, draft.name);
      await goto('/rules', { invalidateAll: true });
    } catch (error) {
      failed = message(error);
      deleting = false;
    }
  }
</script>

<svelte:head>
  <title>{data.composing ? 'New rule' : draft.name || 'Rule'} · cockpit</title>
</svelte:head>

<div class="flex-1 overflow-y-auto p-6">
  <form class="mx-auto flex max-w-2xl flex-col gap-6" onsubmit={save}>
    <a
      href="/rules"
      class="flex w-fit items-center gap-1 text-micro text-muted-foreground hover:text-foreground"
    >
      <IconArrowRight class="size-3 shrink-0 rotate-180" />
      Rules
    </a>

    {#if data.error}
      <div class="rounded-[var(--radius-card)] bg-card p-4 shadow-md" role="alert">
        <p class="text-caption text-warning">{data.error}</p>
      </div>
    {/if}

    <header class="flex flex-col gap-3">
      <label class="flex flex-col gap-1.5">
        <span class="sr-only">Rule name</span>
        <input
          bind:value={draft.name}
          onblur={() => (touched.name = true)}
          placeholder="Name this rule"
          autocomplete="off"
          spellcheck="false"
          aria-invalid={shown('name') || duplicate ? 'true' : undefined}
          class="w-full border-0 bg-transparent p-0 text-display text-foreground caret-primary outline-none placeholder:text-faint"
        />
      </label>
      {#if shown('name')}
        <p class="text-micro text-destructive">{wrong.name}</p>
      {:else if duplicate}
        <p class="text-micro text-destructive">{duplicate}</p>
      {/if}

      <!-- The rule, read back. It is the only place the whole thing is one thought. -->
      <p
        class="max-w-prose rounded-[var(--radius-card)] bg-primary/8 p-4 text-body text-foreground transition-all duration-240 ease-[var(--e-in)]"
        aria-live="polite"
      >
        {ruleSentence(draft)}
      </p>

      <label class="flex w-fit items-center gap-3">
        <Switch bind:checked={draft.enabled} />
        <span class="text-caption">
          {draft.enabled ? 'Watching every session it applies to' : 'Off — it watches nothing'}
        </span>
      </label>
    </header>

    <section class="flex flex-col gap-4 rounded-[var(--radius-panel)] bg-card p-5 shadow-md">
      <div class="flex flex-col gap-1">
        <h2 class="text-body font-medium">What to watch for</h2>
        <p class="max-w-prose text-micro text-muted-foreground">
          Cockpit reads what a session writes, not what you write to it.
        </p>
      </div>

      <ToggleGroup.Root
        type="single"
        variant="outline"
        size="sm"
        value={draft.matchKind}
        onValueChange={(next) => next && (draft.matchKind = next as 'phrase' | 'regex')}
        class="w-full"
      >
        <ToggleGroup.Item value="phrase" class="flex-1 text-caption">A phrase</ToggleGroup.Item>
        <ToggleGroup.Item value="regex" class="flex-1 text-caption">
          A regular expression
        </ToggleGroup.Item>
      </ToggleGroup.Root>

      <label class="flex flex-col gap-1.5 text-caption">
        {draft.matchKind === 'phrase' ? 'Phrase' : 'Expression'}
        <Input
          bind:value={draft.pattern}
          onblur={() => (touched.pattern = true)}
          autocomplete="off"
          spellcheck="false"
          aria-invalid={shown('pattern') ? 'true' : undefined}
          placeholder={draft.matchKind === 'phrase'
            ? 'honest caveat'
            : 'should (work|be fine)|probably works'}
          class="font-mono text-sm md:text-sm"
        />
        {#if shown('pattern')}
          <span class="text-micro text-destructive">{wrong.pattern}</span>
        {:else if draft.matchKind === 'regex'}
          <span class="text-micro text-muted-foreground">
            JavaScript syntax. It is matched against the whole message, not line by line.
          </span>
        {/if}
      </label>

      <div class="flex flex-wrap items-center gap-2">
        <Toggle
          variant="outline"
          size="sm"
          pressed={draft.caseSensitive}
          onPressedChange={(next) => (draft.caseSensitive = next)}
        >
          Case sensitive
        </Toggle>
        {#if draft.matchKind === 'phrase'}
          <Toggle
            variant="outline"
            size="sm"
            pressed={draft.wholeWord}
            onPressedChange={(next) => (draft.wholeWord = next)}
          >
            Whole words only
          </Toggle>
        {/if}
      </div>

      <fieldset class="flex flex-col gap-1.5 text-caption">
        <legend class="mb-1.5">Read</legend>
        <ToggleGroup.Root
          type="single"
          variant="outline"
          size="sm"
          value={draft.watch}
          onValueChange={(next) => next && (draft.watch = next as RuleWatch)}
          class="w-full"
        >
          {#each WATCH as option (option.value)}
            <ToggleGroup.Item value={option.value} class="flex-1 text-caption">
              {option.label}
            </ToggleGroup.Item>
          {/each}
        </ToggleGroup.Root>
        {#if draft.watch !== 'text' && draft.timing === 'turn'}
          <span class="text-micro text-warning">
            Reasoning is not kept once a turn is over. To watch thinking, fire on the message or the
            moment instead.
          </span>
        {/if}
      </fieldset>

      <RuleTester {draft} bind:sample />
    </section>

    <section class="flex flex-col gap-4 rounded-[var(--radius-panel)] bg-card p-5 shadow-md">
      <div class="flex flex-col gap-1">
        <h2 class="text-body font-medium">What cockpit sends back</h2>
        <p class="max-w-prose text-micro text-muted-foreground">
          The session is told this is cockpit and not you, so it does not answer you for something
          you never said.
        </p>
      </div>

      <label class="flex flex-col gap-1.5 text-caption">
        Reply
        <Textarea
          bind:value={draft.reply}
          onblur={() => (touched.reply = true)}
          rows={4}
          aria-invalid={shown('reply') ? 'true' : undefined}
          placeholder="if there's an honest caveat that you are aware of and you're just reporting it to the user instead of fixing it, then your work is not done yet"
          class="resize-y text-sm md:text-sm"
        />
        {#if shown('reply')}
          <span class="text-micro text-destructive">{wrong.reply}</span>
        {/if}
      </label>

      <fieldset class="flex flex-col gap-1.5 text-caption">
        <legend class="mb-1.5">Send it</legend>
        <ToggleGroup.Root
          type="single"
          variant="outline"
          size="sm"
          value={draft.timing}
          onValueChange={(next) => next && setTiming(next as RuleTiming)}
          class="w-full"
        >
          {#each TIMING as option (option.value)}
            <ToggleGroup.Item value={option.value} class="flex-1 text-caption">
              {option.label}
            </ToggleGroup.Item>
          {/each}
        </ToggleGroup.Root>
        <span class="max-w-prose text-micro text-muted-foreground">{how}</span>
      </fieldset>

      {#if draft.timing === 'immediate'}
        <label class="flex items-start gap-3">
          <Switch bind:checked={draft.interrupt} class="mt-0.5" />
          <span class="flex flex-col gap-0.5">
            <span class="text-caption">Interrupt the running turn</span>
            <span class="max-w-prose text-micro text-muted-foreground">
              A claude session reads it mid-turn without stopping. Other harnesses cut the turn
              short to deliver it, which loses whatever they were partway through.
            </span>
          </span>
        </label>
      {/if}
    </section>

    <section class="flex flex-col gap-4 rounded-[var(--radius-panel)] bg-card p-5 shadow-md">
      <div class="flex flex-col gap-1">
        <h2 class="text-body font-medium">Where it applies</h2>
        <p class="max-w-prose text-micro text-muted-foreground">
          Everywhere unless you narrow it. Each filter you set has to match for the rule to fire.
        </p>
      </div>

      <div class="grid gap-4 sm:grid-cols-2">
        <label class="flex flex-col gap-1.5 text-caption">
          Machine
          <NativeSelect
            class="w-full"
            value={draft.scope.machineId ?? ''}
            onchange={(event) => narrow('machineId', event.currentTarget.value)}
          >
            <option value="">Every machine</option>
            {#each cockpit.machines as machine (machine.machineId)}
              <option value={machine.machineId}>{machine.hostname}</option>
            {/each}
          </NativeSelect>
        </label>

        <label class="flex flex-col gap-1.5 text-caption">
          Project
          <NativeSelect
            class="w-full"
            value={draft.scope.projectId ?? ''}
            onchange={(event) => narrow('projectId', event.currentTarget.value)}
          >
            <option value="">Every project</option>
            {#each cockpit.projects as project (project.id)}
              <option value={project.id}>{project.name}</option>
            {/each}
          </NativeSelect>
        </label>

        <label class="flex flex-col gap-1.5 text-caption">
          Harness
          <NativeSelect
            class="w-full"
            value={draft.scope.harness ?? ''}
            onchange={(event) => narrow('harness', event.currentTarget.value)}
          >
            <option value="">Every harness</option>
            {#each HARNESSES as harness (harness)}
              <option value={harness}>{harness}</option>
            {/each}
          </NativeSelect>
        </label>

        <label class="flex flex-col gap-1.5 text-caption">
          Model
          <NativeSelect
            class="w-full"
            value={draft.scope.model ?? ''}
            onchange={(event) => narrow('model', event.currentTarget.value)}
          >
            <option value="">Every model</option>
            {#each models as model (model)}
              <option value={model}>{model}</option>
            {/each}
            {#if draft.scope.model && !models.includes(draft.scope.model)}
              <option value={draft.scope.model}>{draft.scope.model}</option>
            {/if}
          </NativeSelect>
          <span class="text-micro text-muted-foreground">
            Matched as a substring, so a family name covers every dated build of it.
          </span>
        </label>
      </div>
    </section>

    <section class="flex flex-col gap-4 rounded-[var(--radius-panel)] bg-card p-5 shadow-md">
      <div class="flex flex-col gap-1">
        <h2 class="text-body font-medium">Making it stick</h2>
        <p class="max-w-prose text-micro text-muted-foreground">
          A note a session can read and walk past is a note a session will read and walk past.
        </p>
      </div>

      <label class="flex items-start gap-3">
        <Switch bind:checked={draft.requireAck} class="mt-0.5" />
        <span class="flex flex-col gap-0.5">
          <span class="text-caption">Keep firing until the session acknowledges</span>
          <span class="max-w-prose text-micro text-muted-foreground">
            {#if draft.requireAck}
              The session has to call <span class="font-mono">acknowledge_rule</span> and say what it
              did about it. Until then the rule fires again every time it is tripped, and the reminder
              counts up. It stops after ten in one session.
            {:else}
              The rule fires once per session and then goes quiet, whether or not anything came of
              it.
            {/if}
          </span>
        </span>
      </label>
    </section>

    <!-- Only a saved rule has a history; a draft has caught nothing by definition. -->
    {#if id}
      <RuleActivity ruleId={id} />
    {/if}

    {#if failed}
      <p class="text-caption text-destructive" role="alert">{failed}</p>
    {/if}

    <!-- Pinned: on a long rule the Save used to scroll off, so the reader edited
         with no way to commit in view. It rides the foot of the viewport now. -->
    <div
      class="sticky bottom-0 z-10 -mx-[var(--space-3)] flex flex-wrap items-center justify-between gap-3 border-t border-border/60 bg-[var(--surface-content)] px-[var(--space-3)] py-[var(--space-4)] [padding-bottom:calc(var(--space-4)+env(safe-area-inset-bottom))]"
    >
      {#if id}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          class="text-muted-foreground hover:text-destructive"
          disabled={deleting || busy}
          onclick={askRemove}
        >
          <IconTrash class="shrink-0" />
          {deleting ? 'Deleting…' : 'Delete rule'}
        </Button>
      {:else}
        <span></span>
      {/if}
      <div class="flex items-center gap-2">
        <Button type="button" variant="outline" disabled={busy} onclick={() => goto('/rules')}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy || deleting}>
          {busy ? 'Saving…' : data.composing ? 'Create rule' : 'Save changes'}
        </Button>
      </div>
    </div>
  </form>
</div>
