import type { InstanceRow } from '@cockpit/core';
import { resolveSessionTitle } from '$lib/cockpit/links';
import type { LayoutServerLoad } from './$types';

/**
 * The cookie working-set.svelte.ts mirrors its localStorage into — declared
 * here rather than imported so the server never pulls the client store (and its
 * module-level `$state`) into a request.
 */
const WORKING_SET_KEY = 'outpost-working-set';

/** The stored shape, mirrored from `Visit` in working-set.svelte.ts. */
interface Visit {
  id: string;
  at: number;
  machine?: string | null;
  cwd?: string;
  harness?: string;
}

/**
 * The sidebar rail's width is this browser's preference, not the fleet's. It is
 * read here from a cookie so the server renders the resolved width into the
 * first paint — before this, the width lived only in localStorage, so SSR drew
 * the default and the rail visibly jumped once the client read the real value
 * on mount. The bounds mirror Shell.svelte's clamp.
 */
const RAIL_KEY = 'cockpit-rail-width';
const RAIL_MIN = 216;
const RAIL_MAX = 520;
const RAIL_DEFAULT = 288;

/**
 * One tab of the strip, resolved on the server. Only what the server can know:
 * the hue and the sprite are derived from the id and the folder in the
 * component, so they cost nothing to send.
 */
export interface ServerTab {
  id: string;
  href: string;
  label: string;
  /** The seed the identity hue is mixed from — the folder, or the id. */
  seed: string;
}

/** The conversation the URL names, or '' on the board and everywhere else. */
function currentId(pathname: string): string {
  const match = /^\/session\/([^/]+)/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : '';
}

/** The working set as this browser last wrote it, mirrored out of localStorage. */
function readVisits(raw: string | undefined): Visit[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Visit[];
    return Array.isArray(parsed) ? parsed.filter((visit) => typeof visit?.id === 'string') : [];
  } catch {
    return [];
  }
}

export const load: LayoutServerLoad = async ({ cookies, fetch, url }) => {
  const stored = Number(cookies.get(RAIL_KEY));
  const railWidth =
    Number.isFinite(stored) && stored > 0
      ? Math.min(RAIL_MAX, Math.max(RAIL_MIN, Math.round(stored)))
      : RAIL_DEFAULT;

  const open = readVisits(cookies.get(WORKING_SET_KEY));
  const here = currentId(url.pathname);
  // Landing on a conversation puts it in the set (working-set.visit, from the
  // session layout's effect) — so the server has to count it too, or the strip
  // would gain a tab the instant it hydrated.
  if (here && !open.some((visit) => visit.id === here)) {
    open.push({
      id: here,
      at: Date.now(),
      machine: url.searchParams.get('machine'),
      cwd: url.searchParams.get('cwd') ?? '',
      harness: url.searchParams.get('harness') ?? 'claude',
    });
  }

  if (open.length === 0) return { railWidth, tabs: [] as ServerTab[] };

  // What the fleet calls these conversations. A machine that cannot answer just
  // leaves every tab named by its folder, which is what the strip falls back to
  // on the client too.
  let rows: InstanceRow[] = [];
  try {
    const response = await fetch('/api/instances');
    if (response.ok) rows = (await response.json()) as InstanceRow[];
  } catch {
    rows = [];
  }

  const tabs: ServerTab[] = open.map((visit) => {
    const row = rows.find((instance) => instance.id === visit.id);
    // A stored session addresses itself with its machine/cwd/harness; drop that
    // and /session/{id} opens a different session with the same id. The same
    // link SessionTabs builds, so the markup the client takes over is identical.
    const href = visit.machine
      ? `/session/${visit.id}?${new URLSearchParams({
          machine: visit.machine,
          cwd: visit.cwd ?? '',
          harness: visit.harness ?? 'claude',
        })}`
      : `/session/${visit.id}`;
    const cwd = row?.cwd || visit.cwd || '';
    return {
      id: visit.id,
      href,
      label: resolveSessionTitle({ title: row?.title, cwd, id: visit.id }),
      seed: cwd || visit.id,
    };
  });

  return { railWidth, tabs };
};
