<script lang="ts">
  /**
   * An answered (or dismissed) `AskUserQuestion` as it settled in the transcript
   * history — the same `.hitl` anatomy as the live prompt, but read-only: the
   * chosen option carries `.sel`, and any freeform reply shows under the options.
   * Ported from the mock's `#q-card` (.hitl / .lede / .qopts / .kc).
   */
  import type { Message } from '../types';
  import type { UserQuestion, UserQuestionResult, UserAnswers } from '@cockpit/core';
  import { questionsOf } from '../question';
  import { IconCheck, IconClose } from '$lib/icons';

  let { message }: { message: Message } = $props();

  const input = $derived((message.metadata?.toolInput ?? {}) as Record<string, unknown>);
  const questions = $derived<UserQuestion[]>(
    questionsOf(message.metadata?.toolName ?? '', input) ?? []
  );
  const result = $derived(message.metadata?.toolUseResult as UserQuestionResult | undefined);
  const answered = $derived(result?.outcome === 'answered');
  const dismissed = $derived(result?.outcome === 'dismissed');
  const answers = $derived<UserAnswers>(
    result?.outcome === 'answered' ? result.answers : {}
  );
  const freeform = $derived(result?.outcome === 'answered' ? result.response : undefined);

  const chosen = (question: string): string[] => {
    const value = answers[question];
    return Array.isArray(value) ? value : value ? [value] : [];
  };
  const isSelected = (question: string, label: string): boolean =>
    chosen(question).includes(label);
  /** A freeform answer whose text matches no listed option label. */
  const otherText = (q: UserQuestion): string | null => {
    const picks = chosen(q.question);
    const labels = new Set(q.options.map((o) => o.label));
    const other = picks.find((p) => !labels.has(p));
    return other ?? null;
  };
</script>

<section class="hitl" aria-label="Question from the agent">
  <h2>
    {#if answered}
      <span class="pill done"><IconCheck />answered</span>
    {:else if dismissed}
      <span class="pill muted"><IconClose />dismissed</span>
    {:else}
      <span class="pill attn">needs you</span>
    {/if}
    Question from the agent
  </h2>

  {#each questions as q (q.question)}
    <p class="lede">{q.question}</p>
    <div class="qopts">
      {#each q.options as opt, i (opt.label)}
        <span class="opt" class:sel={isSelected(q.question, opt.label)}>
          <span class="kc">{i + 1}</span><span>{opt.label}</span>
        </span>
      {/each}
    </div>
    {#if otherText(q)}
      <p class="answer-free"><span class="lbl">Answered</span>{otherText(q)}</p>
    {/if}
  {/each}

  {#if freeform}
    <p class="answer-free"><span class="lbl">In your own words</span>{freeform}</p>
  {/if}
</section>

<style>
  .hitl {
    border: 1px solid var(--border-control);
    border-radius: var(--radius-panel);
    background: var(--surface-raised);
    margin: 10px 0 0 7px;
    padding: 13px;
    box-shadow: var(--shadow-hairline, var(--shadow-tile));
  }
  h2 {
    font-size: var(--text-base);
    font-weight: var(--weight-strong);
    color: var(--ink-strong);
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
    white-space: nowrap;
  }
  .pill :global(svg) {
    width: 9px;
    height: 9px;
    flex: 0 0 auto;
  }
  .pill.attn {
    background: var(--status-attn-bg);
    color: var(--status-attn-ink);
  }
  .pill.done {
    background: var(--status-done-bg, var(--surface-sunken));
    color: var(--status-done-ink, var(--ink-body));
  }
  .pill.muted {
    background: var(--surface-sunken);
    color: var(--ink-muted);
  }
  .lede {
    font-size: var(--text-base);
    line-height: var(--leading-body);
    color: var(--ink-body);
    margin-bottom: 9px;
    max-width: 72ch;
  }
  .qopts {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    margin: 2px 0 9px;
  }
  .opt {
    min-height: 30px;
    padding: 7px 11px;
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    background: var(--surface-raised);
    color: var(--ink-muted);
    font-family: var(--font-body);
    font-size: var(--text-base);
    font-weight: var(--weight-medium);
    display: inline-flex;
    align-items: center;
    gap: 8px;
    text-align: left;
    max-width: 100%;
  }
  .opt.sel {
    border-color: var(--status-attn-ink);
    background: var(--status-attn-bg);
    color: var(--ink-strong);
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
  .answer-free {
    font-size: var(--text-sm);
    line-height: var(--leading-body);
    color: var(--ink-body);
    max-width: 72ch;
    display: flex;
    gap: 8px;
    align-items: baseline;
  }
  .answer-free .lbl {
    font-size: var(--text-xs);
    font-weight: var(--weight-strong);
    text-transform: uppercase;
    letter-spacing: 0.02em;
    color: var(--ink-muted);
    flex: 0 0 auto;
  }
  @media (max-width: 900px) {
    .hitl {
      margin-left: 0;
    }
  }
  @media (pointer: coarse) {
    .opt {
      min-height: 44px;
    }
  }
</style>
