/**
 * The conversations you are actually moving between.
 *
 * A swipe that walks the sidebar's list is a swipe through everything you have
 * ever started, in an order nobody chose — you pass four sessions you have not
 * opened in a week to get to the one you were in a minute ago. What a phone
 * teaches is app switching: the things you are working between, most recent
 * first, and the ordering stays put while you are moving through it.
 *
 * Kept per browser rather than on the hub. It is a record of what *this* reader
 * has been looking at, not a property of the fleet.
 */
const KEY = 'outpost-working-set';

/** Beyond this it stops being a working set and becomes history again. */
const LIMIT = 10;

/**
 * How long after the last move the order is allowed to re-rank.
 *
 * Without this, recency re-sorts on every visit and swiping "next" twice takes
 * you back where you started: you arrive, you become the most recent, so the
 * next one along is the one you just left. Alt-tab has the same problem and
 * solves it the same way — the order holds while your finger is still working.
 */
const SETTLE_MS = 2500;

interface Visit {
  id: string;
  at: number;
}

const load = (): Visit[] => {
  if (typeof localStorage === 'undefined') return [];
  try {
    const stored = localStorage.getItem(KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored) as Visit[];
    return Array.isArray(parsed)
      ? parsed.filter((visit) => typeof visit?.id === 'string' && typeof visit?.at === 'number')
      : [];
  } catch {
    return [];
  }
};

const visits = $state<Visit[]>(load());

const save = () => {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(KEY, JSON.stringify(visits));
  } catch {
    // A browser that will not store just starts the set over next time.
  }
};

/** The order a swipe is currently walking, held still until the reader stops. */
let frozen: string[] | null = null;
let frozenAt = 0;

export const workingSet = {
  /** Most recent first. What the switcher walks. */
  get order(): string[] {
    return [...visits].sort((a, b) => b.at - a.at).map((visit) => visit.id);
  },

  /** Notes that a conversation is on screen. */
  visit(id: string): void {
    if (!id) return;
    const at = Date.now();
    const existing = visits.findIndex((visit) => visit.id === id);
    if (existing === -1) visits.push({ id, at });
    else visits[existing] = { id, at };
    // Oldest out, so the set stays the things being worked between.
    if (visits.length > LIMIT) {
      visits.sort((a, b) => b.at - a.at);
      visits.splice(LIMIT);
    }
    save();
  },

  /** Drops a conversation that no longer exists, so it cannot be swiped to. */
  forget(id: string): void {
    const at = visits.findIndex((visit) => visit.id === id);
    if (at === -1) return;
    visits.splice(at, 1);
    save();
  },

  /**
   * The next conversation in the switcher, `null` when there is nowhere to go.
   *
   * `fallback` is the rail's own list, used only until the reader has been in
   * more than one place — a brand new browser has no working set, and a swipe
   * that does nothing at all reads as a broken gesture rather than an empty one.
   */
  step(from: string, by: number, fallback: string[]): string | null {
    const now = Date.now();
    if (!frozen || now - frozenAt > SETTLE_MS) {
      const recent = this.order.filter((id) => fallback.includes(id));
      frozen = recent.length > 1 ? recent : fallback;
    }
    frozenAt = now;

    const order = frozen;
    if (order.length < 2) return null;
    const at = order.indexOf(from);
    if (at === -1) return order[0] ?? null;
    // Wraps, because on a phone there is no edge to see and continuing round is
    // the shortest way back to the other end of a short list.
    return order[(at + by + order.length) % order.length] ?? null;
  },
};
