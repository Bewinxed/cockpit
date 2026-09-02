import type { InstanceRow } from '@whiffle/core';
import type { LayoutServerLoad } from './$types';

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
 * The cookie workspace.svelte.ts mirrors its localStorage into — declared here
 * rather than imported so the server never pulls the client store (and its
 * module-level `$state`) into a request. The shapes mirror that module's.
 */
const WORKSPACE_KEY = 'whiffle-workspace';

/**
 * Whether this browser is a phone, for the session surface's first paint.
 * The deck-or-grid decision is a media query on the client, which the server
 * cannot run, so SSR drew the grid and the phone flipped to the deck once the
 * bundle ran. The client mirrors the query into this cookie; on the very first
 * visit, before any cookie, the client hints and the user agent stand in. The
 * cookie is primary because an iPad in desktop mode reports a Macintosh UA.
 */
const NARROW_KEY = 'whiffle-narrow';
const PHONE_UA = /iPhone|iPod|Android.*Mobile|Windows Phone/i;

function narrowOf(cookie: string | undefined, headers: Headers): boolean {
  if (cookie === '1') return true;
  if (cookie === '0') return false;
  const hint = headers.get('sec-ch-ua-mobile');
  if (hint) return hint.trim() === '?1';
  return PHONE_UA.test(headers.get('user-agent') ?? '');
}

interface LeafNode {
  t: 'l';
  id: string;
  tabs: string[];
  active: string | null;
}
interface BranchNode {
  t: 'b';
  id: string;
  dir: 'h' | 'v';
  kids: PaneNode[];
  sizes: number[];
}
type PaneNode = LeafNode | BranchNode;
interface SessionContext {
  machine: string | null;
  cwd: string;
  harness: string;
}
export interface WorkspaceV1 {
  v: 1;
  root: PaneNode;
  focusedLeaf: string;
  ctx?: Record<string, SessionContext>;
}

function validate(node: unknown): node is PaneNode {
  if (!node || typeof node !== 'object') return false;
  const n = node as Partial<BranchNode> & Partial<LeafNode>;
  if (n.t === 'l') return typeof n.id === 'string' && Array.isArray(n.tabs);
  if (n.t === 'b') {
    return (
      typeof n.id === 'string' &&
      (n.dir === 'h' || n.dir === 'v') &&
      Array.isArray(n.kids) &&
      n.kids.length > 0 &&
      n.kids.every(validate)
    );
  }
  return false;
}

function parse(raw: string | null | undefined): WorkspaceV1 | null {
  if (!raw) return null;
  try {
    const held = JSON.parse(raw) as WorkspaceV1;
    if (held?.v !== 1 || !validate(held.root)) return null;
    if (typeof held.focusedLeaf !== 'string') return null;
    return held;
  } catch {
    return null;
  }
}

function leavesOf(node: PaneNode, out: LeafNode[] = []): LeafNode[] {
  if (node.t === 'l') out.push(node);
  else for (const kid of node.kids) leavesOf(kid, out);
  return out;
}

const blank = (): WorkspaceV1 => ({
  v: 1,
  root: { t: 'l', id: 'p0', tabs: [], active: null },
  focusedLeaf: 'p0',
  ctx: {},
});

/** The conversation the URL names, or '' on the board and everywhere else. */
function currentId(pathname: string): string {
  const match = /^\/session\/([^/]+)/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : '';
}

export const load: LayoutServerLoad = async ({ cookies, fetch, request, url, untrack }) => {
  const narrow = narrowOf(cookies.get(NARROW_KEY), request.headers);
  const stored = Number(cookies.get(RAIL_KEY));
  const railWidth =
    Number.isFinite(stored) && stored > 0
      ? Math.min(RAIL_MAX, Math.max(RAIL_MIN, Math.round(stored)))
      : RAIL_DEFAULT;

  let workspace = parse(cookies.get(WORKSPACE_KEY));

  // Untrack URL access: a switch between conversations is a shallow pushState
  // and the client store is authoritative after hydration. This load exists
  // for the first paint only — re-running it on every navigation would repeat
  // the title fetches for nothing. Mirrors what `workspace.reveal()` does.
  const pathname = untrack(() => url.pathname);
  const urlId = currentId(pathname);
  if (urlId) {
    workspace ??= blank();
    const leaves = leavesOf(workspace.root);
    const leaf =
      leaves.find((l) => l.tabs.includes(urlId)) ??
      leaves.find((l) => l.id === workspace!.focusedLeaf) ??
      leaves[0];
    if (!leaf.tabs.includes(urlId)) leaf.tabs.push(urlId);
    leaf.active = urlId;
    workspace.focusedLeaf = leaf.id;
    const machine = untrack(() => url.searchParams.get('machine'));
    if (machine) {
      workspace.ctx ??= {};
      workspace.ctx[urlId] ??= {
        machine,
        cwd: untrack(() => url.searchParams.get('cwd')) ?? '',
        harness: untrack(() => url.searchParams.get('harness')) ?? 'claude',
      };
    }
  } else if (pathname === '/session' && workspace) {
    const leaves = leavesOf(workspace.root);
    const leaf = leaves.find((l) => l.id === workspace!.focusedLeaf) ?? leaves[0];
    leaf.active = null;
  }

  const names: Record<string, string> = {};
  if (!workspace) return { railWidth, narrow, workspace, names };

  const open = leavesOf(workspace.root).flatMap((leaf) => leaf.tabs);
  if (open.length === 0) return { railWidth, narrow, workspace, names };

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
  for (const id of open) {
    const title = rows.find((instance) => instance.id === id)?.title?.trim();
    if (title) names[id] = title;
  }

  // The board is a working set: it drops a session that has not moved in a day.
  // The strip is not — it carries whatever the reader left open, so a tab on an
  // aged-out conversation has no row to read a name off. The name is not
  // missing, only filtered out of the listing, so ask for it by id: one batched
  // call, and only for the tabs the listing did not name.
  const unnamed = open.filter((id) => !names[id]);
  if (unnamed.length > 0) {
    const ctx = workspace.ctx ?? {};
    try {
      const response = await fetch('/api/instances/titles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ids: unnamed.map((id) => ({
            id,
            machine: ctx[id]?.machine ?? undefined,
            cwd: ctx[id]?.cwd,
            harness: ctx[id]?.harness,
          })),
        }),
      });
      if (response.ok) {
        for (const { id, title } of (await response.json()) as { id: string; title: string | null }[])
          if (title?.trim()) names[id] = title.trim();
      }
    } catch {
      // A hub that cannot answer leaves those tabs to their client fallback.
    }
  }

  return { railWidth, narrow, workspace, names };
};
