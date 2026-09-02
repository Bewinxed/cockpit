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

export const load: LayoutServerLoad = ({ cookies }) => {
  const stored = Number(cookies.get(RAIL_KEY));
  const railWidth =
    Number.isFinite(stored) && stored > 0
      ? Math.min(RAIL_MAX, Math.max(RAIL_MIN, Math.round(stored)))
      : RAIL_DEFAULT;
  return { railWidth };
};
