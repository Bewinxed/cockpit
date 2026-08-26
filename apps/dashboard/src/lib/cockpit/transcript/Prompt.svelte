<script lang="ts">
  /**
   * The one human-in-the-loop surface, floating above the composer: a permission
   * gate (a measurably-symmetric Approve / Deny pair, with scope-widening kept
   * apart) or a question (selectable answers plus free text). Both settle their
   * parked tool call through the client's permission answer. Ported from the
   * mock's `.hitl`.
   */
  import type { UserAnswers } from '@cockpit/core';
  import {
    cockpit,
    permissionAnswer,
    resolvePermission,
    type PendingPermission,
  } from '../client.svelte';
  import { questionsOf, questionAnswer } from '../question';
  import { permissionSummary, suggestedRule } from '../permission-summary';
  import { IconArrowUp, IconCheck, IconClose, IconShield } from '$lib/icons';
  import { Button } from '$lib/components/ui/button';

  let {
    request,
    machineId,
  }: { request: PendingPermission; machineId: string } = $props();

  const input = $derived(request.input as Record<string, unknown>);
  const questions = $derived(questionsOf(request.toolName, input));
  const summary = $derived(permissionSummary(request.toolName, input));
  const command = $derived(
    typeof input.command === 'string' ? input.command : null
  );
  const rule = $derived(request.suggestions ? suggestedRule(request.suggestions) : null);

  // The reader's selections, keyed by question text — the shape the tool reads.
  let answers = $state<UserAnswers>({});

  const allAnswered = $derived(
    !!questions && questions.every((q) => {
      const value = answers[q.question];
      return Array.isArray(value) ? value.length > 0 : !!value;
    })
  );

  function toggle(question: string, label: string, multi: boolean): void {
    if (!multi) {
      answers = { ...answers, [question]: label };
      return;
    }
    const current = answers[question];
    const list = Array.isArray(current) ? current : current ? [current] : [];
    answers = {
      ...answers,
      [question]: list.includes(label) ? list.filter((l) => l !== label) : [...list, label],
    };
  }

  const isSelected = (question: string, label: string): boolean => {
    const value = answers[question];
    return Array.isArray(value) ? value.includes(label) : value === label;
  };

  // A permission blocks the turn that asked it, so its answer must land exactly
  // once and only when it can reach the daemon that asked. `sent` latches the
  // row the instant it is answered — a double-tap, or an Enter after a click,
  // cannot answer twice — and both paths refuse while the hub is unreachable,
  // where the answer would resolve into nothing and leave the turn wedged.
  let sent = $state(false);
  const answerable = $derived(!sent && cockpit.hub === 'connected');

  function answer(kind: 'allow' | 'deny' | 'always'): void {
    if (!answerable) return;
    sent = true;
    resolvePermission(
      request.instanceId,
      machineId,
      request.requestId,
      permissionAnswer(request, kind)
    );
  }

  function submitQuestion(): void {
    if (!answerable) return;
    sent = true;
    resolvePermission(
      request.instanceId,
      machineId,
      request.requestId,
      questionAnswer(input, answers)
    );
  }

  /* shadcn <Button>, dressed in DESIGN.md tokens so nothing reads as stock
     shadcn (no 4/8/12 padding ladder, no pill radius, no --primary fill).
     Control height sits on the scale — --space-8 (32) fine, 44 coarse. */
  const btnBase =
    'h-[var(--space-8)] pointer-coarse:h-11 gap-[var(--space-2)] ' +
    'rounded-[var(--radius-control)] px-[var(--space-3)] ' +
    'text-[length:var(--text-base)] font-medium ' +
    "[&_svg:not([class*='size-'])]:size-3";

  /* The permission gate is symmetric by DESIGN.md law: Approve and Deny are
     recessed PEERS at one fill and one border — no gradient, no primary. They
     differ only in glyph and ink (grant → --ink-strong, refuse → --ink-body). */
  const peer =
    `${btnBase} flex-1 min-w-0 border border-[var(--border-control)] ` +
    'bg-[var(--surface-raised)] hover:bg-[var(--surface-hover)]';
  const grant = `${peer} text-[color:var(--ink-strong)]`;
  const refuse = `${peer} text-[color:var(--ink-body)]`;

  /* Answer IS a primary, non-destructive action, so it takes the never-flat
     brand treatment (gradient + inset action shadow). */
  const primary =
    `${btnBase} px-[var(--space-4)] border-0 text-[color:var(--on-brand)] ` +
    'bg-[var(--brand-solid)] [background-image:var(--gradient-action)] ' +
    '[box-shadow:var(--shadow-action)]';
  const dismiss =
    `${btnBase} border border-[var(--border-control)] bg-[var(--surface-raised)] ` +
    'text-[color:var(--ink-body)] hover:bg-[var(--surface-hover)]';

  /* A standing grant must read as consequential — warning tint, warning ink,
     a real edge (DESIGN.md §"A standing grant must read as consequential"). */
  const widen =
    `${btnBase} border border-[var(--status-attn-ink)] bg-[var(--status-attn-bg)] ` +
    'text-[color:var(--status-attn-ink)]';
