import { totalTokens } from "./tokens";
import type { UsageBucket, UsageTokens } from "./types";

/**
 * 5-hour billing blocks (USAGE-SPEC.md §4.4), a port of ccusage
 * blocks.rs:53-107. Operates on hourly buckets rather than raw entries: block
 * starts are hour-floored and within-bucket gaps are ≤1h, so only inter-bucket
 * gaps can cross the 5h threshold.
 */
export const SESSION_DURATION_MS = 5 * 60 * 60 * 1000;

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

/** ccusage blocks.rs:38-43. `tokensPerMinuteForIndicator` excludes cache reads/writes. */
export interface BurnRate {
  costPerHour: number;
  tokensPerMinute: number;
  tokensPerMinuteForIndicator: number;
}

/** ccusage blocks.rs:45-51. */
export interface Projection {
  remainingMinutes: number;
  totalCost: number;
  totalTokens: number;
}

export interface UsageBlock {
  actualEndTime: number | null; // last bucket's lastTs; null for a gap block
  burnRate: BurnRate | null;
  costUsd: number;
  endTime: number; // startTime + 5h
  firstTs: number; // earliest record in the block (block start for a gap)
  id: string; // ISO(startTime)
  isActive: boolean;
  isGap: boolean;
  lastTs: number; // latest record in the block (block end for a gap)
  models: string[];
  projection: Projection | null;
  startTime: number; // ms epoch, hour-floored
  tokens: UsageTokens;
}

export function floorToHour(ts: number): number {
  return Math.floor(ts / HOUR_MS) * HOUR_MS;
}

export function identifyBlocks(
  buckets: UsageBucket[],
  now: number
): UsageBlock[] {
  if (buckets.length === 0) {
    return [];
  }

  const sorted = [...buckets].sort((a, b) => a.firstTs - b.firstTs);
  const blocks: UsageBlock[] = [];
  let blockStart = floorToHour(sorted[0].firstTs);
  let current: UsageBucket[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i += 1) {
    const bucket = sorted[i];
    // biome-ignore lint/style/useAtIndex: `current` always has >=1 element here (seeded with sorted[0], only ever pushed to); .at(-1) would widen to UsageBucket | undefined for no reason.
    const prevLast = current[current.length - 1].lastTs;
    const sinceStart = bucket.firstTs - blockStart;
    const sinceLast = bucket.firstTs - prevLast;
    if (sinceStart > SESSION_DURATION_MS || sinceLast > SESSION_DURATION_MS) {
      blocks.push(createBlock(blockStart, current, now));
      if (sinceLast > SESSION_DURATION_MS) {
        blocks.push(createGapBlock(prevLast, bucket.firstTs));
      }
      blockStart = floorToHour(bucket.firstTs);
      current = [];
    }
    current.push(bucket);
  }

  blocks.push(createBlock(blockStart, current, now));
  return blocks;
}

function createBlock(
  start: number,
  buckets: UsageBucket[],
  now: number
): UsageBlock {
  const end = start + SESSION_DURATION_MS;
  const { firstTs } = buckets[0];
  // biome-ignore lint/style/useAtIndex: `buckets` is the non-empty group passed in from identifyBlocks; .at(-1) would widen to UsageBucket | undefined for no reason.
  const { lastTs } = buckets[buckets.length - 1];
  const isActive = now - lastTs < SESSION_DURATION_MS && now < end;

  const tokens: UsageTokens = {
    input: 0,
    output: 0,
    cacheCreation: 0,
    cacheRead: 0,
    reasoning: 0,
  };
  let costUsd = 0;
  const models: string[] = [];
  const seen = new Set<string>();
  for (const b of buckets) {
    tokens.input += b.tokens.input;
    tokens.output += b.tokens.output;
    tokens.cacheCreation += b.tokens.cacheCreation;
    tokens.cacheRead += b.tokens.cacheRead;
    tokens.reasoning += b.tokens.reasoning;
    costUsd += b.costUsd;
    if (!seen.has(b.model)) {
      seen.add(b.model);
      models.push(b.model);
    }
  }

  const block: UsageBlock = {
    id: new Date(start).toISOString(),
    startTime: start,
    endTime: end,
    actualEndTime: lastTs,
    isActive,
    isGap: false,
    firstTs,
    lastTs,
    tokens,
    costUsd,
    models,
    burnRate: null,
    projection: null,
  };
  block.burnRate = calculateBurnRate(block);
  block.projection = projectUsage(block, now);
  return block;
}

/** ccusage blocks.rs:149-163. A gap block spans `prevLastTs + 5h → nextFirstTs`. */
function createGapBlock(prevLastTs: number, nextFirstTs: number): UsageBlock {
  const start = prevLastTs + SESSION_DURATION_MS;
  return {
    id: `gap-${new Date(start).toISOString()}`,
    startTime: start,
    endTime: nextFirstTs,
    actualEndTime: null,
    isActive: false,
    isGap: true,
    firstTs: start,
    lastTs: nextFirstTs,
    tokens: {
      input: 0,
      output: 0,
      cacheCreation: 0,
      cacheRead: 0,
      reasoning: 0,
    },
    costUsd: 0,
    models: [],
    burnRate: null,
    projection: null,
  };
}

/**
 * ccusage blocks.rs:567-584. Returns null for a gap block or a zero-duration one.
 * `tokensPerMinuteForIndicator` excludes cache tokens (input + output only).
 */
export function calculateBurnRate(block: UsageBlock): BurnRate | null {
  if (block.isGap) {
    return null;
  }
  const durationMinutes = (block.lastTs - block.firstTs) / MINUTE_MS;
  if (durationMinutes <= 0) {
    return null;
  }
  const total = totalTokens(block.tokens);
  const nonCache = block.tokens.input + block.tokens.output;
  return {
    tokensPerMinute: total / durationMinutes,
    tokensPerMinuteForIndicator: nonCache / durationMinutes,
    costPerHour: (block.costUsd / durationMinutes) * 60,
  };
}

/** ccusage blocks.rs:586-601. Only the active, non-gap block projects. */
export function projectUsage(
  block: UsageBlock,
  now: number
): Projection | null {
  if (!block.isActive || block.isGap) {
    return null;
  }
  const burn = calculateBurnRate(block);
  if (!burn) {
    return null;
  }
  const remainingMinutes = Math.round((block.endTime - now) / MINUTE_MS);
  const total = totalTokens(block.tokens);
  const projectedTokens = Math.round(
    total + burn.tokensPerMinute * remainingMinutes
  );
  const projectedCost =
    Math.round(
      (block.costUsd + (burn.costPerHour / 60) * remainingMinutes) * 100
    ) / 100;
  return {
    totalTokens: projectedTokens,
    totalCost: projectedCost,
    remainingMinutes,
  };
}
