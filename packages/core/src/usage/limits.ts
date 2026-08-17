import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ClaudeLimits, LimitWindow } from './types';

/**
 * Live Claude rate-limit utilization (USAGE-SPEC.md §4.5). Reads the OAuth
 * token from `~/.claude/.credentials.json` at call time for one request; it is
 * never logged, persisted, or returned. Missing credentials and an expired
 * token are normal states (a machine may run opencode only), so they come back
 * as `{ error, windows: [] }` rather than exceptions.
 */

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 60_000;

interface OauthCreds {
  accessToken?: string;
  expiresAt?: number;
  subscriptionType?: string;
  rateLimitTier?: string;
}

interface LimitWindowRaw {
  kind?: string;
  group?: string;
  percent?: number;
  severity?: string;
  resets_at?: string | null;
  scope?: { model?: { display_name?: string } } | null;
  is_active?: boolean;
}

interface UsageResponse {
  limits?: LimitWindowRaw[];
  five_hour?: { utilization?: number; resets_at?: string } | null;
  seven_day?: { utilization?: number; resets_at?: string } | null;
  spend?: {
    used?: { amount_minor?: number; exponent?: number; currency?: string } | null;
    limit?: number | null;
  } | null;
}

let cached: { at: number; value: ClaudeLimits } | null = null;

export async function fetchClaudeLimits(opts?: { configDir?: string }): Promise<ClaudeLimits> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.value;
  }

  const configDir = opts?.configDir ?? join(homedir(), '.claude');
  const credsPath = join(configDir, '.credentials.json');

  let raw: string;
  try {
    raw = await readFile(credsPath, 'utf8');
  } catch {
    return errorResult('not signed in');
  }

  let oauth: OauthCreds | undefined;
  try {
    oauth = (JSON.parse(raw) as { claudeAiOauth?: OauthCreds }).claudeAiOauth;
  } catch {
    return errorResult('not signed in');
  }

  const token = oauth?.accessToken;
  if (!token) {
    return errorResult('not signed in');
  }

  if (oauth?.expiresAt !== undefined && oauth.expiresAt < Date.now()) {
    return errorResult('token expired');
  }

  const res = await fetch(USAGE_URL, {
    headers: {
      Authorization: `Bearer ${token}`,
      'anthropic-beta': 'oauth-2025-04-20',
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    return errorResult(`HTTP ${res.status}`);
  }

  const body = (await res.json()) as UsageResponse;

  const windows: LimitWindow[] = (body.limits ?? []).map((w) => ({
    kind: w.kind ?? '',
    group: w.group ?? '',
    percent: w.percent ?? 0,
    severity: w.severity ?? 'normal',
    resetsAt: w.resets_at ?? null,
    scopeLabel: w.scope?.model?.display_name ?? null,
    isActive: w.is_active ?? false,
  }));

  // Fallback when the API omits `limits[]`: derive the two top-level windows.
  if (windows.length === 0) {
    if (body.five_hour) {
      windows.push({
        kind: 'session',
        group: 'session',
        percent: body.five_hour.utilization ?? 0,
        severity: 'normal',
        resetsAt: body.five_hour.resets_at ?? null,
        scopeLabel: null,
        isActive: false,
      });
    }
    if (body.seven_day) {
      windows.push({
        kind: 'weekly_all',
        group: 'weekly',
        percent: body.seven_day.utilization ?? 0,
        severity: 'normal',
        resetsAt: body.seven_day.resets_at ?? null,
        scopeLabel: null,
        isActive: false,
      });
    }
  }

  const used = body.spend?.used;
  const spendUsed =
    used && used.amount_minor !== undefined && used.exponent !== undefined
      ? used.amount_minor / Math.pow(10, used.exponent)
      : null;

  const result: ClaudeLimits = {
    fetchedAt: Date.now(),
    planTier: oauth?.rateLimitTier ?? null,
    subscription: oauth?.subscriptionType ?? null,
    windows,
    spendUsed,
    spendLimit: body.spend?.limit ?? null,
    error: null,
  };

  cached = { at: Date.now(), value: result };
  return result;
}

function errorResult(error: string): ClaudeLimits {
  return {
    fetchedAt: Date.now(),
    planTier: null,
    subscription: null,
    windows: [],
    spendUsed: null,
    spendLimit: null,
    error,
  };
}
