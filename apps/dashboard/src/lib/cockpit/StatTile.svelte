<script lang="ts">
  /**
   * The stat tile — a raised card wrapping a sunken hairline well, the
   * DESIGN.md signature move. Optionally carries an icon tile (top-left
   * of the well), a subtitle, and a semantic badge.
   */
  import type { Snippet } from 'svelte';
  import * as Card from '$lib/components/ui/card';

  interface Props {
    label: string;
    value: string | number;
    unit?: string;
    icon?: Snippet;
    href?: string;
    onclick?: () => void;
    tone?: 'default' | 'attn' | 'warn' | 'good';
    subtitle?: string;
    badge?: string;
    badgeTone?: 'good' | 'warn' | 'bad';
  }

  let {
    label,
    value,
    unit,
    icon,
    href,
    onclick,
    tone = 'default',
    subtitle,
    badge,
    badgeTone,
  }: Props = $props();
</script>

{#if href}
  <a class="st-link" {href}>
    <Card.Root class="st-card">
      <div class="st-well">
        {#if icon}
          <span class="st-icon st-tone-{tone}">
            {@render icon()}
          </span>
        {/if}
        <span class="st-label">{label}</span>
        <span class="st-value">{value}</span>
        {#if unit}<span class="st-unit">{unit}</span>{/if}
        {#if subtitle || badge}
          <span class="st-foot">
            {#if subtitle}<span class="st-sub">{subtitle}</span>{/if}
            {#if badge}<span class="st-badge st-badge-{badgeTone ?? 'good'}">{badge}</span>{/if}
          </span>
        {/if}
      </div>
    </Card.Root>
  </a>
{:else}
  <Card.Root class="st-card">
    <div class="st-well">
      {#if icon}
        <span class="st-icon st-tone-{tone}">
          {@render icon()}
        </span>
      {/if}
      <span class="st-label">{label}</span>
      <span class="st-value">{value}</span>
      {#if unit}<span class="st-unit">{unit}</span>{/if}
      {#if subtitle || badge}
        <span class="st-foot">
          {#if subtitle}<span class="st-sub">{subtitle}</span>{/if}
          {#if badge}<span class="st-badge st-badge-{badgeTone ?? 'good'}">{badge}</span>{/if}
        </span>
      {/if}
    </div>
  </Card.Root>
{/if}

<style>
  .st-link {
    text-decoration: none;
    color: inherit;
    display: block;
    height: 100%;
  }

  :global {
    .st-card {
      height: 100%;
      background: var(--surface-raised);
      border-radius: var(--radius-panel);
      box-shadow: var(--shadow-lifted);
      padding: var(--c-card-pad);
      overflow: visible;
      --tw-ring-shadow: 0 0 transparent;
    }
  }

  .st-well {
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
    gap: var(--c-card-gap);
    justify-content: center;
    background: var(--surface-field);
    border: 1px solid var(--border-hairline);
    border-radius: var(--radius-well);
    padding: var(--c-card-pad);
  }

  .st-icon {
    width: 24px;
    height: 24px;
    display: grid;
    place-items: center;
    border-radius: var(--radius-tile);
    background: var(--surface-raised);
    box-shadow: var(--shadow-xs);
    flex: 0 0 auto;
  }
  .st-icon :global(svg) {
    width: 14px;
    height: 14px;
    display: block;
  }

  .st-tone-attn {
    background: var(--status-attn-bg);
    color: var(--status-attn-ink);
  }
  .st-tone-warn {
    background: var(--status-warn-bg, var(--surface-raised));
    color: var(--data-warn);
  }
  .st-tone-good {
    background: var(--status-ok-bg, var(--surface-raised));
    color: var(--data-ok);
  }

  .st-label {
    color: var(--ink-label);
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
  }

  .st-value {
    font-size: var(--text-3xl);
    font-weight: var(--weight-strong);
    line-height: var(--leading-numeric);
    color: var(--ink-strong);
    font-variant-numeric: tabular-nums;
  }

  .st-unit {
    color: var(--ink-muted);
    font-size: var(--text-sm);
  }

  .st-foot {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .st-sub {
    font-size: var(--text-xs);
    color: var(--ink-muted);
  }

  .st-badge {
    font-size: var(--text-xs);
    font-weight: var(--weight-strong);
    text-transform: uppercase;
    letter-spacing: var(--track-caps);
    padding: 1px var(--space-2);
    border-radius: var(--radius-pill);
  }
  .st-badge-good {
    background: var(--status-ok-bg, oklch(0.95 0.04 145));
    color: var(--data-ok);
  }
  .st-badge-warn {
    background: var(--status-warn-bg, oklch(0.95 0.05 85));
    color: var(--data-warn);
  }
  .st-badge-bad {
    background: var(--status-fail-bg, oklch(0.95 0.05 25));
    color: var(--data-bad);
  }

  @media (max-width: 900px) {
    .st-value {
      font-size: var(--text-2xl);
    }
  }
</style>
