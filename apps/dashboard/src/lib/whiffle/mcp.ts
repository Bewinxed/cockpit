import type { McpServerStatus } from '@whiffle/core';

/**
 * The hostname a server's favicon can be fetched for: HTTP, SSE and claude.ai
 * proxy configs name a URL; a stdio server runs on the machine itself and has
 * none. Null is "no favicon to try" — the chip falls back to a letter.
 */
export function mcpHost(server: McpServerStatus): string | null {
  const config = server.config;
  if (!config || !('url' in config) || typeof config.url !== 'string') return null;
  try {
    return new URL(config.url).hostname;
  } catch {
    return null;
  }
}

/**
 * The registrable root of a host, by a small heuristic rather than the public
 * suffix list: the last two labels, or three when the second-to-last is a
 * generic second-level label under a two-letter country TLD (`foo.co.uk`).
 * A bare host (localhost, an IP) is its own root.
 */
const GENERIC_SLD = new Set(['co', 'com', 'net', 'org', 'gov', 'edu', 'ac']);

export function rootDomain(host: string): string {
  const parts = host.split('.');
  if (parts.length <= 2) return host;
  const [sld, tld] = parts.slice(-2);
  const take = GENERIC_SLD.has(sld) && tld.length === 2 ? 3 : 2;
  return parts.slice(-take).join('.');
}

/**
 * Where a favicon might be, best first: the host's icons, then the root
 * domain's when that is a different name. `apple-touch-icon.png` before
 * `favicon.ico` — the chips render at 32px, a touch icon is 180px wherever it
 * exists, and a bare .ico is all too often 16px stretched to blur. The image's
 * error event is the "no icon here" signal, so these are direct fetches — a
 * favicon service answers a placeholder instead of failing, and a placeholder
 * cannot fall back.
 */
export function faviconCandidates(host: string): string[] {
  const root = rootDomain(host);
  const hosts = root === host ? [host] : [host, root];
  return hosts.flatMap((name) => [
    `https://${name}/apple-touch-icon.png`,
    `https://${name}/favicon.ico`,
  ]);
}
