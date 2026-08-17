/**
 * The conversations you are actually moving between.
 *
 * Browser-tab grammar (user's call, 2026-08-08): the order is the order things
 * were opened in, and it holds still. The first one you opened stays leftmost,
 * a click moves nothing, a new session lands on the right, and closing one is
 * the only thing that ever shifts the rest. An order that re-ranked itself by
 * recency is what made the strip feel like it was dodging the pointer.
 *
 * Kept per browser rather than on the hub. It is a record of what *this* reader
 * has been looking at, not a property of the fleet.
 */
const KEY = 'outpost-working-set';

/** Beyond this it stops being a working set and becomes history again. */
const LIMIT = 10;

interface Visit {
  id: string;
  /** Only eviction reads this: the tab that goes is the coldest one. */
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

export const workingSet = {
  /** Left to right, oldest tab first. The strip, and what stepping walks. */
  get order(): string[] {
    return visits.map((visit) => visit.id);
  },

  /** Notes that a conversation is on screen. */
  visit(id: string): void {
    if (!id) return;
    const at = Date.now();
    const existing = visits.findIndex((visit) => visit.id === id);
    // Coming back to a tab only re-dates it. Moving it is the re-rank this
    // ordering exists to be rid of.
    if (existing !== -1) {
      visits[existing] = { id, at };
      save();
      return;
    }
    visits.push({ id, at });
    // The coldest tab makes room; everything else keeps the place it had.
    if (visits.length > LIMIT) {
      let coldest = 0;
      for (let i = 1; i < visits.length; i++) {
        if (visits[i].at < visits[coldest].at) coldest = i;
      }
      visits.splice(coldest, 1);
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
   * Replaces the order in place, for a drag reorder of the strip. `ids` names
   * the tabs in their new left-to-right order; anything the list does not name
   * keeps its place at the tail, so a reorder of the visible tabs never drops
   * the overflow ones out of the set.
   */
  reorder(ids: string[]): void {
    const known = new Map(visits.map((visit) => [visit.id, visit]));
    const reordered: Visit[] = [];
    for (const id of ids) {
      const visit = known.get(id);
      if (visit) reordered.push(visit);
    }
    for (const visit of visits) {
      if (!ids.includes(visit.id)) reordered.push(visit);
    }
    visits.splice(0, visits.length, ...reordered);
    save();
  },

  /**
   * The next conversation along the strip, `null` when there is nowhere to go.
   *
   * Walks tab order, so `[` and `]` and a swipe move left and right exactly as
   * the eye reads them — and stepping twice lands two tabs along rather than
   * back where it started, which is what the old recency order could not do.
   *
   * `fallback` is the rail's own list, used only until the reader has been in
   * more than one place — a brand new browser has no working set, and a swipe
   * that does nothing at all reads as a broken gesture rather than an empty one.
   */
  step(from: string, by: number, fallback: string[]): string | null {
    const open = this.order.filter((id) => fallback.includes(id));
    const order = open.length > 1 ? open : fallback;
    if (order.length < 2) return null;
    const at = order.indexOf(from);
    if (at === -1) return order[0] ?? null;
    // Wraps, because on a phone there is no edge to see and continuing round is
    // the shortest way back to the other end of a short list.
    return order[(at + by + order.length) % order.length] ?? null;
  },
};
