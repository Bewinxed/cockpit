<script lang="ts">
  /**
   * The one parked request the reader answers rather than approves. It rides the
   * permission channel like any other tool call (see `ASK_USER_QUESTION`), so it
   * belongs in the same stack — but approve/deny is the wrong pair of buttons
   * for it, and a reader given those two can only refuse the question.
   */
  import { IconCheck, IconChecklist, IconClose, IconHelp, IconSend } from '$lib/icons';
  import type { PermissionResult, UserAnswers, UserQuestion } from '@cockpit/core';
  import { isTyping } from '$lib/utils/typing';
  import type { PendingPermission } from './client.svelte';
  import { questionAnswer, questionDismissal } from './question';
  import { Button } from '$lib/components/ui/button';

  /* shadcn <Button> dressed on the DESIGN.md scale — never the stock ladder.
     Send answer is a primary, non-destructive action → the never-flat brand
     treatment; dismiss is a quiet recessed control. */
  const sendBtn =
    'h-[var(--space-8)] pointer-coarse:h-11 gap-[var(--space-2)] ' +
    'rounded-[var(--radius-control)] px-[var(--space-3)] border-0 ' +
    'text-[length:var(--text-base)] font-medium ' +
    'text-[color:var(--on-brand)] bg-[var(--brand-solid)] ' +
    '[background-image:var(--gradient-action)] [box-shadow:var(--shadow-action)] ' +
    "[&_svg:not([class*='size-'])]:size-3";

  interface Props {
    request: PendingPermission;
    questions: UserQuestion[];
    /** Whether the keyboard answers this card — the stack's top one. */
    shortcuts?: boolean;
    onResolve: (requestId: string, result: PermissionResult) => void;
  }

  let { request, questions, shortcuts = false, onResolve }: Props = $props();

  /** The labels chosen per question. More than one only where `multiSelect`. */
  let chosen = $state<string[][]>(questions.map(() => []));
  /** What was typed into the "Other" the tool promises the model it will offer. */
  let custom = $state<(string | null)[]>(questions.map(() => null));
  /** Which question the digits answer, and the only one showing their hints. */
  let current = $state(0);
  /** The answer travels before the card is dropped; it says it heard you meanwhile. */
  let sent = $state(false);

  const answerOf = (index: number): string | string[] | null => {
    const typed = custom[index]?.trim();
    if (typed) return typed;
    const picked = chosen[index];
    if (picked.length === 0) return null;
    return questions[index].multiSelect ? picked : picked[0];
  };

  const complete = $derived(questions.every((_, index) => answerOf(index) !== null));

  /** The digits move to whatever is still unanswered, so a card reads "2 1 ⏎". */
  function advance() {
    const next = questions.findIndex((_, index) => answerOf(index) === null);
    if (next !== -1) current = next;
  }

  function toggle(index: number, label: string) {
    if (sent) return;
    current = index;
    custom[index] = null;
    const picked = chosen[index];
    if (questions[index].multiSelect) {
      chosen[index] = picked.includes(label)
        ? picked.filter((chose) => chose !== label)
        : [...picked, label];
      return;
    }
    chosen[index] = picked[0] === label ? [] : [label];
    if (chosen[index].length > 0) advance();
  }

  function type(index: number, text: string) {
    custom[index] = text;
    if (text.trim()) chosen[index] = [];
  }

  function submit() {
    if (sent || !complete) return;
    sent = true;
    const answers: UserAnswers = {};
    questions.forEach((question, index) => {
      const answer = answerOf(index);
      if (answer !== null) answers[question.question] = answer;
    });
    onResolve(request.requestId, questionAnswer(request.input, answers));
  }

  function dismiss() {
    if (sent) return;
    sent = true;
    onResolve(request.requestId, questionDismissal);
  }

  /**
   * Only the top card takes the keys, and only while the reader is not writing
   * somewhere — the same rule the permission shortcuts follow, which is what
   * lets a digit mean an option here and a character in the composer.
   */
  function handleKeydown(event: KeyboardEvent) {
    if (!shortcuts || sent || event.metaKey || event.ctrlKey || event.altKey || isTyping()) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      dismiss();
      return;
    }
    if (event.key >= '1' && event.key <= '9') {
      const option = questions[current]?.options[Number(event.key) - 1];
      if (!option) return;
      event.preventDefault();
      toggle(current, option.label);
      return;
    }
    if (event.key === 'Enter' && complete) {
      event.preventDefault();
      submit();
    }
  }

  const kbd = 'rounded-md bg-muted px-1.5 py-0.5 font-mono text-micro text-muted-foreground shadow-sm border border-border/50';
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="bg-card rounded-[var(--radius-panel)] shadow-sm p-[var(--space-3)]" role="alert">
  <div class="flex items-start gap-[var(--space-2)]">
    <div class="text-primary mt-0.5 shrink-0">
      {#if questions.some((question) => question.multiSelect)}
        <IconChecklist class="size-[18px]" />
      {:else}
        <IconHelp class="size-[18px]" />
      {/if}
    </div>

    <div class="flex min-w-0 flex-1 flex-col gap-[var(--space-3)]">
      <div class="flex items-start justify-between gap-[var(--space-3)]">
        <div class="text-foreground text-sm font-semibold">
          {questions.length > 1 ? `${questions.length} questions for you` : 'A question for you'}
        </div>
        <div class="-mt-0.5 flex shrink-0 items-center gap-[var(--space-2)]">
          {#if shortcuts}
            <kbd class={kbd}>Esc</kbd>
          {/if}
          <button
            type="button"
            disabled={sent}
            class="text-muted-foreground hover:text-error hover:bg-error/10 flex size-7 items-center
                   justify-center rounded-md transition-[color,background-color] duration-200 ease-out
                   disabled:opacity-40"
            onclick={dismiss}
            aria-label="Dismiss without answering"
            title="Dismiss without answering"
          >
            <IconClose class="size-3.5" />
          </button>
        </div>
      </div>

      <!-- One question at a time. Four questions of four options each is taller
           than the dock it opens in, and the reader cannot scroll a card that
           has already pushed its own scrollbar off screen. `current` was
           already tracking which question the digits answer; this makes the
           layout agree with the keyboard. -->
      {#each [questions[current]] as question (question.question)}
        {@const index = current}
        <div class="flex max-h-[50vh] flex-col gap-[var(--space-2)] overflow-y-auto pr-1">
          <div class="flex flex-wrap items-baseline gap-[var(--space-2)]">
            <span
              class="bg-primary/10 text-primary rounded-full px-[var(--space-2)] py-px text-xs font-semibold tracking-wider uppercase"
            >
              {question.header}
            </span>
            {#if question.multiSelect}
              <span class="text-muted-foreground text-xs">Pick as many as you like</span>
            {/if}
          </div>
          <p class="text-foreground text-sm leading-snug font-medium">{question.question}</p>

          <div
            class="flex flex-col gap-[var(--space-2)]"
            role={question.multiSelect ? 'group' : 'radiogroup'}
            aria-label={question.question}
          >
            {#each question.options as option, position (option.label)}
              {@const picked = chosen[index].includes(option.label)}
              <button
                type="button"
                role={question.multiSelect ? 'checkbox' : 'radio'}
                aria-checked={picked}
                disabled={sent}
                class="flex w-full items-start gap-[var(--space-2)] rounded-[var(--radius-control)] border px-[var(--space-3)] py-[var(--space-2)] text-left
                       transition-[background-color,border-color] duration-150 ease-out
                       disabled:cursor-not-allowed disabled:opacity-60
                       {picked
                  ? 'border-primary/30 bg-primary/10 text-foreground'
                  : 'border-border bg-card text-foreground hover:bg-accent'}"
                onclick={() => toggle(index, option.label)}
              >
                <span
                  class="mt-0.5 flex size-4 shrink-0 items-center justify-center border-2
                         {question.multiSelect ? 'rounded-sm' : 'rounded-full'}
                         {picked
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-muted-foreground/40'}"
                >
                  {#if picked}
                    <IconCheck class="size-2.5" />
                  {/if}
                </span>
                <span class="min-w-0 flex-1">
                  <span class="flex items-center gap-[var(--space-2)]">
                    <span class="text-sm font-medium">{option.label}</span>
                    {#if shortcuts && index === current && position < 9}
                      <kbd class={kbd}>{position + 1}</kbd>
                    {/if}
                  </span>
                  {#if option.description}
                    <span class="text-muted-foreground mt-0.5 block text-xs leading-relaxed">
                      {option.description}
                    </span>
                  {/if}
                </span>
              </button>
            {/each}

            <!-- The tool tells the model not to offer an "Other" because this is
                 where it comes from; without it the only answer to four options
                 the reader disagrees with is to dismiss the question. -->
            <input
              type="text"
              disabled={sent}
              aria-label="Answer in your own words"
              placeholder="Or answer in your own words…"
              class="border-border bg-card text-foreground placeholder:text-muted-foreground
                     focus:border-primary/50 focus:ring-primary/20 w-full rounded-[var(--radius-control)] border px-[var(--space-3)] py-[var(--space-2)]
                     text-sm focus:ring-2 focus:outline-none disabled:opacity-60"
              value={custom[index] ?? ''}
              oninput={(event) => type(index, event.currentTarget.value)}
              onfocus={() => (current = index)}
              onkeydown={(event) => {
                if (event.key !== 'Enter' || !complete) return;
                event.preventDefault();
                submit();
              }}
            />
          </div>
        </div>
      {/each}

      <div class="flex flex-wrap items-center justify-between gap-[var(--space-3)]">
        <div class="flex items-center gap-[var(--space-2)]">
          {#if questions.length > 1}
            <!-- Dots rather than "2 of 3" alone: they show which questions are
                 already answered, so the reader can see what is left without
                 stepping through it. -->
            <div class="flex items-center gap-[var(--space-1)]" role="tablist" aria-label="Questions">
              {#each questions as question, index (question.question)}
                <button
                  type="button"
                  role="tab"
                  disabled={sent}
                  aria-selected={index === current}
                  aria-label="{question.header} — {answerOf(index) === null
                    ? 'not answered'
                    : 'answered'}"
                  title={question.header}
                  class="size-2 rounded-full transition-[background-color,transform] duration-150 ease-out
                         disabled:opacity-40
                         {index === current
                    ? 'bg-primary scale-125'
                    : answerOf(index) !== null
                      ? 'bg-primary/50'
                      : 'bg-muted-foreground/30 hover:bg-muted-foreground/60'}"
                  onclick={() => (current = index)}
                ></button>
              {/each}
            </div>
            <span class="text-muted-foreground text-xs tabular-nums">
              {current + 1} of {questions.length}
            </span>
          {/if}
          <p class="text-muted-foreground text-xs">
            {#if shortcuts}
              <kbd class={kbd}>1-9</kbd> choose · <kbd class={kbd}>Enter</kbd> send
            {/if}
          </p>
        </div>
        <!-- One primary button that means what is actually next: paging past an
             unanswered question and then finding a dead "Send answer" is how a
             reader gets stuck on a card they cannot finish. -->
        <Button
          disabled={sent || (complete ? false : answerOf(current) === null)}
          class={sendBtn}
          onclick={() => (complete ? submit() : advance())}
        >
          {#if complete}
            <IconSend class="size-3.5" />
            <span>{sent ? 'Sent' : 'Send answer'}</span>
          {:else}
            <span>Next</span>
          {/if}
        </Button>
      </div>
    </div>
  </div>
</div>
