<script lang="ts">
  /**
   * The run's fixed identity bar: back + mark + title + `machine : path` and a
   * state pill on the left; the Chat / Flow toggle, permission-mode and model in
   * the middle; harness · turns · context% on the right. Ported from the mock's
   * `.shead`.
   */
  import { ItemMark, StatusPill } from '$lib/outpost';
  import { harnessGlyphPath, markHue } from '../mark';
  import type { Activity } from '../activity';
  import { IconChevronRight, IconChat, IconFlow } from '$lib/icons';

  let {
    title,
    harness,
    seed,
    machineName,
    cwd,
    activity,
    model,
    permissionMode,
    mcpCount,
    turns,
    totalTokens,
    maxTokens,
    cost,
    view,
    onview,
  }: {
    title: string;
    harness: string;
    seed: string;
    machineName: string;
    cwd: string;
    activity: Activity;
    model: string | null;
    permissionMode: string | null;
    mcpCount: number | null;
    turns: number | null;
    totalTokens: number | null;
    maxTokens: number | null;
    cost: number | null;
    view: 'chat' | 'flow';
    onview: (v: 'chat' | 'flow') => void;
  } = $props();

  const k = (n: number): string => `${Math.round(n / 1000)}k`;

  const pill = $derived(
    activity === 'blocked'
      ? { status: 'attn' as const, label: 'needs you' }
      : activity === 'working'
        ? { status: 'live' as const, label: 'working' }
        : { status: 'idle' as const, label: 'idle' }
  );
</script>

<header class="shead">
  <a class="back" href="/session" aria-label="Back to fleet board"><IconChevronRight /></a>
  <ItemMark hue={markHue(seed)}>
    <svg viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round">
      <path d={harnessGlyphPath(harness)} />
    </svg>
  </ItemMark>
  <h1>{title}</h1>
  <span class="path">{machineName} : {cwd}</span>

  <StatusPill status={pill.status}>{pill.label}</StatusPill>

  <div class="mid">
    <div class="toggle" role="tablist" aria-label="Transcript view">
      <button type="button" role="tab" aria-selected={view === 'chat'} class:on={view === 'chat'} onclick={() => onview('chat')}>
        <IconChat />Chat
      </button>
      <button type="button" role="tab" aria-selected={view === 'flow'} class:on={view === 'flow'} onclick={() => onview('flow')}>
        <IconFlow />Flow
      </button>
    </div>
    {#if permissionMode}<span class="tag">{permissionMode}</span>{/if}
    {#if model}<span class="tag">{model}</span>{/if}
    {#if mcpCount}<span class="tag">{mcpCount} MCP</span>{/if}
  </div>

  <div class="meta">
    <span>{harness}</span>
    {#if turns !== null}<span><b>{turns}</b> turns</span>{/if}
    {#if totalTokens !== null && maxTokens}<span><b>{k(totalTokens)}</b>/{k(maxTokens)}</span>{/if}
    {#if cost !== null}<span><b>${cost.toFixed(2)}</b></span>{/if}
  </div>
</header>

<style>
  .shead {
    height: 57px;
    border-bottom: 1px solid var(--border-hairline);
    background: var(--surface-raised);
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 21px 0 25px;
    flex-shrink: 0;
  }
  .back {
    width: 34px;
    height: 34px;
    border: 1px solid var(--border-control);
    background: var(--surface-raised);
    border-radius: var(--radius-control);
    display: grid;
    place-items: center;
    color: var(--ink-body);
    flex: 0 0 auto;
    text-decoration: none;
  }
  .back :global(svg) {
    width: 18px;
    height: 18px;
    transform: rotate(180deg);
  }
  .back:hover {
    background: var(--surface-hover);
  }
  h1 {
    font-size: var(--text-md);
    font-weight: var(--weight-strong);
    letter-spacing: var(--track-display);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 30ch;
  }
  .path {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--ink-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }
  .mid {
    margin-left: 12px;
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 0 0 auto;
  }
  .toggle {
    display: inline-flex;
    padding: 2px;
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    background: var(--surface-field);
  }
  .toggle button {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 26px;
    padding: 0 10px;
    border: 0;
    border-radius: calc(var(--radius-control) - 2px);
    background: none;
    color: var(--ink-muted);
    font-family: var(--font-body);
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
    cursor: pointer;
  }
  .toggle button.on {
    background: var(--surface-raised);
    color: var(--ink-strong);
    box-shadow: var(--shadow-tile);
    font-weight: var(--weight-strong);
  }
  .toggle button :global(svg) {
    width: 14px;
    height: 14px;
  }
  .tag {
    font-size: var(--text-sm);
    color: var(--ink-body);
    background: var(--surface-field);
    border: 1px solid var(--border-hairline);
    border-radius: var(--radius-pill);
    padding: 2px 9px;
    white-space: nowrap;
  }
  .meta {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 14px;
    font-size: var(--text-sm);
    color: var(--ink-muted);
    flex: 0 0 auto;
  }
  .meta b {
    font-weight: var(--weight-strong);
    color: var(--ink-body);
    font-variant-numeric: tabular-nums;
  }
  /* Mobile: the bar wraps to its own rows, hugs the edges, and sheds the
     turns/context/cost meta — the same reshape as the mock's narrow header. */
  @media (max-width: 900px) {
    .shead {
      height: auto;
      flex-wrap: wrap;
      padding: 10px 16px;
      row-gap: 8px;
    }
    .meta {
      display: none;
    }
  }
  @media (pointer: coarse) {
    .back {
      min-width: 44px;
      min-height: 44px;
    }
  }
</style>
