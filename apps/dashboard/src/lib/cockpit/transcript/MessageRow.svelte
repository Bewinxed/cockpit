<script lang="ts">
  /** Dispatches one stand-alone transcript message to its renderer by type. */
  import type { Message } from '../types';
  import Who from './Who.svelte';
  import MessageBody from './MessageBody.svelte';
  import Thinking from './Thinking.svelte';
  import Peer from './Peer.svelte';
  import SystemLine from './SystemLine.svelte';
  import { Badge } from '$lib/components/ui/badge';
  import { canResend, commandRecord, retrySend, restoreDraft } from '../client.svelte';

  /** A token-dressed micro count badge — shadcn Badge, off the stock 4/8/12
   *  ladder and onto the DESIGN.md scale so it never reads as stock shadcn. */
  const chipClass =
    'h-auto rounded-[var(--radius-mark)] border-transparent bg-[var(--surface-sunken)] ' +
    'px-[var(--space-2)] py-px text-[length:var(--text-xs)] font-[var(--weight-body)] ' +
    '!text-[color:var(--ink-muted)]';

  let { message, agentName }: { message: Message; agentName: string } = $props();

  const kind = $derived(message.type);
  const hidden = $derived(
    kind === 'result.success' || (kind === 'assistant' && !message.content.trim())
  );

  /*
   * ───────────────────────────────────────────────────────────────────────
   * GHOST STORYBOARD — the reader's own turn, while its command is still
   * being answered. Fires on EVERY message the reader sends, so it must stay
   * sub-attention until there is something worth noticing.
   *
   *    0ms   ghost is on screen: presence 0.7, Who reads "sending…", no clock
   *  tACK    the command leaves `submitted` (well under a second, on a live hub)
   *  +0ms    presence 0.7 → 1.0; Who's note slot swaps to the real clock —
   *          same slot Queued.svelte already uses, so settling moves nothing
   * +180ms   at rest. No translation, no scale: arrival is subtraction.
   *
   * fail (from the same ghost, instead of settling):
   *    0ms   presence 0.7 → 1.0 — the words matter MORE on failure, not less
   *    0ms   Who's note becomes "not sent"
   *  +40ms   the reason line and its actions unfold (grid-rows 0fr → 1fr)
   * +240ms   at rest. The unfold is the one layout change, and it is the
   *          information: something new must be read.
   * ───────────────────────────────────────────────────────────────────────
   */
  const GHOST = {
    presence: 0.7, // Queued.svelte's own number — shared on purpose: same tense
    settleMs: 180, // ms — our choice: quiet, inside app.css's ≤320ms doctrine
    failDelayMs: 40, // ms — the chip flips first, the reason follows: cause → effect
    failRevealMs: 200, // ms — delay + reveal = 240ms, the one animation allowed to be noticed
  };

  /**
   * The command this turn went out as, read straight off the ledger — the
   * same pattern Prompt.svelte uses for its own card's answer. No record (a
   * historical message, a swept one, or one from before this tab existed)
   * renders solid: absence of evidence is a solid message, never a ghost.
   */
  const record = $derived(
    kind === 'user' && message.metadata?.sentAs ? commandRecord(message.metadata.sentAs) : null
  );
  const ghost = $derived(record?.stage === 'submitted');
  /**
   * `sendFailed` outlives the record's own five-minute sweep (see its doc in
   * types.ts), so a message that failed does not quietly fade back to solid
   * once the ledger has forgotten it — the stamp is read even after `record`
   * itself goes back to `null`.
   */
  const failed = $derived(record?.stage === 'failed' || !!message.metadata?.sendFailed);
  const reason = $derived(message.metadata?.sendFailed ?? record?.reason);

  /**
   * Whether the payload behind this row is still in hand.
   *
   * `sendFailed` is stamped permanently — deliberately, so a message that never
   * sent never fades back to looking sent — but the OUTBOX that Try again and
   * Edit actually read from is bounded to the ledger's own five minutes. Those
   * two lifetimes disagreed, and the disagreement rendered as two buttons that
   * looked exactly as they had a moment before and now did nothing whatsoever:
   * an operator action that fails in silence, which is the one thing this whole
   * surface exists to make impossible. So the affordance is gated on the thing
   * it needs rather than on the thing that is always true. The reason line
   * stays either way — the failure is still the truth, it is only the offer to
   * undo it that has expired.
   */
  const recoverable = $derived(!!message.metadata?.sentAs && canResend(message.metadata.sentAs));

  /**
   * Whether re-sending is provably safe. A refused or throwing dispatch never
   * left this tab; a failure by ack-timeout or dropped socket may already be in
   * the daemon's hands and acting on the world, so the second one is offered
   * with a word that does not promise the first one's certainty. Absence of a
   * record (swept) reads as ambiguous, which is the cautious side to be on.
   */
  const undelivered = $derived(record?.undelivered === true);

  function retry(): void {
    if (message.metadata?.sentAs) retrySend(message.metadata.sentAs);
  }
  function edit(): void {
    if (message.metadata?.sentAs) restoreDraft(message.metadata.sentAs);
  }
</script>

