/**
 * Skeleton hints - stores item counts in cookies for SSR skeleton rendering.
 *
 * When we load messages/items client-side, we save the count to a cookie.
 * On next SSR load, we read that count and render that many skeleton placeholders.
 * This gives users a much better loading experience than a blank screen.
 */

const COOKIE_PREFIX = 'sk:';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

/**
 * Save a skeleton hint count to cookies (client-side only)
 */
export function saveSkeletonHint(key: string, count: number): void {
  if (typeof document === 'undefined') return;

  // Clamp count to reasonable range
  const safeCount = Math.min(Math.max(0, count), 100);
  document.cookie = `${COOKIE_PREFIX}${key}=${safeCount}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
}

/**
 * Get a skeleton hint count from cookies (works on both server and client)
 */
export function getSkeletonHint(key: string, cookieHeader?: string): number {
  const cookies = cookieHeader ?? (typeof document !== 'undefined' ? document.cookie : '');
  const match = cookies.match(new RegExp(`${COOKIE_PREFIX}${key}=(\\d+)`));
  return match ? parseInt(match[1], 10) : 0;
}

/**
 * Parse all skeleton hints from cookie header
 */
export function parseAllSkeletonHints(cookieHeader: string): Record<string, number> {
  const hints: Record<string, number> = {};
  const regex = new RegExp(`${COOKIE_PREFIX}([^=]+)=(\\d+)`, 'g');
  let match;
  while ((match = regex.exec(cookieHeader)) !== null) {
    hints[match[1]] = parseInt(match[2], 10);
  }
  return hints;
}

// Specific hint keys for our app
export const HINT_KEYS = {
  /** Messages count for a specific instance */
  instanceMessages: (instanceId: string) => `im:${instanceId}`,
  /** Agents count in sidebar */
  agents: 'agents',
  /** Instances count in sidebar */
  instances: 'instances',
  /** Projects count */
  projects: 'projects',
} as const;
