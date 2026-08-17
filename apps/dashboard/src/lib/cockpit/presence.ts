/**
 * The two rules behind the transcript's presence line, kept pure so they can be
 * asserted without a DOM: how long the turn has been running, and whether the
 * line is wanted at all.
 */
import type { Activity } from './activity';

/**
 * beui's `formatElapsed`, unchanged: tenths of a second always, minutes only
 * once there are some.
 */
export function formatElapsed(totalSeconds: number): string {
  const safeSeconds = Math.max(0, totalSeconds);
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = (safeSeconds % 60).toFixed(1);
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

/**
 * Whether the tail of the transcript needs something standing in for the
 * session — the last resort of a precedence the tail resolves in one order,
 * evidence first, one line at most:
 *
 * 1. The partials say a thinking block is open, or the trace it left is still
 *    the newest thing the session did: the live reasoning renders, and it says
 *    "Thinking" because something was measured saying so.
 * 2. A tool is in flight, or the tail's tool rows are still unanswered: the
 *    rows carry their own spinners, and a second line over them is noise.
 * 3. Text is streaming: the answer is writing itself onto the screen, and the
 *    pixels a presence line would take are the ones it is arriving in.
 * 4. Nothing on screen is alive and the session is working: *this* line, and
 *    the only place the word is a guess — so it is never "Thinking".
 *
 * Anything other than working renders nothing at all: a blocked session is
 * answered by its permission card, and an idle one says nothing (Absence over
 * placeholder).
 */
export function showsPresence(input: {
  activity: Activity;
  /** The partial assistant text, `''` when nothing is streaming. */
  streaming: string;
  /** Whether the main loop has a tool call out. */
  toolInFlight: boolean;
  /** Whether the transcript's last group still has a tool row waiting on its result. */
  tailToolPending: boolean;
  /**
   * Whether the partials have a thinking block open, or left a trace with
   * nothing newer over it. The live trace is rendered in its place.
   */
  thinkingLive: boolean;
  /**
   * Whether the transcript tail is a thinking block in a busy turn. A harness
   * that streams no partials (opencode) reaches the reader this way and no
   * other, and that block shimmers "Thinking…" for itself — a presence line
   * under it would say the same thing twice on one screen.
   */
  tailIsThinking: boolean;
}): boolean {
  return (
    input.activity === 'working' &&
    !input.thinkingLive &&
    !input.tailIsThinking &&
    !input.toolInFlight &&
    !input.tailToolPending &&
    !input.streaming
  );
}
