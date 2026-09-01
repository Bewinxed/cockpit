<script lang="ts">
  /**
   * Per-session autopilot toggle — a button in the composer's control row that
   * opens a popover (desktop) or drawer (mobile) with the standing-prompt
   * textarea and enable switch. State reads from the instance row in the store;
   * writes go through `PUT /api/autopilot/:id` via autopilot.ts.
   */
  import type { InstanceRow } from '@whiffle/core';
  import { IsMobile } from '$lib/hooks/is-mobile.svelte';
  import { IconSkill } from '$lib/icons';
  import * as Popover from '$lib/components/ui/popover';
  import * as Drawer from '$lib/components/ui/drawer';
  import Switch from '$lib/components/ui/switch/switch.svelte';
  import { setAutopilot } from './autopilot';

  let {
    instanceId,
    instance,
  }: {
    instanceId: string;
    instance: InstanceRow | undefined;
  } = $props();

  const narrow = new IsMobile(900);

  let open = $state(false);
  let saving = $state(false);
  let error = $state<string | null>(null);

  /** Local draft — seeded from the instance row each time the popover opens. */
  let draft = $state('');
  let enabled = $state(false);

  const active = $derived(instance?.autopilot?.enabled === true);

  function seed() {
    draft = instance?.autopilot?.prompt ?? '';
    enabled = instance?.autopilot?.enabled ?? false;
    error = null;
  }

  function onOpenChange(next: boolean) {
    if (next) seed();
    open = next;
  }

  async function save() {
    if (saving) return;
    if (enabled && draft.trim().length < 10) {
      error = 'The standing prompt needs at least 10 characters.';
      return;
    }
    saving = true;
    error = null;
    try {
      await setAutopilot(instanceId, { enabled, prompt: draft.trim() });
      open = false;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      saving = false;
    }
  }
</script>

{#snippet body()}
  <div class="ap-body">
    <label class="ap-row">
      <span class="ap-label">Autopilot</span>
      <Switch bind:checked={enabled} size="sm" />
    </label>

    <textarea
      class="ap-prompt"
      bind:value={draft}
      placeholder="What should the autopilot watch for and how should it respond?"
      rows="4"
      aria-label="Standing prompt"
    ></textarea>

    {#if error}
      <p class="ap-error">{error}</p>
    {/if}

    <button class="ap-save" type="button" onclick={save} disabled={saving}>
      {saving ? 'Saving…' : 'Save'}
    </button>
  </div>
{/snippet}

{#if narrow.current}
  <Drawer.Root bind:open onOpenChange={onOpenChange}>
    <Drawer.Trigger>
      {#snippet child({ props })}
        <button
          {...props}
          class="ap-trigger"
          class:ap-active={active}
          type="button"
          aria-pressed={active}
          aria-label={active ? 'Autopilot enabled' : 'Autopilot'}
        >
          <IconSkill />
        </button>
      {/snippet}
    </Drawer.Trigger>
    <Drawer.Content class="max-h-[85vh] pb-[calc(1rem+env(safe-area-inset-bottom))]">
      <Drawer.Header class="p-0 pb-3 text-left">
        <Drawer.Title class="text-left">Autopilot</Drawer.Title>
      </Drawer.Header>
      {@render body()}
    </Drawer.Content>
  </Drawer.Root>
{:else}
  <Popover.Root bind:open onOpenChange={onOpenChange}>
    <Popover.Trigger>
      {#snippet child({ props })}
        <button
          {...props}
          class="ap-trigger"
          class:ap-active={active}
          type="button"
          aria-pressed={active}
          aria-label={active ? 'Autopilot enabled' : 'Autopilot'}
        >
          <IconSkill />
        </button>
      {/snippet}
    </Popover.Trigger>
    <Popover.Content align="start" side="top" sideOffset={8} class="w-72 p-0">
      <div class="ap-popover-inner">
        <p class="ap-title">Autopilot</p>
        {@render body()}
      </div>
    </Popover.Content>
  </Popover.Root>
{/if}

<style>
  .ap-trigger {
    width: var(--cin-ctl, 34px);
    height: var(--cin-ctl, 34px);
    flex: 0 0 auto;
    display: grid;
    place-items: center;
    cursor: pointer;
    border-radius: calc(var(--radius-panel) - var(--cin-pad, var(--space-2)));
    border: 1px solid var(--border-control);
    background: var(--surface-raised);
    color: var(--ink-muted);
    transition:
      background-color var(--c-100) var(--e-in),
      color var(--c-100) var(--e-in),
      transform var(--c-100) var(--e-in);
  }
  .ap-trigger :global(svg) {
    width: 17px;
    height: 17px;
  }
  @media (hover: hover) and (pointer: fine) {
    .ap-trigger:hover {
      background: var(--surface-hover);
      color: var(--ink-body);
    }
  }
  .ap-trigger:active {
    transform: scale(0.96);
  }
  .ap-trigger:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }
  /* Active state: accent-colored glyph, no solid fill. */
  .ap-active {
    color: var(--accent-text);
    border-color: var(--accent-text);
  }

  .ap-popover-inner {
    padding: var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .ap-title {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--ink-strong);
    margin: 0;
  }
  .ap-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .ap-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    cursor: pointer;
  }
  .ap-label {
    font-size: var(--text-sm);
    color: var(--ink-body);
    font-weight: 500;
  }
  .ap-prompt {
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    background: var(--surface-field);
    color: var(--ink-strong);
    font-family: var(--font-body);
    font-size: var(--text-sm);
    line-height: var(--leading-ui);
    padding: var(--space-2) var(--space-3);
    resize: vertical;
    min-height: 80px;
    outline: none;
  }
  .ap-prompt:focus {
    border-color: var(--ring);
    box-shadow: 0 0 0 2px oklch(from var(--ring) l c h / 0.15);
  }
  .ap-prompt::placeholder {
    color: var(--ink-muted);
  }
  .ap-error {
    font-size: var(--text-xs, 12px);
    color: var(--error);
    margin: 0;
    line-height: var(--leading-ui);
  }
  .ap-save {
    align-self: flex-end;
    height: 30px;
    padding: 0 var(--space-4);
    font-size: var(--text-sm);
    font-weight: 500;
    border: 0;
    border-radius: var(--radius-control);
    background: var(--brand-solid);
    background-image: var(--gradient-action);
    box-shadow: var(--shadow-action);
    color: var(--on-brand);
    cursor: pointer;
    transition:
      opacity var(--c-100) var(--e-in),
      transform var(--c-100) var(--e-in);
  }
  .ap-save:hover {
    opacity: 0.92;
  }
  .ap-save:active {
    transform: scale(0.97);
  }
  .ap-save:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .ap-save:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }
</style>