</script>

<section class="hitl" aria-label={questions ? 'Question from the agent' : 'Permission request'}>
  {#if questions}
    <h2><span class="pill attn"><IconArrowUp />needs you</span>Question from the agent</h2>
    {#each questions as q (q.question)}
      <p class="lede">{q.question}</p>
      <div class="qopts">
        {#each q.options as opt, i (opt.label)}
          <button
            type="button"
            class:sel={isSelected(q.question, opt.label)}
            onclick={() => toggle(q.question, opt.label, q.multiSelect)}
          >
            <span class="kc">{i + 1}</span><span>{opt.label}</span>
          </button>
        {/each}
      </div>
    {/each}
    <div class="qact">
      <Button class={primary} disabled={!allAnswered || !answerable} onclick={submitQuestion}>
        <IconCheck />Answer
      </Button>
      <Button class={dismiss} disabled={!answerable} onclick={() => answer('deny')}>Dismiss</Button>
    </div>
    {#if !answerable}<p class="wait">{sent ? 'Sent.' : "Reconnecting — can't answer yet."}</p>{/if}
  {:else}
    <h2><span class="pill attn"><IconArrowUp />needs you</span>Permission — {request.toolName}</h2>
    <p class="lede">{summary}</p>
    {#if command}<div class="cmd">{command}</div>{/if}
    <!-- The disclosed payload: a summary line is not enough to grant on — an
         Edit/Write/WebFetch shows one sentence and hides the file, the diff, the
         URL it is actually about. Every field of the tool input is here, one
         disclosure away, so the grant is informed. -->
    <details class="disclose">
      <summary>What this touches</summary>
      <div class="fields">
        {#each Object.entries(input) as [key, value]}
          {@const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
          <div class="field">
            <span class="k">{key}</span>
            <pre class="v">{text}</pre>
          </div>
        {/each}
      </div>
    </details>
    <div class="choice">
      <Button class={grant} disabled={!answerable} onclick={() => answer('allow')}>
        <IconCheck />Approve
      </Button>
      <Button class={refuse} disabled={!answerable} onclick={() => answer('deny')}>
        <IconClose />Deny
      </Button>
    </div>
    {#if !answerable}<p class="wait">{sent ? 'Sent.' : "Reconnecting — can't answer yet."}</p>{/if}
    {#if rule}
      <div class="widen">
        <p>This would allow <span class="mono">{rule.full}</span> for {rule.scope} — a wider grant than the request above.</p>
        <Button class={widen} disabled={!answerable} onclick={() => answer('always')}>
          <IconShield />Always allow {rule.short}
        </Button>
      </div>
    {/if}
  {/if}
</section>

<style>
  .hitl {
    border: 1px solid var(--border-control);
    border-radius: var(--radius-panel);
    background: var(--surface-raised);
    padding: var(--space-3);
    box-shadow: var(--shadow-hairline, var(--shadow-tile));
  }
  h2 {
    font-size: var(--text-base);
    font-weight: var(--weight-strong);
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-bottom: var(--space-2);
  }
  .pill {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    height: 20px;
    padding: 0 var(--space-2);
    border-radius: var(--radius-pill);
    font-size: var(--text-sm);
    font-weight: var(--weight-strong);
    background: var(--status-attn-bg);
    color: var(--status-attn-ink);
  }
  .pill :global(svg) {
    width: 9px;
    height: 9px;
    flex: 0 0 auto;
  }
  .wait {
    margin-top: var(--space-2);
    font-size: var(--text-xs);
    color: var(--ink-muted);
  }
  .lede {
    font-size: var(--text-base);
    line-height: var(--leading-body);
    color: var(--ink-body);
    margin-bottom: var(--space-2);
    max-width: 72ch;
  }
  .cmd {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--ink-strong);
    border-left: 2px solid var(--border-divider);
    padding: 3px 0 3px var(--space-3);
    margin-bottom: var(--space-2);
    white-space: pre-wrap;
  }

  /* The disclosed payload — collapsed by default, every tool-input field inside. */
  .disclose {
    margin-bottom: var(--space-3);
  }
  .disclose > summary {
    display: inline-flex;
    align-items: center;
    width: fit-content;
    cursor: pointer;
    list-style: none;
    font-size: var(--text-xs);
    color: var(--ink-muted);
    transition: color var(--c-100) var(--e-in);
  }
  .disclose > summary::-webkit-details-marker {
    display: none;
  }
  .disclose > summary::before {
    content: '▸';
    margin-right: var(--space-2);
    transition: transform var(--c-100) var(--e-in);
  }
  .disclose[open] > summary::before {
    transform: rotate(90deg);
  }
  .disclose > summary:hover {
    color: var(--ink-body);
  }
  .fields {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin-top: var(--space-2);
    padding: var(--space-3);
    border-radius: var(--radius-well);
    background: var(--surface-sunken);
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
  }
  .field .k {
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
    color: var(--ink-muted);
  }
  .field .v {
    margin: 0;
    max-height: 200px;
    overflow: auto;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--ink-body);
    white-space: pre-wrap;
    word-break: break-word;
  }
  @media (prefers-reduced-motion: reduce) {
    .disclose > summary,
    .disclose > summary::before {
      transition: none;
    }
  }
  /* JOURNEY §Triage: the full row width sits between grant and refusal. At
     --space-2 the two sat 7px apart, close enough that a hand aiming at
     Approve lands on Deny. The gap is unfillable on purpose — no third
     control belongs between a grant and a refusal — and --space-8 is the
     floor it never falls below when the row is narrow. */
  .choice {
    display: flex;
    justify-content: space-between;
    gap: var(--space-8);
    margin-top: var(--space-2);
  }
  .choice > :global(*) {
    flex: 0 0 auto;
  }
  .widen {
    /* a clear break from the gate above, on the scale (--space-8 / --space-5) */
    margin-top: var(--space-8);
    padding-top: var(--space-5);
    border-top: 1px solid var(--border-hairline);
  }
  .widen > p {
    font-size: var(--text-sm);
    color: var(--ink-muted);
    margin-bottom: var(--space-2);
    max-width: 66ch;
  }
  /* The permission scope actually being granted is consequential text — it
     reads at --text-sm, never the 10.25px micro-label step. */
  .mono {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
  }
  .qopts {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
    margin: 2px 0 var(--space-2);
  }
  .qopts button {
    min-height: 30px;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    background: var(--surface-raised);
    color: var(--ink-strong);
    font-family: var(--font-body);
    font-size: var(--text-base);
    font-weight: var(--weight-medium);
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    cursor: pointer;
    text-align: left;
    max-width: 100%;
  }
  .qopts button.sel {
    border-color: var(--status-attn-ink);
    background: var(--status-attn-bg);
  }
  .qopts button:hover {
    background: var(--surface-hover);
  }
  .kc {
    display: inline-grid;
    place-items: center;
    min-width: 17px;
    height: 17px;
    padding: 0 4px;
    border-radius: var(--radius-mark);
    background: var(--surface-sunken);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--ink-body);
    line-height: 1;
    flex: 0 0 auto;
  }
  .qact {
    display: flex;
    gap: var(--space-2);
  }
  @media (pointer: coarse) {
    .qopts button {
      min-height: 44px;
    }
    .choice > :global(*) {
      min-height: 44px;
      min-width: 44px;
    }
  }
</style>
