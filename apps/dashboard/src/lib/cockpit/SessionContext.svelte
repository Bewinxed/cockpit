<script lang="ts">
  /**
   * The transcript's header bar — the fixed identity of the run and the settings
   * that can still change under it. Left: the session's mark, its name, the
   * `machine : path` it works in, and a status pill. Right: the harness, the
   * turns taken, how full the window is and what it has cost. Between them the
   * controls that steer the next turn — the chat/flow view, how it answers
   * permissions, which model, and how hard it thinks.
   *
   * Presentational: every fact and every callback is handed down by SessionPane,
   * which owns the session state and the sends. Rebuilt from mocks/v5-agent.html.
   */
  import type { EffortLevel, McpServerStatus, PermissionMode } from '@cockpit/core';
  import type { EffortStop } from './effort-levels';
  import type { Activity } from './activity';
  import { ACTIVITY_LABEL, SLEEPING_LABEL } from './activity';
  import { markHue, harnessGlyphPath } from './mark';
  import { PERMISSION_MODES, permissionModeLabel } from './permission-modes';
  import { modelLabel } from './models.svelte';
  import { StatusPill, ItemMark } from '$lib/outpost';
  import { IconChat, IconFlow, IconFork, IconStop, IconCheck, IconTrash } from '$lib/icons';
  import { Button, type ButtonVariant } from '$lib/components/ui/button';
  import * as ButtonGroup from '$lib/components/ui/button-group';
  import * as Popover from '$lib/components/ui/popover';
  import * as Select from '$lib/components/ui/select';
  import * as ToggleGroup from '$lib/components/ui/toggle-group';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import type { Component } from 'svelte';
  import ModelCombobox from './ModelCombobox.svelte';
  import EffortSlider from './EffortSlider.svelte';
  import McpChips from './McpChips.svelte';
  import TaskPanel from './TaskPanel.svelte';

  interface Props {
    viewId: string;
    /** A stored transcript, not a live session — no settings, no verbs. */
    browsing: string | null;
    /** What the session is about, and where it runs. */
    heading: string;
    cwdLabel: string;
    hostname: string | null;
    /** The harness id — the mark's glyph and the display name both come from it. */
    harness: string;
    activity: Activity;
    /** Its process is gone but its conversation is kept — the fourth word. */
    sleeping: boolean;
    stats: { turns: number | null; contextPct: number | null; cost: number | null };
    /** Browsing only: how much of the stored transcript there is. */
    messageCount: number;
    loading: boolean;
    scratch: boolean;

    view: 'chat' | 'flow';
    onChooseView: (value: string) => void;

    permissionMode: PermissionMode | null;
    canRelaunch: boolean;
    onChooseMode: (value: string) => void;

    currentModel: string;
    onChooseModel: (value: string) => void;

    showEffort: boolean;
    effortStops: EffortStop[];
    effort: EffortLevel | null;
    onChooseEffort: (level: EffortLevel) => void;

    mcpServers: McpServerStatus[] | null;
    machineId: string;

    forkable: boolean;
    wholeTranscript: boolean;
    connected: boolean;
    onFork: () => void;
    onStop: () => void;
    onKeep: () => void;
    onDiscard: () => void;

    /** The session's plan, when it has one — a small ring that opens the panel. */
    progress: { done: number; total: number } | null;
  }

  let {
    viewId,
    browsing,
    heading,
    cwdLabel,
    hostname,
    harness,
    activity,
    sleeping,
    stats,
    messageCount,
    loading,
    scratch,
    view,
    onChooseView,
    permissionMode,
    canRelaunch,
    onChooseMode,
    currentModel,
    onChooseModel,
    showEffort,
    effortStops,
    effort,
    onChooseEffort,
    mcpServers,
    machineId,
    forkable,
    wholeTranscript,
    connected,
    onFork,
    onStop,
    onKeep,
    onDiscard,
    progress,
  }: Props = $props();

  /** The pill's hue and word, from the one activity the session reports. */
  const pill = $derived.by((): { status: 'live' | 'attn' | 'idle'; label: string } => {
    if (sleeping) return { status: 'idle', label: SLEEPING_LABEL };
    if (activity === 'blocked') return { status: 'attn', label: ACTIVITY_LABEL.blocked };
    if (activity === 'working') return { status: 'live', label: ACTIVITY_LABEL.working };
    return { status: 'idle', label: ACTIVITY_LABEL.idle };
  });

  const hue = $derived(markHue(cwdLabel));
  const glyph = $derived(harnessGlyphPath(harness));
  const contextPct = $derived(stats.contextPct);

  /** The harness's own name, spelled the way the fleet board spells it. */
  const harnessLabel = $derived.by(() => {
    switch (harness) {
      case 'claude':
        return 'Claude Code';
      case 'opencode':
        return 'OpenCode';
      default:
        return harness;
    }
  });
