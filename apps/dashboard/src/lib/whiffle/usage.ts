/**
 * Usage & cost helpers for the /usage page and the pill (USAGE-SPEC.md §7).
 * The summary/blocks JSON shapes come from the hub (`/api/usage/*`); they are
 * declared here because the hub's `DbShape` types are not on the browser barrel.
 */
import type { ClaudeLimits, UsageBlock } from '@whiffle/core';

export interface UsageSummaryRow {
  key: string | number;
  input: number;
  output: number;
  cacheCreation: number;
  cacheRead: number;
  reasoning: number;
  costUsd: number;
  messages: number;
}

export interface UsageSummaryTotals {
  input: number;
  output: number;
  cacheCreation: number;
  cacheRead: number;
  reasoning: number;
  costUsd: number;
  messages: number;
}

export interface UsageSummary {
  rows: UsageSummaryRow[];
  totals: UsageSummaryTotals;
  missingPricing: string[];
}

export interface UsageLimitsResponse {
  machines: { machineId: string; hostname: string; limits: ClaudeLimits }[];
}

export interface UsageBlocksResponse {
  blocks: UsageBlock[];
}

/** Real or notional dollars — two decimals, never more. */
export const usd = (n: number): string => `$${n.toFixed(2)}`;

/** 13.1M, 581M, 1.5k — the token counts the spec quotes read this way. */
export const compactNumber = (n: number): string => {
  if (n >= 1_000_000) {
    const v = n / 1_000_000;
    return `${v >= 100 ? Math.round(v) : v.toFixed(1)}M`;
  }
  if (n >= 1000) {
    const v = n / 1000;
    return `${v >= 100 ? Math.round(v) : v.toFixed(1)}k`;
  }
  return String(n);
};

export const totalTokensOf = (r: {
  input: number;
  output: number;
  cacheCreation: number;
  cacheRead: number;
  reasoning: number;
}): number => r.input + r.output + r.cacheCreation + r.cacheRead + r.reasoning;

/** The three limit bands, identical to ContextMeter and UsageMeter. */
export type Band = 'calm' | 'warn' | 'critical';

export const band = (pct: number): Band => (pct >= 90 ? 'critical' : pct >= 70 ? 'warn' : 'calm');

/** A countdown to a reset, minute-granular — "2h 14m", "14m", "resetting now". */
export const resetsIn = (resetsAt: string | null, now: number): string => {
  if (!resetsAt) return '';
  const diff = new Date(resetsAt).getTime() - now;
  if (diff <= 0) return 'resetting now';
  const totalMin = Math.floor(diff / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `resets in ${h}h ${m}m`;
  if (m > 0) return `resets in ${m}m`;
  return 'resets in <1m';
};
