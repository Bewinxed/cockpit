/**
 * What a session needs from you right now — the fleet view's whole vocabulary
 * (NEW.md §8 Phase 3). Kept out of the runes module so it stays a plain rule
 * anything can call, including a script driving the hub.
 */
export type Activity = 'working' | 'blocked' | 'idle';

/**
 * Blocked wins over working: a session with a parked permission is not making
 * progress, whatever its turn state says.
 */
export function activityOf(session: { pending: readonly unknown[]; busy: boolean }): Activity {
  if (session.pending.length > 0) return 'blocked';
  return session.busy ? 'working' : 'idle';
}

/** The word each state is shown as — the enum is wire vocabulary, not copy. */
export const ACTIVITY_LABEL: Record<Activity, string> = {
  working: 'Working',
  blocked: 'Needs you',
  idle: 'Idle',
};

/**
 * The fourth word the rails use, and deliberately not an {@link Activity}: a
 * session that has lost its process reports no activity at all, so a resumable
 * row (`isResumable`) says this instead of claiming to be idle.
 */
export const SLEEPING_LABEL = 'Sleeping';

/** Why that is not a failure, wherever a sleeping row can carry a tooltip. */
export const SLEEPING_HINT = 'Sleeping — it resumes when you open or message it.';
