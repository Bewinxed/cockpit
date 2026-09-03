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
export const WORKING_SET_KEY = "whiffle-working-set";
const KEY = WORKING_SET_KEY;

/** Beyond this it stops being a working set and becomes history again. */
const LIMIT = 10;

export interface Visit {
  /** Only eviction reads this: the tab that goes is the coldest one. */
  at: number;
  cwd?: string;
  harness?: string;
  id: string;
  /**
   * Where a STORED session was last known to live. Not part of its address —
   * a tab link is the bare `/session/{id}`, and the hub locates the id across
   * the fleet — but what names the pane (machine, folder, harness) before the
   * transcript has answered, and what `contextOf` falls back to when neither
   * the hub's instances nor a machine's catalogue list the id. Live sessions
   * leave these undefined; their row on the hub says all of this.
   */
  machine?: string | null;
  /**
   * What this conversation resolved to being CALLED, last time a strip
   * resolved it. A tab is drawn before the fleet and the transcript have
   * answered; without this it was drawn as its folder and renamed itself the
   * moment they did. Only ever a name derived from what the session IS (a
   * given title, or what it was first asked), never the folder or id
   * placeholder.
   */
  title?: string;
}

/** The last-known machine, folder and harness of a stored session's tab. */
export interface VisitContext {
  cwd: string;
  harness: string;
  machine: string;
}

const parse = (raw: string | null | undefined): Visit[] => {
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as Visit[];
    return Array.isArray(parsed)
      ? parsed.filter(
          (visit) =>
            typeof visit?.id === "string" && typeof visit?.at === "number"
        )
      : [];
  } catch {
    return [];
  }
};

const load = (): Visit[] => {
  try {
    if (typeof localStorage !== "undefined") {
      return parse(localStorage.getItem(KEY));
    }
  } catch {
    // A browser that will not read storage starts the set over.
  }
  return [];
};

const visits = $state<Visit[]>(load());

const save = () => {
  if (typeof localStorage === "undefined") {
    return;
  }
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

  /** Where a stored session's tab last knew it to live, or null for a live
      session, whose row on the hub answers instead. */
  contextOf(id: string): VisitContext | null {
    const visit = visits.find((v) => v.id === id);
    if (!(visit && visit.machine)) {
      return null;
    }
    return {
      machine: visit.machine,
      cwd: visit.cwd ?? "",
      harness: visit.harness ?? "claude",
    };
  },

  /** Notes that a conversation is on screen, keeping where a stored session
      was last known to live so its tab can be named before the fleet answers. */
  visit(
    id: string,
    ctx?: { machine?: string | null; cwd?: string; harness?: string }
  ): void {
    if (!id) {
      return;
    }
    const at = Date.now();
    const existing = visits.findIndex((visit) => visit.id === id);
    // Coming back to a tab only re-dates it. Moving it is the re-rank this
    // ordering exists to be rid of.
    if (existing !== -1) {
      visits[existing] = { ...visits[existing], id, at, ...(ctx ?? {}) };
      save();
      return;
    }
    visits.push({ id, at, ...(ctx ?? {}) });
    // The coldest tab makes room; everything else keeps the place it had.
    if (visits.length > LIMIT) {
      let coldest = 0;
      for (let i = 1; i < visits.length; i++) {
        if (visits[i].at < visits[coldest].at) {
          coldest = i;
        }
      }
      visits.splice(coldest, 1);
    }
    save();
  },

  /** The remembered name, or `null` for a conversation nothing has named yet. */
  titleOf(id: string): string | null {
    return visits.find((visit) => visit.id === id)?.title ?? null;
  },

  /**
   * Remembers what a conversation is called, so the next load names it the
   * same. Written only when the name actually changed — this is called from
   * a render effect, and a write every pass would be a write every frame.
   */
  setTitle(id: string, title: string): void {
    const at = visits.findIndex((visit) => visit.id === id);
    if (at === -1) {
      return;
    }
    const named = title.trim();
    if (!named || visits[at].title === named) {
      return;
    }
    visits[at].title = named;
    save();
  },

  /** Drops a conversation that no longer exists, so it cannot be swiped to. */
  forget(id: string): void {
    const at = visits.findIndex((visit) => visit.id === id);
    if (at === -1) {
      return;
    }
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
      if (visit) {
        reordered.push(visit);
      }
    }
    for (const visit of visits) {
      if (!ids.includes(visit.id)) {
        reordered.push(visit);
      }
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
    if (order.length < 2) {
      return null;
    }
    const at = order.indexOf(from);
    if (at === -1) {
      return order[0] ?? null;
    }
    // Wraps, because on a phone there is no edge to see and continuing round is
    // the shortest way back to the other end of a short list.
    return order[(at + by + order.length) % order.length] ?? null;
  },
};
