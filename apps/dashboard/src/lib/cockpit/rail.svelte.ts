/**
 * The rail's own order: what the reader pinned, and how they keep their
 * machines. Neither is something the data can say for itself — recency and
 * hostname are the fleet's opinion, this is theirs — so both are persisted
 * here, in one document, because they are the same kind of claim.
 */
import { browser } from '$app/environment';
import type { Machine } from './client.svelte';

export const RAIL_LAYOUT_KEY = 'cockpit-rail-layout';

/**
 * What a pin points at. A side quest is a session that says it is one (NEW.md
 * §1), so keeping one never invalidates the pin that was put on it.
 */
export type PinKind = 'machine' | 'project' | 'session' | 'stored';

export interface Pin {
  kind: PinKind;
  id: string;
}

interface RailLayout {
  /** The order the Pinned group is drawn in — first pinned, first shown. */
  pins: Pin[];
  /** Machine ids in the reader's order; anything not named here sorts after. */
  machines: string[];
}

const KINDS: readonly string[] = ['machine', 'project', 'session', 'stored'];

const isPin = (value: Pin | undefined): value is Pin =>
  typeof value?.id === 'string' && KINDS.includes(value.kind);

function read(): RailLayout {
  if (!browser) return { pins: [], machines: [] };
  try {
    const stored = JSON.parse(
      localStorage.getItem(RAIL_LAYOUT_KEY) ?? '{}'
    ) as Partial<RailLayout>;
    return {
      pins: (stored.pins ?? []).filter(isPin),
      machines: (stored.machines ?? []).filter((id) => typeof id === 'string'),
    };
  } catch {
    return { pins: [], machines: [] };
  }
}

// Module scope, so the drawer copy of the rail and the desktop one agree.
const layout = $state<RailLayout>(read());

const save = () => localStorage.setItem(RAIL_LAYOUT_KEY, JSON.stringify(layout));

const FLIP_MS = 160;

// The drag library animates in JS, so the media query has to be asked in JS.
let reduced = $state(false);
if (browser) {
  const query = window.matchMedia('(prefers-reduced-motion: reduce)');
  reduced = query.matches;
  query.addEventListener('change', (event) => (reduced = event.matches));
}

export const rail = {
  get pins(): Pin[] {
    return layout.pins;
  },
  get machineOrder(): string[] {
    return layout.machines;
  },
  get flipDurationMs(): number {
    return reduced ? 0 : FLIP_MS;
  },
  isPinned: (kind: PinKind, id: string): boolean =>
    layout.pins.some((pin) => pin.kind === kind && pin.id === id),
  togglePin(kind: PinKind, id: string): void {
    const at = layout.pins.findIndex((pin) => pin.kind === kind && pin.id === id);
    if (at === -1) layout.pins.push({ kind, id });
    else layout.pins.splice(at, 1);
    save();
  },
  setPins(pins: Pin[]): void {
    layout.pins = pins;
    save();
  },
  setMachineOrder(machines: string[]): void {
    layout.machines = machines;
    save();
  },
};

/**
 * Machines in the reader's order. A peer that showed up after they last said
 * sorts behind the ones they placed, by hostname among themselves.
 *
 * A pin nobody can resolve any more — a discarded quest, a deleted transcript —
 * is skipped where it is drawn rather than pruned here: on a cold load the rail
 * is empty until the hub answers, and pruning then would throw away every pin.
 */
export function orderMachines(machines: Machine[]): Machine[] {
  const placed = new Map(layout.machines.map((id, index) => [id, index]));
  return [...machines].sort((a, b) => {
    const left = placed.get(a.machineId);
    const right = placed.get(b.machineId);
    if (left !== undefined && right !== undefined) return left - right;
    if (left !== undefined) return -1;
    if (right !== undefined) return 1;
    return a.hostname.localeCompare(b.hostname);
  });
}
