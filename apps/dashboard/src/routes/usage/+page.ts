import type { PageLoad } from './$types';
import type {
  UsageBlocksResponse,
  UsageLimitsResponse,
  UsageSummary,
} from '$lib/cockpit/usage';

/** The combined payload from `/api/usage/overview`. */
interface UsageOverview {
  limits: UsageLimitsResponse;
  claude: UsageSummary;
  opencode: UsageSummary;
  blocksClaude: UsageBlocksResponse['blocks'];
  blocksOpenCode: UsageBlocksResponse['blocks'];
}

/**
 * One round-trip to the hub for the whole usage surface instead of five.
 * Falls back to the split endpoints if the hub predates the combined one.
 */
export const load: PageLoad = async ({ fetch }) => {
  const read = async <T>(path: string): Promise<T | Error> =>
    fetch(path)
      .then(async (response) => {
        if (!response.ok) throw new Error(`the hub answered ${response.status}`);
        return (await response.json()) as T;
      })
      .catch((error: unknown) => error as Error);

  // Try the combined endpoint first.
  const overview = await read<UsageOverview>('/api/usage/overview?recentDays=3');
  if (!(overview instanceof Error)) {
    return {
      limits: overview.limits ?? null,
      claude: overview.claude ?? null,
      opencode: overview.opencode ?? null,
      blocksClaude: overview.blocksClaude ?? [],
      blocksOpenCode: overview.blocksOpenCode ?? [],
      error: null,
    };
  }

  // Fallback: hub too old for /overview — five parallel calls.
  const [limits, claude, opencode, blocksClaude, blocksOpenCode] = await Promise.all([
    read<UsageLimitsResponse>('/api/usage/limits'),
    read<UsageSummary>('/api/usage/summary?harness=claude&groupBy=model'),
    read<UsageSummary>('/api/usage/summary?harness=opencode&groupBy=model'),
    read<UsageBlocksResponse>('/api/usage/blocks?harness=claude&recentDays=3'),
    read<UsageBlocksResponse>('/api/usage/blocks?harness=opencode&recentDays=3'),
  ]);

  return {
    limits: limits instanceof Error ? null : limits,
    claude: claude instanceof Error ? null : claude,
    opencode: opencode instanceof Error ? null : opencode,
    blocksClaude: blocksClaude instanceof Error ? [] : blocksClaude.blocks,
    blocksOpenCode: blocksOpenCode instanceof Error ? [] : blocksOpenCode.blocks,
    error: [limits, claude, opencode].every((r) => r instanceof Error)
      ? 'Could not reach the hub for usage data. Check that it is running, then try again.'
      : null,
  };
};
