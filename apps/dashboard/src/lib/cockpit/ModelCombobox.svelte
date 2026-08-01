<script lang="ts">
  /**
   * Which model answers — for a session that is running, and for one that is
   * still a form. `supportedModels()` only reports what Claude Code offers
   * today, so the list is a suggestion rather than the set: anything typed goes
   * through verbatim, which is the only way a legacy id is reachable at all.
   */
  import { tick } from 'svelte';
  import { HugeiconsIcon } from '@hugeicons/svelte';
  import { UnfoldMoreIcon } from '@hugeicons/core-free-icons';
  import { IconRefresh } from '$lib/icons';
  import * as Command from '$lib/components/ui/command';
  import * as Popover from '$lib/components/ui/popover';
  import { Button, type ButtonSize } from '$lib/components/ui/button';
  import {
    covers,
    ensureModels,
    MODEL_DEFAULT,
    modelLabel,
    models,
    refreshModels,
    rememberModel,
  } from './models.svelte';

  let {
    value,
    onchoose,
    showDefault = false,
    size = 'sm',
    class: className = '',
  }: {
    /** The model in force, as the id it is known by. `''` is the SDK's own choice. */
    value: string;
    /** Chosen. Rejections belong to the caller — it owns the slot they show in. */
    onchoose: (model: string) => void | Promise<void>;
    /** Whether "Default" is offered — it is, wherever no model at all is a choice. */
    showDefault?: boolean;
    size?: ButtonSize;
    class?: string;
  } = $props();

  let open = $state(false);
  let typed = $state('');
  let triggerRef = $state<HTMLButtonElement | null>(null);

  /**
   * Where "Default" is not on offer, no model is not a choice anyone made — it
   * is a session that has not reported one yet, and naming a model would be
   * inventing its settings. The next `system.init` fills it in.
   */
  const unreported = $derived(!value && !showDefault);

  const trimmed = $derived(typed.trim());
  /** A typed id nothing on the list already covers — the whole point of the field. */
  const custom = $derived(
    trimmed.length > 0 &&
      !models.offered.some((row) => covers(row, trimmed)) &&
      !models.recent.includes(trimmed)
  );

  /** Why the list is thin, when it is — said under it rather than as a fake row. */
  const note = $derived(
    models.error ??
      (models.loading
        ? 'Asking a running session what it offers…'
        : models.offered.length === 0
          ? 'No list yet — refresh it through a running session, or type an id.'
          : null)
  );

  function opened(next: boolean) {
    if (next) ensureModels();
    else typed = '';
  }

  /** Keyboard users carry on through the form instead of losing focus to the body. */
  function closeAndFocusTrigger() {
    open = false;
    typed = '';
    void tick().then(() => triggerRef?.focus());
  }

  /** Already running it — an init names the wire id, its row is keyed by the alias. */
  const isCurrent = (model: string) =>
    model === value || models.offered.some((row) => row.value === model && covers(row, value));

  async function choose(model: string, remember = false) {
    closeAndFocusTrigger();
    if (remember) rememberModel(model);
    if (!isCurrent(model)) await onchoose(model);
  }

  // The picker says for itself why a refresh failed; it is about the list, not
  // about the session, so it never reaches the page's error slot — and the
  // popover stays open, because the point was to look at what came back.
  const refresh = () => void refreshModels().catch(() => {});
</script>

<Popover.Root bind:open onOpenChange={opened}>
  <Popover.Trigger bind:ref={triggerRef}>
    {#snippet child({ props })}
      <Button
        {...props}
        variant="outline"
        {size}
        role="combobox"
        aria-expanded={open}
        aria-label={unreported ? 'Model, not reported yet' : 'Model'}
        title={unreported
          ? "Read from this session's next turn — it has not said which model answers"
          : value || 'The model Claude Code picks for itself'}
        class="justify-between gap-2 {className}"
      >
        <span class="truncate">{unreported ? '—' : modelLabel(value)}</span>
        <HugeiconsIcon icon={UnfoldMoreIcon} strokeWidth={2} class="size-4 shrink-0 opacity-50" />
      </Button>
    {/snippet}
  </Popover.Trigger>

  <Popover.Content class="w-80 p-0" align="start">
    <Command.Root>
      <Command.Input bind:value={typed} placeholder="Search, or type a model id…" />
      <Command.List>
        {#if !custom}
          <Command.Empty>No model here goes by that.</Command.Empty>
        {/if}

        {#if models.recent.length > 0}
          <Command.Group heading="Recently used">
            {#each models.recent as id (id)}
              <Command.Item
                value={id}
                title={id}
                data-checked={id === value}
                onSelect={() => void choose(id)}
              >
                <span class="truncate font-mono text-xs">{id}</span>
              </Command.Item>
            {/each}
          </Command.Group>
        {/if}

        <Command.Group heading="Models">
          {#if showDefault}
            <Command.Item
              value="default-model"
              keywords={['default']}
              data-checked={value === MODEL_DEFAULT}
              onSelect={() => void choose(MODEL_DEFAULT)}
            >
              <span class="flex flex-col">
                <span>Default</span>
                <span class="text-xs text-muted-foreground">
                  Whatever Claude Code would have picked
                </span>
              </span>
            </Command.Item>
          {/if}
          {#each models.offered as row (row.value)}
            <Command.Item
              value={row.value}
              keywords={[row.displayName]}
              title={row.value}
              data-checked={covers(row, value)}
              onSelect={() => void choose(row.value)}
            >
              <span class="flex flex-col">
                <span>{row.displayName}</span>
                <span class="text-xs text-muted-foreground">{row.description}</span>
              </span>
            </Command.Item>
          {/each}
        </Command.Group>

        {#if custom}
          <Command.Group heading="Custom">
            <Command.Item forceMount value={trimmed} onSelect={() => void choose(trimmed, true)}>
              <span class="flex flex-col">
                <span>Use <span class="font-mono">{trimmed}</span></span>
                <span class="text-xs text-muted-foreground">
                  Sent to Claude Code exactly as typed
                </span>
              </span>
            </Command.Item>
          </Command.Group>
        {/if}

        <Command.Separator />
        <Command.Group>
          <Command.Item
            forceMount
            value="refresh-models"
            disabled={!models.askable || models.loading}
            title={models.askable
              ? 'Ask a running session what Claude Code offers today'
              : 'A session has to be running to ask what models it offers.'}
            onSelect={refresh}
          >
            <IconRefresh />
            Refresh models
          </Command.Item>
        </Command.Group>
      </Command.List>

      {#if note}
        <p
          class="border-t border-foreground/5 px-3 py-2 text-xs {models.error
            ? 'text-error'
            : 'text-muted-foreground'}"
          role={models.error ? 'alert' : undefined}
        >
          {note}
        </p>
      {/if}
    </Command.Root>
  </Popover.Content>
</Popover.Root>
