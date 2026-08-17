/**
 * Usage, cost & limits types — the shared vocabulary for the usage feature
 * (USAGE-SPEC.md §4.1). Pure types only; no runtime imports.
 */

export type UsageHarness = 'claude' | 'opencode';

export interface UsageTokens {
  input: number;
  output: number;
  cacheCreation: number; // Claude: see cacheCreationCount() rule in tokens.ts
  cacheRead: number;
  reasoning: number; // opencode only; 0 for Claude
}

/** One (session, model, hour) bucket. The unit the agent reports and the hub stores. */
export interface UsageBucket {
  harness: UsageHarness;
  hourStart: number; // ms epoch, floored to the UTC hour
  firstTs: number; // ms epoch of the earliest record in the bucket
  lastTs: number; // ms epoch of the latest record in the bucket
  sessionId: string;
  project: string; // Claude: dir name after `projects/`. opencode: basename(path.root)
  projectPath: string | null;
  model: string;
  provider: string | null; // opencode only
  tokens: UsageTokens;
  costUsd: number;
  messages: number;
}

export interface LimitWindow {
  kind: string; // 'session' | 'weekly_all' | 'weekly_scoped' | …
  group: 'session' | 'weekly' | string;
  percent: number;
  severity: 'normal' | 'warning' | 'critical' | string;
  resetsAt: string | null; // ISO
  scopeLabel: string | null; // scope.model.display_name, e.g. "Fable"
  isActive: boolean;
}

export interface ClaudeLimits {
  fetchedAt: number;
  planTier: string | null; // rateLimitTier
  subscription: string | null; // subscriptionType
  windows: LimitWindow[];
  spendUsed: number | null; // dollars
  spendLimit: number | null;
  error: string | null;
  /** Set when a fetch failed and the caller is served the last good reading. */
  stale?: boolean;
}

/**
 * One machine's latest limit reading, as the hub stores it (`usage_limits`)
 * and broadcasts it in a `kind: 'usage'` frame. `fetchedAt` is a `Date` inside
 * the hub and the ISO string it serialises to on the wire.
 */
export interface UsageLimitsReading {
  machineId: string;
  payload: ClaudeLimits;
  fetchedAt: string | number | Date;
}

/**
 * The real transcript `message.usage` shape (USAGE-SPEC.md §2.3). Field names
 * are the on-disk snake_case, not the neutral {@link UsageTokens}.
 */
export interface RawClaudeUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation?: {
    ephemeral_5m_input_tokens?: number;
    ephemeral_1h_input_tokens?: number;
  };
  service_tier?: string;
  speed?: string;
}

/**
 * The opencode `message.data` JSON (USAGE-SPEC.md §2.3). Mind the capitalized
 * `sessionID` / `providerID` / `modelID` — they are not the neutral casing.
 */
export interface RawOpenCodeMessage {
  id: string;
  sessionID: string;
  role: string;
  providerID?: string;
  modelID?: string;
  path?: { cwd?: string; root?: string };
  cost?: number;
  tokens?: {
    input?: number;
    output?: number;
    reasoning?: number;
    cache?: { read?: number; write?: number };
  };
  time?: { created?: number };
}