</script>

{#snippet verb(opts: {
  label: string;
  tip: string;
  icon: Component;
  onclick: () => void;
  disabled?: boolean;
  variant?: ButtonVariant;
})}
  {@const Icon = opts.icon}
  <Tooltip.Root>
    <Tooltip.Trigger>
      {#snippet child({ props })}
        <Button
          {...props}
          variant={opts.variant === 'destructive' ? 'outline' : (opts.variant ?? 'outline')}
          size="sm"
          class="text-xs {opts.variant === 'destructive'
            ? 'text-destructive hover:bg-destructive/10 hover:text-destructive'
            : ''}"
          disabled={opts.disabled}
          aria-label={opts.label}
          onclick={opts.onclick}
        >
          <Icon />
          <span class="hidden 2xl:inline">{opts.label}</span>
        </Button>
      {/snippet}
    </Tooltip.Trigger>
    <Tooltip.Content>{opts.tip}</Tooltip.Content>
  </Tooltip.Root>
{/snippet}

<Tooltip.Provider delayDuration={200}>
<header class="shead">
  <a class="back" href="/session" aria-label="Back to fleet board">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
  </a>

  <ItemMark {hue}>
    <svg viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={glyph} /></svg>
  </ItemMark>

  <h1 class="title" title={[heading, cwdLabel].join('\n')}>{heading}</h1>
  <span class="path">{hostname ? `${hostname} : ` : ''}{cwdLabel}</span>

  <StatusPill status={pill.status}>
    {#snippet icon()}
      {#if pill.status === 'live'}
        <svg viewBox="0 0 12 12" fill="currentColor" aria-hidden="true"><circle cx="6" cy="6" r="3.1" /></svg>
      {:else if pill.status === 'attn'}
        <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9.4V2.6M3 5.6 6 2.6l3 3" /></svg>
      {/if}
    {/snippet}
    {pill.label}
  </StatusPill>

  {#if scratch}
    <span class="quest">side quest</span>
  {/if}

  <div class="controls">
    <ToggleGroup.Root
      type="single"
      variant="outline"
      size="sm"
      value={view}
      onValueChange={onChooseView}
      class="shrink-0"
      aria-label="Session view"
    >
      <ToggleGroup.Item value="chat" aria-controls="session-view-panel" aria-label="Chat">
        <IconChat />
        <span class="hidden sm:inline">Chat</span>
      </ToggleGroup.Item>
      <ToggleGroup.Item value="flow" aria-controls="session-view-panel" aria-label="Flow">
        <IconFlow />
        <span class="hidden sm:inline">Flow</span>
      </ToggleGroup.Item>
    </ToggleGroup.Root>

    {#if !browsing}
      <ButtonGroup.Root class="shrink-0">
        <Select.Root type="single" value={permissionMode ?? ''} onValueChange={onChooseMode}>
          <Select.Trigger
            size="sm"
            aria-label={permissionMode ? 'Permission mode' : 'Permission mode, not reported yet'}
            title={permissionMode
              ? 'How this session answers tool permissions'
              : "Read from this session's next turn — it has not said how it answers tool permissions"}
            class="text-xs {permissionMode === 'bypassPermissions'
              ? 'font-medium text-warning'
              : 'text-muted-foreground'}"
          >
            {permissionMode ? permissionModeLabel(permissionMode) : '—'}
          </Select.Trigger>
          <Select.Content>
            {#each PERMISSION_MODES as option (option.value)}
              {@const locked =
                option.value === 'bypassPermissions' &&
                option.value !== permissionMode &&
                !canRelaunch}
              <Select.Item
                value={option.value}
                label={option.label}
                disabled={locked}
                title={locked
                  ? 'This session has not started yet — try again in a moment'
                  : option.description}
                class={locked ? 'opacity-40' : ''}
              >
                <span class="flex flex-col">
                  <span class={option.value === 'bypassPermissions' ? 'text-warning' : ''}>
                    {option.label}
                  </span>
                  <span class="text-xs text-muted-foreground">{option.description}</span>
                </span>
              </Select.Item>
            {/each}
          </Select.Content>
        </Select.Root>

        <ModelCombobox
          value={currentModel}
          onchoose={onChooseModel}
          class="text-xs text-muted-foreground"
        />

        {#if showEffort}
          <Popover.Root>
            <Popover.Trigger
              class="flex min-h-8 shrink-0 items-center rounded-md border border-border px-2.5
                font-mono text-xs text-muted-foreground transition-colors duration-150 ease-out
                hover:bg-accent hover:text-foreground"
              title={effort
                ? 'How hard this session thinks, and how much it spends doing it'
                : 'No effort level has been asked for — this session is running at its model’s own'}
              aria-label="Reasoning effort"
            >
              {effort ?? '—'}
            </Popover.Trigger>
            <Popover.Content class="material-panel w-[320px] p-3" align="end">
              <EffortSlider
                stops={effortStops}
                value={effort}
                modelName={modelLabel(currentModel)}
                onchange={onChooseEffort}
              />
            </Popover.Content>
          </Popover.Root>
        {/if}
      </ButtonGroup.Root>

      {#if mcpServers && mcpServers.length > 0}
        <McpChips servers={mcpServers} instanceId={viewId} {machineId} />
      {/if}

      {#if progress}
        <Popover.Root>
          <Popover.Trigger
            class="flex min-h-8 shrink-0 items-center gap-1.5 rounded-full px-2 text-micro
              tabular-nums text-muted-foreground transition-colors duration-150 ease-out hover:bg-accent"
            aria-label="Tasks: {progress.done} of {progress.total} done"
          >
            {progress.done}/{progress.total} tasks
          </Popover.Trigger>
          <Popover.Content
            class="material-panel max-h-[480px] w-[380px] overflow-y-auto p-0"
            align="end"
          >
            <TaskPanel {viewId} />
          </Popover.Content>
        </Popover.Root>
      {/if}

      <ButtonGroup.Root class="shrink-0">
        {@render verb({
          label: 'Fork',
          tip: 'Branch a side quest off this session',
          icon: IconFork,
          onclick: onFork,
          disabled: !forkable || !wholeTranscript,
        })}
        {#if scratch}
          {@render verb({
            label: 'Keep',
            tip: 'Promote this side quest to mainline work',
            icon: IconCheck,
            onclick: onKeep,
          })}
          {@render verb({
            label: 'Discard',
            tip: "Delete this quest's worktree and its transcript, for good",
            icon: IconTrash,
            onclick: onDiscard,
            variant: 'destructive',
          })}
        {:else}
          {@render verb({
            label: 'Stop',
            tip: 'End this session',
            icon: IconStop,
            onclick: onStop,
          })}
        {/if}
      </ButtonGroup.Root>
    {/if}
  </div>

  <div class="meta" role="status" aria-live="polite">
    {#if browsing}
      <span>Transcript</span>
      <span><b>{loading ? '—' : messageCount}</b> messages</span>
    {:else}
      <span>{harnessLabel}</span>
      {#if stats.turns !== null}
        <span><b>{stats.turns}</b> turns</span>
      {/if}
      {#if contextPct !== null}
        <span><b>{Math.round(contextPct)}%</b> context</span>
      {/if}
      {#if stats.cost !== null && stats.cost > 0}
        <span><b>${stats.cost.toFixed(2)}</b></span>
      {/if}
    {/if}
  </div>
</header>
</Tooltip.Provider>

<style>
  .shead {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    height: 57px;
    flex-shrink: 0;
    padding: 0 var(--space-5) 0 var(--space-6);
    border-bottom: 1px solid var(--border-hairline);
    background: var(--surface-raised);
    min-width: 0;
  }

  .back {
    width: 32px;
    height: 32px;
    flex: 0 0 auto;
    display: grid;
    place-items: center;
    border: 1px solid var(--border-hairline);
    border-radius: var(--radius-control);
    background: var(--surface-raised);
    color: var(--ink-body);
  }
  .back:hover {
    background: var(--surface-field);
    color: var(--ink-strong);
  }
  .back svg {
    width: 17px;
    height: 17px;
  }

  .title {
    font-size: var(--text-md);
    font-weight: var(--weight-strong);
    letter-spacing: var(--track-display);
    color: var(--ink-strong);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 0 1 auto;
    min-width: 4ch;
  }

  .path {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--ink-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1 1 auto;
    min-width: 0;
  }

  .quest {
    flex: 0 0 auto;
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: var(--track-caps);
    color: var(--ink-muted);
    border: 1px dashed var(--border-divider);
    border-radius: var(--radius-mark);
    padding: 2px 6px;
  }

  .controls {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex: 0 0 auto;
    margin-left: auto;
  }

  .meta {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    flex: 0 0 auto;
    font-size: var(--text-sm);
    color: var(--ink-muted);
  }
  .meta b {
    font-weight: var(--weight-strong);
    color: var(--ink-body);
    font-variant-numeric: tabular-nums;
  }

  @media (max-width: 1100px) {
    .meta {
      display: none;
    }
  }
  @media (max-width: 640px) {
    .shead {
      padding: 0 var(--space-4);
      gap: var(--space-2);
    }
    .path {
      display: none;
    }
  }
</style>
