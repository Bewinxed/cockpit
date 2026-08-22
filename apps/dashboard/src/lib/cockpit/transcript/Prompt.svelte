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
    permissionAnswer,
    resolvePermission,
    type PendingPermission,
  } from '../client.svelte';
  import { questionsOf, questionAnswer } from '../question';
  import { permissionSummary, suggestedRule } from '../permission-summary';
  import { IconArrowUp, IconCheck, IconClose, IconShield } from '$lib/icons';

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

  function answer(kind: 'allow' | 'deny' | 'always'): void {
    resolvePermission(
      request.instanceId,
      machineId,
      request.requestId,
      permissionAnswer(request, kind)
    );
  }

  function submitQuestion(): void {
    resolvePermission(
      request.instanceId,
      machineId,
      request.requestId,
      questionAnswer(input, answers)
    );
  }
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
      <button type="button" class="answer" disabled={!allAnswered} onclick={submitQuestion}>
        <IconCheck />Answer
      </button>
      <button type="button" class="dismiss" onclick={() => answer('deny')}>Dismiss</button>
    </div>
  {:else}
    <h2><span class="pill attn"><IconArrowUp />needs you</span>Permission — {request.toolName}</h2>
    <p class="lede">{summary}</p>
    {#if command}<div class="cmd">{command}</div>{/if}
    <div class="choice">
      <button type="button" class="grant" onclick={() => answer('allow')}>
        <IconCheck />Approve
      </button>
      <button type="button" class="refuse" onclick={() => answer('deny')}>
        <IconClose />Deny
      </button>
    </div>
    {#if rule}
      <div class="widen">
        <p>This would allow <span class="mono">{rule.full}</span> for {rule.scope} — a wider grant than the request above.</p>
        <button type="button" onclick={() => answer('always')}>
          <IconShield />Always allow {rule.short}
        </button>
      </div>
    {/if}
  {/if}
</section>

<style>
  .hitl {
    border: 1px solid var(--border-control);
    border-radius: var(--radius-panel);
    background: var(--surface-raised);
    padding: 13px;
    box-shadow: var(--shadow-hairline, var(--shadow-tile));
  }
  h2 {
    font-size: var(--text-base);
    font-weight: var(--weight-strong);
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 7px;
  }
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 20px;
    padding: 0 9px;
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
  .lede {
    font-size: var(--text-base);
    line-height: var(--leading-body);
    color: var(--ink-body);
    margin-bottom: 9px;
    max-width: 72ch;
  }
  .cmd {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--ink-strong);
    border-left: 2px solid var(--border-divider);
    padding: 3px 0 3px 10px;
    margin-bottom: 8px;
    white-space: pre-wrap;
  }
  .choice {
    display: flex;
    gap: 9px;
    margin-top: 9px;
  }
  .choice button {
    flex: 1 1 0;
    min-width: 0;
    height: 34px;
    padding: 0 12px;
    border-radius: var(--radius-control);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    font-family: var(--font-body);
    font-size: var(--text-base);
    font-weight: var(--weight-strong);
    cursor: pointer;
    background: var(--surface-raised);
    border: 1px solid var(--border-control);
  }
  .choice button.grant {
    color: var(--ink-strong);
  }
  .choice button.refuse {
    color: var(--ink-body);
  }
  .choice button :global(svg) {
    width: 12px;
    height: 12px;
    flex: 0 0 auto;
  }
  .choice button:hover {
    background-color: var(--surface-hover);
  }
  .widen {
    margin-top: 40px;
    padding-top: 18px;
    border-top: 1px solid var(--border-hairline);
  }
  .widen > p {
    font-size: var(--text-sm);
    color: var(--ink-muted);
    margin-bottom: 8px;
    max-width: 66ch;
  }
  .widen button {
    height: 34px;
    padding: 0 13px;
    border: 1px solid var(--status-attn-ink);
    border-radius: var(--radius-control);
    background: var(--status-attn-bg);
    color: var(--status-attn-ink);
    font-family: var(--font-body);
    font-size: var(--text-base);
    font-weight: var(--weight-strong);
    display: inline-flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
  }
  .widen button :global(svg) {
    width: 11px;
    height: 11px;
    flex: 0 0 auto;
  }
  .mono {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }
  .qopts {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    margin: 2px 0 9px;
  }
  .qopts button {
    min-height: 30px;
    padding: 7px 11px;
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    background: var(--surface-raised);
    color: var(--ink-strong);
    font-family: var(--font-body);
    font-size: var(--text-base);
    font-weight: var(--weight-medium);
    display: inline-flex;
    align-items: center;
    gap: 8px;
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
    gap: 9px;
  }
  .qact button {
    height: 34px;
    padding: 0 14px;
    border-radius: var(--radius-control);
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-family: var(--font-body);
    font-size: var(--text-base);
    font-weight: var(--weight-strong);
    cursor: pointer;
    border: 1px solid var(--border-control);
    background: var(--surface-raised);
    color: var(--ink-strong);
  }
  .qact button :global(svg) {
    width: 12px;
    height: 12px;
  }
  .qact .dismiss {
    color: var(--ink-body);
    font-weight: var(--weight-medium);
  }
  .qact button:disabled {
    opacity: 0.45;
    cursor: default;
  }
  @media (pointer: coarse) {
    .choice button,
    .widen button,
    .qopts button,
    .qact button {
      min-height: 44px;
    }
  }
</style>