{#if hidden}
  <!-- A successful result has no line; an empty assistant frame carried only a tool call. -->
{:else if kind === 'user'}
  <!-- The reader's own turn is the one thing worth finding on a fast scroll, so
       it is the one thing that carries a surface: a sunken well. User messages
       are sparse, so filling them makes the operator's own instructions the
       landmarks. The agent's turns stay bare on the field. -->
  <section
    class="turn you"
    class:ghost
    class:failed
    style="--ghost-presence: {GHOST.presence}; --ghost-settle: {GHOST.settleMs}ms; --ghost-fail-delay: {GHOST.failDelayMs}ms; --ghost-fail-reveal: {GHOST.failRevealMs}ms"
  >
    <Who
      you
      name="You"
      timestamp={ghost || failed ? undefined : message.timestamp}
      note={ghost ? 'sending…' : failed ? 'not sent' : undefined}
    />
    <MessageBody source={message.content} />
    {#if message.metadata?.attachments?.length || message.metadata?.images?.length}
      <div class="chips">
        {#each message.metadata.attachments ?? [] as att}
          <Badge variant="secondary" class={chipClass}>{att.name} · {att.chars} chars</Badge>
        {/each}
        {#each message.metadata.images ?? [] as img, i}
          {#if img.dataUri}
            <img class="shot" src={img.dataUri} alt="Image {i + 1} sent with this message" />
          {:else}
            <!-- A stored transcript can name an image it no longer carries. -->
            <Badge variant="secondary" class={chipClass}>Image {i + 1} · {img.mediaType}</Badge>
          {/if}
        {/each}
      </div>
    {/if}
    <!-- Mirrors Prompt.svelte's own refusal line ("Couldn't send that
         answer.") — a failed send is a sibling of a failed answer, not a new
         dialect of failure. The grid-rows wrapper is what animates a height
         that content, not JS, decides. -->
    <div class="failure">
      <div class="failure-inner">
        {#if failed}
          <p class="reason">
            Couldn't send that message.{reason ? ` ${reason}` : ''}{recoverable && !undelivered
              ? ' It may still have reached the agent — sending it again could repeat it.'
              : ''}
          </p>
          {#if recoverable}
            <div class="actions">
              <button type="button" class="pressable action" onclick={retry}>
                {undelivered ? 'Try again' : 'Send anyway'}
              </button>
              <button type="button" class="pressable action" onclick={edit}>Edit</button>
            </div>
          {/if}
        {/if}
      </div>
    </div>
  </section>
{:else if kind === 'assistant'}
  <section class="turn">
    <Who name={agentName} timestamp={message.timestamp} />
    <MessageBody source={message.content} />
  </section>
{:else if kind === 'thinking'}
  {#if message.content.trim()}
    <Thinking text={message.content} />
  {/if}
{:else if kind === 'user.peer'}
  <Peer {message} />
{:else}
  <SystemLine {message} />
{/if}

<style>
  .turn {
    margin-top: var(--space-4);
  }
  /* The well bleeds back out by exactly its own padding, so the reader's words
     sit on the same ledger column as the agent's and only the wash widens.
     --space-4 (14px) fits inside the transcript's gutters (25 left / 21 right)
     with room to spare; the narrow breakpoint clamps it below. */
  .turn.you {
    margin-inline: calc(var(--space-4) * -1);
    padding: var(--space-3) var(--space-4);
    background: var(--surface-sunken);
    border-radius: var(--radius-well);
    /* The only property a ghost or a failure ever animates on the well
       itself — nothing translates or scales, so the row never reflows
       against its neighbours while it settles. */
    opacity: 1;
    transition: opacity var(--ghost-settle) var(--e-in);
  }
  /* Third tense of Queued.svelte's grammar: same well, same 0.7, a note chip
     instead of a clock. Not color alone — the note text and the missing
     clock carry the state too, so it survives grayscale and reduced motion. */
  .turn.you.ghost {
    opacity: var(--ghost-presence);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    margin-top: var(--space-2);
  }
  /* At the narrow breakpoint the transcript's gutters drop to --space-5 (18px),
     where a --space-4 bleed would leave 4px of air. Padding and bleed step down
     together so they stay equal — the columns stay flush and the gutter keeps
     7px. */
  @media (max-width: 900px) {
    .turn.you {
      margin-inline: calc(var(--space-3) * -1);
      padding-inline: var(--space-3);
    }
  }

  /* What was actually sent, not the word "image". */
  .shot {
    width: 48px;
    height: 48px;
    object-fit: cover;
    border-radius: var(--radius-mark);
    border: 1px solid var(--border-hairline);
    display: block;
  }

  /* The reason + actions unfold on a `grid-template-rows` track rather than
     `height`, so the animated size is intrinsic content height with no
     measurement pass. Collapsed to nothing when there is nothing to say —
     which is every non-failed turn, so this costs nothing on the common path. */
  .failure {
    display: grid;
    grid-template-rows: 0fr;
    opacity: 0;
    transition:
      grid-template-rows var(--ghost-fail-reveal) var(--e-in) var(--ghost-fail-delay),
      opacity var(--ghost-fail-reveal) var(--e-in) var(--ghost-fail-delay),
      margin-top var(--ghost-fail-reveal) var(--e-in) var(--ghost-fail-delay);
  }
  .turn.you.failed .failure {
    grid-template-rows: 1fr;
    opacity: 1;
    margin-top: var(--space-2);
  }
  .failure-inner {
    overflow: hidden;
    min-height: 0;
  }
  .reason {
    font-size: var(--text-xs);
    color: var(--status-fail-ink);
  }
  .actions {
    display: flex;
    gap: var(--space-2);
    margin-top: var(--space-2);
  }
  /* Text actions in the chip vocabulary MessageRow already speaks (radius-mark,
     text-xs, space-2) rather than a new button style — a failed send reads as
     a sibling of the well it sits in, not a dialog bolted onto it. */
  .action {
    border-radius: var(--radius-mark);
    border: 1px solid var(--border-hairline);
    background: transparent;
    padding: var(--space-1) var(--space-2);
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
    color: var(--ink-body);
  }
  .action:hover {
    background: var(--surface-hover);
  }
  /* No per-component prefers-reduced-motion block: app.css's global clamp
     already forces every animation/transition duration here to 1ms, and every
     state above is carried by Who's note text and the reason line regardless
     of motion, so the clamp loses no information. */
</style>
