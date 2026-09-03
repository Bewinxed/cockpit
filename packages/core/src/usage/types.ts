/**
 * Usage, cost & limits types — the shared vocabulary for the usage feature
 * (USAGE-SPEC.md §4.1). Pure types only; no runtime imports.
 */

export type UsageHarness = "claude" | "opencode";

export interface UsageTokens {
  cacheCreation: number; // Claude: see cacheCreationCount() rule in tokens.ts
  cacheRead: number;
  input: number;
  output: number;
  reasoning: number; // opencode only; 0 for Claude
}

/** One (session, model, hour) bucket. The unit the agent reports and the hub stores. */
export interface UsageBucket {
  costUsd: number;
  firstTs: number; // ms epoch of the earliest record in the bucket
  harness: UsageHarness;
  hourStart: number; // ms epoch, floored to the UTC hour
  lastTs: number; // ms epoch of the latest record in the bucket
  messages: number;
  model: string;
  project: string; // Claude: dir name after `projects/`. opencode: basename(path.root)
  projectPath: string | null;
  provider: string | null; // opencode only
  sessionId: string;
  tokens: UsageTokens;
}

export interface LimitWindow {
  group: "session" | "weekly" | string;
  isActive: boolean;
  kind: string; // 'session' | 'weekly_all' | 'weekly_scoped' | …
  percent: number;
  resetsAt: string | null; // ISO
  scopeLabel: string | null; // scope.model.display_name, e.g. "Fable"
  severity: "normal" | "warning" | "critical" | string;
}

export interface ClaudeLimits {
  error: string | null;
  fetchedAt: number;
  planTier: string | null; // rateLimitTier
  spendLimit: number | null;
  spendUsed: number | null; // dollars
  /** Set when a fetch failed and the caller is served the last good reading. */
  stale?: boolean;
  subscription: string | null; // subscriptionType
  windows: LimitWindow[];
}

/**
 * One machine's latest limit reading, as the hub stores it (`usage_limits`)
 * and broadcasts it in a `kind: 'usage'` frame. `fetchedAt` is a `Date` inside
 * the hub and the ISO string it serialises to on the wire.
 */
export interface UsageLimitsReading {
  fetchedAt: string | number | Date;
  machineId: string;
  payload: ClaudeLimits;
}

/**
 * The real transcript `message.usage` shape (USAGE-SPEC.md §2.3). Field names
 * are the on-disk snake_case, not the neutral {@link UsageTokens}.
 */
export interface RawClaudeUsage {
  cache_creation?: {
    ephemeral_5m_input_tokens?: number;
    ephemeral_1h_input_tokens?: number;
  };
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  input_tokens: number;
  output_tokens: number;
  service_tier?: string;
  speed?: string;
}

/**
 * The opencode `message.data` JSON (USAGE-SPEC.md §2.3). Mind the capitalized
 * `sessionID` / `providerID` / `modelID` — they are not the neutral casing.
 */
export interface RawOpenCodeMessage {
  cost?: number;
  id: string;
  modelID?: string;
  path?: { cwd?: string; root?: string };
  providerID?: string;
  role: string;
  sessionID: string;
  time?: { created?: number };
  tokens?: {
    input?: number;
    output?: number;
    reasoning?: number;
    cache?: { read?: number; write?: number };
  };
}
