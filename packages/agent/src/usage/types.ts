import type { UsageHarness, UsageTokens } from '@cockpit/core';

/**
 * One normalized usage record, harness-agnostic. The scanners reduce their
 * on-disk shapes (Claude JSONL, opencode SQLite) into this, and the
 * orchestrator dedups and folds them into {@link UsageBucket}s.
 */
export interface ScannedRecord {
  harness: UsageHarness;
  ts: number; // ms epoch
  sessionId: string;
  project: string;
  projectPath: string | null;
  model: string;
  provider: string | null;
  tokens: UsageTokens;
  costUsd: number;
  /** Dedup identity. Claude: `message.id`. opencode: the DB `id` column. */
  messageId: string;
  /** Claude only; null for opencode. */
  requestId: string | null;
  /** Claude only; false for opencode. */
  isSidechain: boolean;
}

/** Per-file incremental watermark for a Claude JSONL transcript. */
export interface ClaudeFileWatermark {
  mtimeMs: number;
  size: number;
  /** Bytes consumed; transcripts are append-only, so the next read starts here. */
  offset: number;
}
