/**
 * The queue half of the session store, kept out of the runes module so it can
 * be reasoned about — and tested — on its own.
 *
 * A message sent to a busy session waits in the daemon's harness. The
 * dashboard used to have no word on that at all: it drew a local echo the
 * moment the reader hit send, and that guess was the only evidence the message
 * existed. It did not survive a reload, it existed on no other device, and
 * when a re-read of the transcript landed over the top of it the message could
 * simply vanish. The daemon now announces its queue, and these two functions
 * are where that announcement takes over from the guess.
 */
import type { QueuedMessage } from '@whiffle/core';
import type { Message } from './types';

/** The parts of a session's state a queue move touches. */
export interface QueueTarget {
  messages: Message[];
  queued: QueuedMessage[];
}

/**
 * Files a message the session is holding, and takes back the guess the sender
 * drew for it.
 *
 * The local echo is the dashboard's own optimistic copy ({@link sendText}),
 * marked `queuedLocally` on the way in. The announcement is the daemon's word
 * about that same message, so it REPLACES the copy: newest-first, one-for-one
 * by content, the same absorption discipline `absorbLive` uses when a stored
 * transcript lands over the top of live turns — so a reader who genuinely sent
 * the same sentence twice keeps both of them.
 *
 * A tab that never sent this message — another device, a session opened
 * mid-queue — has no copy to take back and simply gains the row.
 */
export function ingestQueued(target: QueueTarget, entry: QueuedMessage): void {
  if (target.queued.some((queued) => queued.queueId === entry.queueId)) return;
  const guess = target.messages.findLast(
    (message) =>
      message.type === 'user' &&
      message.metadata?.queuedLocally === true &&
      !message.sdkUuid &&
      message.content === entry.text
  );
  if (guess) target.messages = target.messages.filter((message) => message !== guess);
  target.queued = [...target.queued, entry];
}

/**
 * Retires a queue entry: the session pulled it (`message_dequeued`), or its
 * real turn landed carrying the same id. Both paths, because either can be the
 * one that arrives — the dequeue frame can be raced by the turn it announces,
 * and a tab that subscribed a moment late never saw it at all.
 */
export function retireQueued(target: QueueTarget, queueId: string): void {
  if (!target.queued.some((queued) => queued.queueId === queueId)) return;
  target.queued = target.queued.filter((queued) => queued.queueId !== queueId);
}
