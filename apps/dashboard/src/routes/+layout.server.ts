import type { InstanceRow } from '@whiffle/core';
import { resolveSessionTitle } from '$lib/whiffle/links';
import type { LayoutServerLoad } from './$types';

/**
 * The cookie working-set.svelte.ts mirrors its localStorage into — declared
 * here rather than imported so the server never pulls the client store (and its
 * module-level `$state`) into a request.
 */
const WORKING_SET_KEY = 'whiffle-working-set';

/** The stored shape, mirrored from `Visit` in working-set.svelte.ts. */
interface Visit {
  id: string;
  at: number;
  machine?: string | null;
  cwd?: string;
  harness?: string;
  /** What the strip last resolved this conversation to being called. */
  title?: string;
}

/**
 * The sidebar rail's width is this browser's preference, not the fleet's. It is
 * read here from a cookie so the server renders the resolved width into the
 * first paint — before this, the width lived only in localStorage, so SSR drew
 * the default and the rail visibly jumped once the client read the real value
 * on mount. The bounds mirror Shell.svelte's clamp.
 */
const RAIL_KEY = 'whiffle-rail-width';
const RAIL_MIN = 216;
const RAIL_MAX = 520;
const RAIL_DEFAULT = 340;

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
  /** Which agent runs it — the mark draws the vendor glyph from this. */
  harness: string;
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

export const load: LayoutServerLoad = async ({ cookies, fetch, url, depends, untrack }) => {
  depends('data:tab-strip');
  const stored = Number(cookies.get(RAIL_KEY));
  const railWidth =
    Number.isFinite(stored) && stored > 0
      ? Math.min(RAIL_MAX, Math.max(RAIL_MIN, Math.round(stored)))
      : RAIL_DEFAULT;

  const open = readVisits(cookies.get(WORKING_SET_KEY));
  // Untrack URL access: tab switches change the URL but the client-side
  // workingSet already manages the tab list. This server load is only for
  // SSR first paint — re-running it on every tab switch wastes ~1s.
  const here = untrack(() => currentId(url.pathname));
  if (here && !open.some((visit) => visit.id === here)) {
    open.push({
      id: here,
      at: Date.now(),
      machine: untrack(() => url.searchParams.get('machine')),
      cwd: untrack(() => url.searchParams.get('cwd')) ?? '',
      harness: untrack(() => url.searchParams.get('harness')) ?? 'claude',
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

  // The board is a working set: it drops a session that has not moved in a day.
  // The strip is not — it carries whatever the reader left open, so a tab on an
  // aged-out conversation had no row to read a name off and the first paint
  // called it by eight characters of its id until the reader clicked it. The
  // name is not missing, only filtered out of the listing, so ask for it by id:
  // one batched call, and only for the tabs nothing else has already named.
  const unnamed = open.filter(
    (visit) =>
      !visit.title?.trim() && !rows.find((instance) => instance.id === visit.id)?.title?.trim()
  );
  const named = new Map<string, string>();
  if (unnamed.length > 0) {
    try {
      const response = await fetch('/api/instances/titles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // The machine/cwd/harness a stored-session tab addresses itself with,
          // so a conversation with no row of its own can still be read.
          ids: unnamed.map((visit) => ({
            id: visit.id,
            machine: visit.machine ?? undefined,
            cwd: visit.cwd,
            harness: visit.harness,
          })),
        }),
      });
      if (response.ok) {
        for (const { id, title } of (await response.json()) as { id: string; title: string | null }[])
          if (title) named.set(id, title);
      }
    } catch {
      // A hub that cannot answer leaves those tabs to their fallback, exactly as
      // they were before this call existed.
    }
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
      // In order: the name the strip itself last resolved, the fleet's own row,
      // then the hub's answer for a conversation the board no longer lists.
      // Only a session nobody has ever read — on a machine that is not
      // connected, so nothing can read it now either — falls past all three to
      // the folder it ran in and, failing that, to its id.
      label:
        visit.title ||
        resolveSessionTitle({ title: row?.title || named.get(visit.id), cwd, id: visit.id }),
      seed: cwd || visit.id,
      harness: visit.harness || row?.harness || 'claude',
    };
  });

  return { railWidth, tabs };
};
